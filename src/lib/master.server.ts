/**
 * PAINEL MASTER DO PROPRIETÁRIO — camada server-only.
 *
 * Regra absoluta: o acesso Master pertence a UMA identidade fixa
 * (`EMAIL_MASTER`), verificada no servidor pelo e-mail do usuário autenticado.
 * Não existe perfil, nível ou permissão que conceda esse acesso — a Matriz de
 * Permissões não interfere aqui.
 *
 * O isolamento entre empresas permanece intacto: nenhuma política RLS foi
 * afrouxada. As leituras globais acontecem apenas dentro destas funções, e
 * somente depois da confirmação da identidade Master.
 */

/** Único e-mail autorizado a usar o Painel Master. */
export const EMAIL_MASTER = "lucassamuel2003@hotmail.com";

export type StatusEmpresa = "ativa" | "bloqueada" | "desativada";

export type EmpresaResumoMaster = {
  id: string;
  nome: string;
  cnpj: string | null;
  status: StatusEmpresa;
  criadaEm: string;
  planoCodigo: string | null;
  periodicidade: string | null;
  statusAssinatura: string | null;
  dataInicio: string | null;
  periodoAtualFim: string | null;
  proximaCobranca: string | null;
  usuarios: number;
  usuariosLimite: number | null;
};

export type UsuarioEmpresaMaster = {
  userId: string;
  nome: string | null;
  email: string | null;
  perfil: string | null;
  setor: string | null;
  papel: string | null;
  bloqueado: boolean;
  ativo: boolean;
};

export type EmpresaDetalheMaster = {
  empresa: {
    id: string;
    nome: string;
    cnpj: string | null;
    emailContato: string | null;
    telefone: string | null;
    observacoes: string | null;
    status: StatusEmpresa;
    criadaEm: string;
    bloqueadaEm: string | null;
    motivoBloqueio: string | null;
    desativadaEm: string | null;
    administrador: { nome: string | null; email: string | null } | null;
  };
  assinatura: {
    id: string;
    planoCodigo: string | null;
    planoNome: string | null;
    periodicidade: string | null;
    status: string;
    ambiente: string;
    valorCentavos: number | null;
    moeda: string | null;
    dataInicio: string | null;
    periodoAtualInicio: string | null;
    periodoAtualFim: string | null;
    proximaCobranca: string | null;
    trialFim: string | null;
    providerSubscriptionId: string | null;
    maxUsuarios: number | null;
  } | null;
  usuarios: UsuarioEmpresaMaster[];
  usuariosUsados: number;
  usuariosLimite: number | null;
};

