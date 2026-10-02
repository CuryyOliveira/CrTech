/**
 * FASE 11 — Camada central de autorização.
 *
 * Usuário → Empresa → Assinatura → Plano → Limite → Permissão → Módulo.
 * Toda decisão sensível é resolvida aqui, no servidor. O frontend apenas
 * reflete o resultado; nenhuma regra depende exclusivamente do cliente.
 *
 * Preservação: usuários e empresas anteriores ao SaaS (lista de legados ou
 * data de criação anterior ao corte) nunca são bloqueados por assinatura.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { anteriorAoCorte, type MotivoBloqueio } from "@/lib/onboarding-regras";
import { PERMISSOES, nivelDe, type ModuloId, type Perfil } from "@/lib/permissions";

export type PlanoResumo = {
  plano_codigo: string | null;
  status: string;
  periodicidade: string | null;
  valor_centavos: number | null;
  moeda: string | null;
  trial_fim: string | null;
  proxima_cobranca: string | null;
  periodo_atual_fim: string | null;
  cancelar_no_fim_periodo?: boolean;
  modulos: string[];
  max_usuarios: number | null;
  max_modulos?: number | null;
};

export type ContextoAcesso = {
  userId: string;
  nome: string | null;
  perfil: Perfil | null;
  nivel: number;
  bloqueado: boolean;
  legado: boolean;
  empresaId: string | null;
  empresaNome: string | null;
  segmento: string | null;
  papel: string | null;
  assinaturaAtiva: boolean;
  plano: PlanoResumo | null;
  usuariosUsados: number | null;
  usuariosLimite: number | null;
  modulosUsados: number | null;
  modulosLimite: number | null;
  modulos: ModuloId[];
  bloqueio: MotivoBloqueio | null;
};


const AMBIENTES = ["live", "sandbox"] as const;

async function resolverContexto(supabase: any, userId: string): Promise<ContextoAcesso> {
  const [{ data: perfilRow }, { data: legadoRpc }, { data: empresaId }] = await Promise.all([
    supabase.from("user_profiles").select("perfil,nome,bloqueado").eq("user_id", userId).maybeSingle(),
    supabase.rpc("eh_usuario_legado", { _user_id: userId }),
    supabase.rpc("empresa_do_usuario", { _user_id: userId }),
  ]);

  const perfil = (perfilRow?.perfil ?? null) as Perfil | null;
  const bloqueado = Boolean(perfilRow?.bloqueado);
  let legado = legadoRpc === true;

  let empresaNome: string | null = null;
  let segmento: string | null = null;
  let papel: string | null = null;
  let empresaBloqueada = false;
  let empresaDesativada = false;
  if (empresaId) {
    const [{ data: empresa }, { data: vinculo }] = await Promise.all([
      supabase
        .from("empresas")
        .select("nome,created_at,ativo,bloqueada,segmento")
        .eq("id", empresaId)
        .maybeSingle(),
      supabase
        .from("empresa_usuarios")
        .select("papel")
        .eq("empresa_id", empresaId)
        .eq("user_id", userId)
        .eq("ativo", true)
        .maybeSingle(),
    ]);
    empresaNome = empresa?.nome ?? null;
    segmento = (empresa?.segmento as string | null) ?? null;
    papel = vinculo?.papel ?? null;
    empresaBloqueada = Boolean(empresa?.bloqueada);
    empresaDesativada = empresa?.ativo === false;
    // Empresa existente antes do SaaS continua funcionando sem assinatura.
    if (anteriorAoCorte(empresa?.created_at)) legado = true;
  }

  let plano: PlanoResumo | null = null;
  let assinaturaAtiva = false;
  if (empresaId) {
    for (const ambiente of AMBIENTES) {
      const [{ data: p }, { data: ativa }] = await Promise.all([
        supabase.rpc("plano_da_empresa", { _empresa_id: empresaId, _ambiente: ambiente }),
        supabase.rpc("assinatura_ativa_empresa", { _empresa_id: empresaId, _ambiente: ambiente }),
      ]);
      if (!p) continue;
      plano = p as PlanoResumo;
      assinaturaAtiva = Boolean(ativa);
      if (assinaturaAtiva) break;
    }
  }

  let usuariosUsados: number | null = null;
  let modulosUsados: number | null = null;
  if (empresaId) {
    const [{ data: usados }, { data: mods }] = await Promise.all([
      supabase.rpc("usuarios_ativos_empresa", { _empresa_id: empresaId }),
      supabase.rpc("modulos_ativos_empresa", { _empresa_id: empresaId }),
    ]);
    usuariosUsados = typeof usados === "number" ? usados : null;
    modulosUsados = typeof mods === "number" ? mods : null;
  }


  // Módulos efetivos = perfil ∩ plano ∩ permissões individuais.
  let modulos: ModuloId[] = perfil && !bloqueado ? [...(PERMISSOES[perfil] ?? [])] : [];

  // FASE 13 — os módulos legados (Frota, Agrícola, Indústria) pertencem à
  // estrutura histórica. Nenhuma empresa nova herda esses módulos: para ela,
  // a fonte de verdade é exclusivamente `empresa_modulos`. Somente o acesso
  // administrativo (ADMIN) continua vindo do perfil.
  if (!legado) modulos = modulos.filter((m) => m === "ADMIN");

  const doPlano = (plano?.modulos ?? []).filter(Boolean);
  if (!legado && doPlano.length > 0) {
    modulos = modulos.filter((m) => m === "ADMIN" || doPlano.includes(m));
  }

  const { data: individuais } = await supabase
    .from("permissoes_usuario")
    .select("modulo,acoes")
    .eq("user_id", userId);
  const linhas = (individuais ?? []) as { modulo: string; acoes: string[] | null }[];
  if (linhas.length > 0) {
    const liberados = linhas
      .filter((l) => (l.acoes ?? []).length > 0)
      .map((l) => l.modulo as ModuloId);
    modulos = modulos.filter((m) => liberados.includes(m));
  }

  // Bloqueio administrativo do proprietário do sistema vale para todos,
  // inclusive empresas legadas — é independente da assinatura.
  const bloqueio: MotivoBloqueio | null = bloqueado
    ? "usuario_bloqueado"
    : empresaDesativada
      ? "empresa_desativada"
      : empresaBloqueada
        ? "empresa_bloqueada"
        : legado
          ? null
          : !empresaId
            ? "sem_empresa"
            : !assinaturaAtiva
              ? "sem_assinatura"
              : null;

  return {
    userId,
    nome: perfilRow?.nome ?? null,
    perfil,
    nivel: nivelDe(perfil),
    bloqueado,
    legado,
    empresaId: (empresaId as string | null) ?? null,
    empresaNome,
    segmento,
    papel,
    assinaturaAtiva,
    plano,
    usuariosUsados,
    usuariosLimite: plano?.max_usuarios ?? null,
    modulosUsados,
    modulosLimite: typeof plano?.max_modulos === "number" ? plano.max_modulos : null,
    modulos,
    bloqueio,
  };
}

/** Contexto de acesso do usuário autenticado (fonte de verdade do backend). */
export const contextoAcesso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    return resolverContexto(supabase, userId);
  });

