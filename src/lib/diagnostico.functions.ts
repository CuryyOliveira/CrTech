import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NIVEL_ADMIN, PERFIL_LABEL, nivelDe, temNivel, type Perfil } from "@/lib/permissions";

export type ItemDiagnostico = {
  nome: string;
  ok: boolean;
  detalhe: string;
};

export type Diagnostico = {
  gerado_em: string;
  usuario: { id: string; email: string | null; perfil: Perfil | null; nivel: number };
  itens: ItemDiagnostico[];
  ok: boolean;
};

/** Tabelas verificadas quanto ao acesso de leitura do usuário autenticado. */
const TABELAS = [
  "user_profiles",
  "historico_conferencias",
  "conferencias",
  "conferencia_itens",
  "materiais",
  "unidades",
  "auditoria",
  "metas",
  "configuracoes_sistema",
  "integracoes",
  "notificacoes_conferencia",
  "notificacao_emails",
  "permissoes_perfil",
  "permissoes_usuario",
  "cadastros_mestres",
  "avisos_sistema",
  "sessoes_usuario",
  "relatorios_agendados",
] as const;

/**
 * Autodiagnóstico de autenticação, autorização e acesso ao banco:
 * sessão, claims do JWT, perfil/nível, políticas RLS e leitura de cada tabela.
 */
export const diagnosticoAcesso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Diagnostico> => {
    const { supabase, userId, claims } = context as {
      supabase: any;
      userId: string;
      claims: Record<string, unknown>;
    };
    const itens: ItemDiagnostico[] = [];

    itens.push({
      nome: "Usuário autenticado",
      ok: !!userId,
      detalhe: userId ? `ID ${userId}` : "Sem sessão válida",
    });

    const email = (claims['email'] as string | undefined) ?? null;
    itens.push({
      nome: "Claims do JWT",
      ok: !!claims['sub'] && !!claims['role'],
      detalhe: `sub=${String(claims['sub'] ?? "—")} · role=${String(claims['role'] ?? "—")} · exp=${
        claims['exp'] ? new Date(Number(claims['exp']) * 1000).toLocaleString("pt-BR") : "—"
      }`,
    });

    const { data: perfilRow, error: erroPerfil } = await supabase
      .from("user_profiles")
      .select("perfil,nome,setor,bloqueado")
      .eq("user_id", userId)
      .maybeSingle();

    const perfil = (perfilRow?.perfil ?? null) as Perfil | null;
    const nivel = nivelDe(perfil);

    itens.push({
      nome: "Perfil de acesso carregado",
      ok: !!perfil && !erroPerfil,
      detalhe: erroPerfil
        ? erroPerfil.message
        : perfil
          ? `${PERFIL_LABEL[perfil]} (nível ${nivel})`
          : "Nenhum registro em user_profiles",
    });

    itens.push({
      nome: "Conta ativa",
      ok: !perfilRow?.bloqueado,
      detalhe: perfilRow?.bloqueado ? "Usuário bloqueado" : "Sem bloqueios",
    });

    itens.push({
      nome: "Nível administrativo",
      ok: temNivel(perfil, NIVEL_ADMIN),
      detalhe: temNivel(perfil, NIVEL_ADMIN)
        ? "Acesso à Central Administrativa liberado"
        : "Perfil sem nível administrativo",
    });

    // Verificação das funções internas de permissão (aplicadas nas políticas RLS).
    // A função de diagnóstico não é executável por usuários logados: só o
    // servidor a chama, informando explicitamente o usuário autenticado.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: admFn, error: erroAdmFn } = await (
      supabaseAdmin as unknown as { rpc: (n: string, a: unknown) => Promise<any> }
    ).rpc("diagnostico_permissoes", { _user_id: userId });
    if (!erroAdmFn && admFn) {
      itens.push({
        nome: "Funções de permissão (RLS)",
        ok: !!admFn.eh_administrador === temNivel(perfil, NIVEL_ADMIN),
        detalhe: `perfil_atual=${admFn.perfil_atual ?? "—"} · nivel=${admFn.nivel ?? "—"} · administrador=${
          admFn.eh_administrador ? "sim" : "não"
        }`,
      });
    }

    for (const tabela of TABELAS) {
      const { error, count } = await supabase
        .from(tabela)
        .select("*", { count: "exact", head: true });
      itens.push({
        nome: `Leitura: ${tabela}`,
        ok: !error,
        detalhe: error ? error.message : `${count ?? 0} registro(s) visíveis`,
      });
    }

    return {
      gerado_em: new Date().toISOString(),
      usuario: { id: userId, email, perfil, nivel },
      itens,
      ok: itens.every((i) => i.ok),
    };
  });