type Ctx = { supabase: any; userId: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** E-mail autenticado, lido da fonte de verdade (não do cliente). */
async function emailAutenticado(userId: string) {
  const sb = await admin();
  const { data } = await sb.auth.admin.getUserById(userId);
  return (data?.user?.email ?? "").trim().toLowerCase();
}

/** Confirma se o usuário autenticado é o proprietário Master do SaaS. */
export async function ehMaster(context: Ctx) {
  if (!context?.userId) return false;
  return (await emailAutenticado(context.userId)) === EMAIL_MASTER;
}

/** Barreira de segurança: só o proprietário Master passa daqui. */
export async function exigirMaster(context: Ctx) {
  if (!(await ehMaster(context))) {
    throw new Error("Acesso restrito ao proprietário do sistema.");
  }
  return { userId: context.userId, email: EMAIL_MASTER };
}

export function statusEmpresa(row: {
  ativo?: boolean | null;
  bloqueada?: boolean | null;
}): StatusEmpresa {
  if (row.ativo === false) return "desativada";
  if (row.bloqueada) return "bloqueada";
  return "ativa";
}

/** Trilha de auditoria das ações do Painel Master. */
export async function auditarMaster(
  userId: string,
  acao: string,
  empresa: { id: string; nome?: string | null },
  extras?: { resultado?: string; motivo?: string | null },
) {
  const sb = await admin();
  const partes = [`Empresa: ${empresa.nome ?? empresa.id}`, `ID: ${empresa.id}`];
  if (extras?.motivo) partes.push(`Motivo: ${extras.motivo}`);
  await sb.from("auditoria").insert({
    user_id: userId,
    usuario: EMAIL_MASTER,
    nome: "Proprietário do sistema",
    perfil: "proprietario",
    tipo_acao: "administracao",
    acao,
    modulo: "MASTER",
    resultado: extras?.resultado ?? "sucesso",
    detalhe: partes.join(" · "),
  });
}

const AMBIENTES = ["live", "sandbox"] as const;

/** Assinatura mais relevante da empresa (ativa/trial primeiro, depois recente). */
function melhorAssinatura(linhas: any[]) {
  const peso = (s: string) =>
    s === "ativa" ? 0 : s === "trial" ? 1 : s === "pagamento_pendente" ? 2 : 3;
  return [...linhas].sort(
    (a, b) =>
      peso(a.status) - peso(b.status) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

/**
 * Listagem resumida com pesquisa feita no banco (nome ou CNPJ) e paginação.
 * Os detalhes completos só são carregados ao abrir uma empresa.
 */
export async function listarEmpresas(opcoes: {
  busca: string;
  pagina: number;
  porPagina: number;
}) {
  const sb = await admin();
  const inicio = (opcoes.pagina - 1) * opcoes.porPagina;
  let consulta = sb
    .from("empresas")
    .select("id,nome,cnpj,ativo,bloqueada,created_at", { count: "exact" })
    .order("nome")
    .range(inicio, inicio + opcoes.porPagina - 1);

  const busca = opcoes.busca.trim();
  if (busca) {
    const digitos = busca.replace(/\D+/g, "");
    const filtros = [`nome.ilike.%${busca.replace(/[%,]/g, "")}%`];
    if (digitos) filtros.push(`cnpj.ilike.%${digitos}%`);
    consulta = consulta.or(filtros.join(","));
  }

  const { data: empresas, count, error } = await consulta;
  if (error) throw new Error(error.message);

  const ids = (empresas ?? []).map((e: any) => e.id);
  if (!ids.length) return { empresas: [] as EmpresaResumoMaster[], total: count ?? 0 };

  const [{ data: assinaturas }, { data: vinculos }] = await Promise.all([
    sb
      .from("assinaturas")
      .select(
        "id,empresa_id,plano_codigo,periodicidade,status,ambiente,data_inicio,periodo_atual_fim,proxima_cobranca,created_at,planos(max_usuarios)",
      )
      .in("empresa_id", ids)
      .in("ambiente", AMBIENTES as unknown as string[]),
    sb.from("empresa_usuarios").select("empresa_id,user_id").in("empresa_id", ids).eq("ativo", true),
  ]);

  const porEmpresa = new Map<string, any[]>();
  for (const a of assinaturas ?? []) {
    porEmpresa.set(a.empresa_id, [...(porEmpresa.get(a.empresa_id) ?? []), a]);
  }
  const usuarios = new Map<string, number>();
  for (const v of vinculos ?? []) usuarios.set(v.empresa_id, (usuarios.get(v.empresa_id) ?? 0) + 1);

  const lista: EmpresaResumoMaster[] = (empresas ?? []).map((e: any) => {
    const a = melhorAssinatura(porEmpresa.get(e.id) ?? []);
    return {
      id: e.id,
      nome: e.nome,
      cnpj: e.cnpj ?? null,
      status: statusEmpresa(e),
      criadaEm: e.created_at,
      planoCodigo: a?.plano_codigo ?? null,
      periodicidade: a?.periodicidade ?? null,
      statusAssinatura: a?.status ?? null,
      dataInicio: a?.data_inicio ?? null,
      periodoAtualFim: a?.periodo_atual_fim ?? null,
      proximaCobranca: a?.proxima_cobranca ?? null,
      usuarios: usuarios.get(e.id) ?? 0,
      usuariosLimite: a?.planos?.max_usuarios ?? null,
    };
  });

  return { empresas: lista, total: count ?? lista.length };
}

/** Detalhes de uma empresa: cadastro, assinatura (somente leitura) e usuários. */
export async function detalheEmpresa(empresaId: string): Promise<EmpresaDetalheMaster> {
  const sb = await admin();
  const { data: empresa, error } = await sb
    .from("empresas")
    .select(
      "id,nome,cnpj,email_contato,telefone,observacoes,ativo,bloqueada,bloqueada_em,motivo_bloqueio,desativada_em,created_at",
    )
    .eq("id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!empresa) throw new Error("Empresa não encontrada.");

  const [{ data: assinaturas }, { data: vinculos }] = await Promise.all([
    sb
      .from("assinaturas")
      .select(
        "id,plano_codigo,periodicidade,status,ambiente,valor_centavos,moeda,data_inicio,periodo_atual_inicio,periodo_atual_fim,proxima_cobranca,trial_fim,provider_subscription_id,created_at,planos(nome,max_usuarios)",
      )
      .eq("empresa_id", empresaId),
    sb.from("empresa_usuarios").select("user_id,papel,ativo").eq("empresa_id", empresaId),
  ]);

  const a = melhorAssinatura(assinaturas ?? []);
  const ids = (vinculos ?? []).map((v: any) => v.user_id);

  const { data: perfis } = ids.length
    ? await sb
        .from("user_profiles")
        .select("user_id,nome,perfil,setor,bloqueado")
        .in("user_id", ids)
    : { data: [] as any[] };

  const emails = new Map<string, string>();
  for (const id of ids) {
    const { data } = await sb.auth.admin.getUserById(id);
    if (data?.user?.email) emails.set(id, data.user.email);
  }

  const perfilPor = new Map((perfis ?? []).map((p: any) => [p.user_id, p]));
  const usuarios: UsuarioEmpresaMaster[] = (vinculos ?? []).map((v: any) => {
    const p = perfilPor.get(v.user_id) as any;
    return {
      userId: v.user_id,
      nome: p?.nome ?? null,
      email: emails.get(v.user_id) ?? null,
      perfil: p?.perfil ?? null,
      setor: p?.setor ?? null,
      papel: v.papel ?? null,
      bloqueado: Boolean(p?.bloqueado),
      ativo: Boolean(v.ativo),
    };
  });

  const responsavel =
    usuarios.find((u) => u.papel === "proprietario") ??
    usuarios.find((u) => u.papel === "administrador") ??
    null;

  return {
    empresa: {
      id: empresa.id,
      nome: empresa.nome,
      cnpj: empresa.cnpj ?? null,
      emailContato: empresa.email_contato ?? null,
      telefone: empresa.telefone ?? null,
      observacoes: empresa.observacoes ?? null,
      status: statusEmpresa(empresa),
      criadaEm: empresa.created_at,
      bloqueadaEm: empresa.bloqueada_em ?? null,
      motivoBloqueio: empresa.motivo_bloqueio ?? null,
      desativadaEm: empresa.desativada_em ?? null,
      administrador: responsavel ? { nome: responsavel.nome, email: responsavel.email } : null,
    },
    assinatura: a
      ? {
          id: a.id,
          planoCodigo: a.plano_codigo ?? null,
          planoNome: a.planos?.nome ?? null,
          periodicidade: a.periodicidade ?? null,
          status: a.status,
          ambiente: a.ambiente,
          valorCentavos: a.valor_centavos ?? null,
          moeda: a.moeda ?? null,
          dataInicio: a.data_inicio ?? null,
          periodoAtualInicio: a.periodo_atual_inicio ?? null,
          periodoAtualFim: a.periodo_atual_fim ?? null,
          proximaCobranca: a.proxima_cobranca ?? null,
          trialFim: a.trial_fim ?? null,
          providerSubscriptionId: a.provider_subscription_id ?? null,
          maxUsuarios: a.planos?.max_usuarios ?? null,
        }
      : null,
    usuarios,
    usuariosUsados: usuarios.filter((u) => u.ativo && !u.bloqueado).length,
    usuariosLimite: a?.planos?.max_usuarios ?? null,
  };
}

/**
 * Estado administrativo da empresa. Não toca em assinatura, plano, provedor de
 * pagamentos nem em dados operacionais — bloqueio administrativo e situação da
 * assinatura são conceitos independentes.
 */
export async function alterarEstadoEmpresa(
  empresaId: string,
  patch: Record<string, unknown>,
) {
  const sb = await admin();
  const { data: antes } = await sb
    .from("empresas")
    .select("id,nome,ativo,bloqueada")
    .eq("id", empresaId)
    .maybeSingle();
  if (!antes) throw new Error("Empresa não encontrada.");
  const { error } = await sb.from("empresas").update(patch).eq("id", empresaId);
  if (error) throw new Error(error.message);
  return antes as { id: string; nome: string; ativo: boolean; bloqueada: boolean };
}

/**
 * Exclusão definitiva da empresa. Remove o cadastro, os vínculos de usuários e
 * o histórico de assinaturas/pagamentos dela. As contas de login dos usuários
 * não são apagadas — apenas deixam de pertencer à empresa.
 */
export async function excluirEmpresa(empresaId: string) {
  const sb = await admin();
  const { data: antes } = await sb
    .from("empresas")
    .select("id,nome")
    .eq("id", empresaId)
    .maybeSingle();
  if (!antes) throw new Error("Empresa não encontrada.");

  const { data: assinaturas } = await sb
    .from("assinaturas")
    .select("id")
    .eq("empresa_id", empresaId);
  const idsAssinaturas = (assinaturas ?? []).map((a: any) => a.id);

  await sb.from("assinatura_pagamentos").delete().eq("empresa_id", empresaId);
  if (idsAssinaturas.length) {
    await sb.from("assinatura_pagamentos").delete().in("assinatura_id", idsAssinaturas);
  }
  await sb.from("assinaturas").delete().eq("empresa_id", empresaId);
  await sb.from("empresa_usuarios").delete().eq("empresa_id", empresaId);

  const { error } = await sb.from("empresas").delete().eq("id", empresaId);
  if (error) throw new Error(error.message);
  return antes as { id: string; nome: string };
}

/** Visão geral do SaaS (contagens agregadas, sem dados sensíveis). */
export async function visaoGeral() {
  const sb = await admin();
  const conta = async (filtro: (q: any) => any) => {
    const { count } = await filtro(sb.from("empresas").select("id", { count: "exact", head: true }));
    return count ?? 0;
  };
  const [total, bloqueadas, desativadas, assinaturas] = await Promise.all([
    conta((q: any) => q),
    conta((q: any) => q.eq("bloqueada", true).eq("ativo", true)),
    conta((q: any) => q.eq("ativo", false)),
    sb.from("assinaturas").select("status"),
  ]);
  const porStatus: Record<string, number> = {};
  for (const a of assinaturas.data ?? []) porStatus[a.status] = (porStatus[a.status] ?? 0) + 1;
  return { total, bloqueadas, desativadas, ativas: total - bloqueadas - desativadas, porStatus };
}

/** Auditoria das ações do próprio Painel Master. */
export async function auditoriaMaster(limite: number) {
  const sb = await admin();
  const { data } = await sb
    .from("auditoria")
    .select("id,created_at,acao,detalhe,resultado,usuario")
    .eq("modulo", "MASTER")
    .order("created_at", { ascending: false })
    .limit(limite);
  return (data ?? []) as {
    id: string;
    created_at: string;
    acao: string;
    detalhe: string | null;
    resultado: string;
    usuario: string | null;
  }[];
}