/**
 * Autorização de módulo validada no servidor: usada pelas telas operacionais
 * para que a URL direta não contorne plano, assinatura ou permissão.
 *
 * Aceita módulos legados (código fixo) e módulos criados pela empresa
 * (identificador do módulo em `empresa_modulos`). Em ambos os casos a decisão
 * é fail-closed: qualquer dúvida nega o acesso.
 */
export const autorizarModulo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { modulo: string }) => {
    if (!data?.modulo) throw new Error("Módulo não informado.");
    return { modulo: String(data.modulo) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const legados = new Set<string>([
      "FROTA",
      "FERRAMENTAS_AGRICOLA",
      "ESTOQUE_AGRICOLA",
      "FERRAMENTAS_INDUSTRIA",
      "ESTOQUE_INDUSTRIA",
      "ADMIN",
    ]);
    const ctx = await resolverContexto(supabase, userId);
    if (ctx.bloqueio) return { permitido: false, motivo: ctx.bloqueio, contexto: ctx };

    if (legados.has(data.modulo)) {
      if (!ctx.modulos.includes(data.modulo as ModuloId)) {
        return { permitido: false, motivo: "sem_permissao" as const, contexto: ctx };
      }
      return { permitido: true, motivo: null, contexto: ctx };
    }

    // Módulo dinâmico: precisa existir, estar ativo, pertencer à empresa do
    // usuário e o perfil precisa ter nível operacional (Conferente ou acima).
    if (!ctx.empresaId || ctx.nivel < 2) {
      return { permitido: false, motivo: "sem_permissao" as const, contexto: ctx };
    }
    const { data: modulo } = await supabase
      .from("empresa_modulos")
      .select("id,empresa_id,ativo,excluido")
      .eq("id", data.modulo)
      .maybeSingle();
    const ok =
      Boolean(modulo) &&
      modulo.empresa_id === ctx.empresaId &&
      modulo.ativo === true &&
      modulo.excluido === false;
    if (!ok) return { permitido: false, motivo: "sem_permissao" as const, contexto: ctx };

    const { data: individuais } = await supabase
      .from("permissoes_usuario")
      .select("modulo,acoes")
      .eq("user_id", userId)
      .eq("modulo", data.modulo)
      .maybeSingle();
    if (individuais && (individuais.acoes ?? []).length === 0) {
      return { permitido: false, motivo: "sem_permissao" as const, contexto: ctx };
    }

    return { permitido: true, motivo: null, contexto: ctx };
  });

