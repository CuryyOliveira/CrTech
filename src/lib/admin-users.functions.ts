import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { anteriorAoCorte } from "@/lib/onboarding-regras";
import { NIVEL_ADMIN, ehProprietario, nivelDe, temNivel, type Perfil } from "@/lib/permissions";

type Ctx = { supabase: any; userId: string };

/**
 * Escopo de gestão de usuários. Empresas criadas no modelo SaaS só administram
 * os próprios usuários; o Proprietário do Sistema e as contas legadas (anteriores
 * ao SaaS) mantêm a visão global que já possuíam.
 *
 * Retornar `null` significa "sem restrição de empresa".
 */
async function escopoUsuarios(context: Ctx): Promise<string[] | null> {
  const { supabase, userId } = context;
  const [{ data: perfilRow }, { data: legado }, { data: empresaId }] = await Promise.all([
    supabase.from("user_profiles").select("perfil,created_at").eq("user_id", userId).maybeSingle(),
    supabase.rpc("eh_usuario_legado", { _user_id: userId }),
    supabase.rpc("empresa_do_usuario", { _user_id: userId }),
  ]);
  if (ehProprietario(perfilRow?.perfil as Perfil | undefined)) return null;
  if (legado === true || anteriorAoCorte(perfilRow?.created_at)) return null;
  if (!empresaId) return [userId];

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: membros } = await supabaseAdmin
    .from("empresa_usuarios")
    .select("user_id")
    .eq("empresa_id", empresaId as string);
  const ids = new Set<string>([userId, ...((membros ?? []) as { user_id: string }[]).map((m) => m.user_id)]);
  return [...ids];
}

/** Impede alterar usuários de outra empresa. */
async function exigirMesmaEmpresa(context: Ctx, alvoUserId: string) {
  const escopo = await escopoUsuarios(context);
  if (escopo && !escopo.includes(alvoUserId))
    throw new Error("Este usuário pertence a outra empresa");
}


/** Perfil do solicitante; exige nível administrativo (Administrador e acima). */
async function exigirAdmin(context: Ctx): Promise<Perfil> {
  const { data, error } = await context.supabase
    .from("user_profiles")
    .select("perfil,bloqueado")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const perfil = data?.perfil as Perfil | undefined;
  if (data?.bloqueado || !temNivel(perfil, NIVEL_ADMIN))
    throw new Error("Acesso não autorizado");
  return perfil as Perfil;
}

async function exigirProprietario(context: Ctx) {
  const perfil = await exigirAdmin(context);
  if (!ehProprietario(perfil)) throw new Error("Ação exclusiva do Proprietário do Sistema");
}


/** Bloqueia qualquer alteração na conta do Proprietário feita por outro usuário. */
async function protegerProprietario(admin: any, alvoUserId: string, solicitante: string) {
  const { data } = await admin
    .from("user_profiles")
    .select("perfil")
    .eq("user_id", alvoUserId)
    .maybeSingle();
  if (data?.perfil === "proprietario" && alvoUserId !== solicitante)
    throw new Error(
      "A conta do Proprietário do Sistema só pode ser alterada pelo próprio Proprietário",
    );
}

/** Confere a senha da conta do solicitante antes de liberar uma ação crítica. */
async function conferirSenha(email: string, senha: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"]!;
  const client = createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: any, init?: any) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error("Senha incorreta");
}

/** Limite de usuários com acesso conforme o plano contratado pela empresa. */
async function licencasDaEmpresa(context: Ctx) {
  const { data: empresaId } = await context.supabase.rpc("empresa_do_usuario", {
    _user_id: context.userId,
  });
  let limite: number | null = null;
  let planoCodigo: string | null = null;
  let ativa = false;
  if (empresaId) {
    // A assinatura pode estar no ambiente de teste ou no de produção.
    for (const ambiente of ["live", "sandbox"] as const) {
      const [{ data: plano }, { data: temAssinatura }] = await Promise.all([
        context.supabase.rpc("plano_da_empresa", { _empresa_id: empresaId, _ambiente: ambiente }),
        context.supabase.rpc("assinatura_ativa_empresa", {
          _empresa_id: empresaId,
          _ambiente: ambiente,
        }),
      ]);
      if (!plano) continue;
      limite = (plano as { max_usuarios?: number | null }).max_usuarios ?? null;
      planoCodigo = (plano as { plano_codigo?: string | null }).plano_codigo ?? null;
      ativa = Boolean(temAssinatura);
      if (ativa) break;
    }
  }

  // Licenças são contadas por empresa (usuários ativos e não bloqueados).
  let usados = 0;
  if (empresaId) {
    const { data: ativos } = await context.supabase.rpc("usuarios_ativos_empresa", {
      _empresa_id: empresaId,
    });
    usados = Number(ativos ?? 0);
  } else {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("bloqueado", false);
    usados = count ?? 0;
  }

  return {
    empresaId: (empresaId as string | null) ?? null,
    ativa,
    planoCodigo,
    limite,
    usados,
    disponiveis: limite == null ? null : Math.max(0, limite - usados),
  };
}

/** Uso de licenças do plano — usado pela Gestão de Usuários. */
export const licencasAssinatura = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as any);
    return licencasDaEmpresa(context as any);
  });

/** Impede liberar mais acessos do que o plano permite. */
async function exigirLicencaDisponivel(context: Ctx) {
  const l = await licencasDaEmpresa(context);
  if (l.limite != null && l.usados >= l.limite)
    throw new Error(
      `Limite do plano atingido: ${l.limite} usuário(s) com acesso. Bloqueie um usuário ou faça upgrade do plano.`,
    );
}

export const listarUsuarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as any);
    const escopo = await escopoUsuarios(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let consulta = supabaseAdmin
      .from("user_profiles")
      .select("id,user_id,nome,perfil,setor,bloqueado,foto_url,assinatura,ultimo_acesso,created_at,updated_at")
      .order("nome");
    // Empresas do modelo SaaS veem apenas os próprios usuários.
    if (escopo) consulta = consulta.in("user_id", escopo);
    const { data: perfis, error } = await consulta;
    if (error) throw new Error(error.message);

    const { data: auth } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const info = new Map(
      (auth?.users ?? []).map((u) => [
        u.id,
        { email: u.email ?? "", ultimoLogin: u.last_sign_in_at ?? null },
      ]),
    );
    return (perfis ?? []).map((p: any) => ({
      ...p,
      email: info.get(p.user_id)?.email ?? "",
      ultimo_login: info.get(p.user_id)?.ultimoLogin ?? null,
    }));
  });

/** Dados de governança: quem é o Proprietário do Sistema. */
export const dadosGovernanca = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,nome,setor,bloqueado,created_at,updated_at,ultimo_acesso")
      .eq("perfil", "proprietario")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const { data: conta } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const { data: ultima } = await supabaseAdmin
      .from("auditoria")
      .select("acao,detalhe,created_at")
      .eq("user_id", data.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      ...data,
      email: conta?.user?.email ?? "",
      ultimo_login: conta?.user?.last_sign_in_at ?? null,
      criado_em: conta?.user?.created_at ?? data.created_at,
      ultima_alteracao: ultima ?? null,
    };
  });

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { nome: string; email: string; senha: string; perfil: Perfil; setor: string }) => d,
  )
  .handler(async ({ data, context }) => {
    const perfilSolicitante = await exigirAdmin(context as any);
    if (data.perfil === "proprietario")
      throw new Error(
        "O Proprietário do Sistema é único e definido apenas pela transferência de propriedade",
      );
    if (nivelDe(data.perfil) > nivelDe(perfilSolicitante))
      throw new Error("Não é possível criar um usuário com nível acima do seu");
    await exigirLicencaDisponivel(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: criado, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome, perfil: data.perfil },
    });
    if (error) throw new Error(error.message);
    const uid = criado.user?.id;
    if (!uid) throw new Error("Não foi possível criar o usuário");
    await supabaseAdmin
      .from("user_profiles")
      .upsert(
        { user_id: uid, nome: data.nome, perfil: data.perfil, setor: data.setor },
        { onConflict: "user_id" },
      );

    // Novo usuário nasce vinculado à empresa de quem o criou (multiempresa).
    const { data: empresaId } = await (context as any).supabase.rpc("empresa_do_usuario", {
      _user_id: (context as any).userId,
    });
    if (empresaId) {
      await supabaseAdmin
        .from("empresa_usuarios")
        .upsert(
          { empresa_id: empresaId as string, user_id: uid, papel: "membro", ativo: true },
          { onConflict: "empresa_id,user_id" },
        );
    }
    return { ok: true };
  });


export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      nome?: string;
      perfil?: Perfil;
      setor?: string;
      bloqueado?: boolean;
      novaSenha?: string;
      fotoUrl?: string | null;
      assinatura?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const solicitante = (context as any).userId as string;
    const perfilSolicitante = await exigirAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await protegerProprietario(supabaseAdmin, data.userId, solicitante);
    await exigirMesmaEmpresa(context as any, data.userId);
    if (data.perfil === "proprietario")
      throw new Error(
        "Use a transferência de propriedade para definir o Proprietário do Sistema",
      );

    // Hierarquia: ninguém concede um nível acima do próprio nem altera contas
    // de nível superior ao seu (evita autopromoção a Super Administrador).
    const nivelSolicitante = nivelDe(perfilSolicitante);
    if (data.perfil !== undefined && nivelDe(data.perfil) > nivelSolicitante)
      throw new Error("Não é possível conceder um nível de acesso acima do seu");
    if (data.userId !== solicitante) {
      const { data: alvo } = await supabaseAdmin
        .from("user_profiles")
        .select("perfil")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (nivelDe(alvo?.perfil as Perfil | undefined) > nivelSolicitante)
        throw new Error("Não é possível alterar uma conta de nível superior ao seu");
    }


    // Liberar acesso consome uma licença do plano contratado.
    if (data.bloqueado === false) {
      const { data: atualAlvo } = await supabaseAdmin
        .from("user_profiles")
        .select("bloqueado")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (atualAlvo?.bloqueado) await exigirLicencaDisponivel(context as any);
    }

    const campos: {
      nome?: string;
      perfil?: string;
      setor?: string;
      bloqueado?: boolean;
      foto_url?: string | null;
      assinatura?: string | null;
    } = {};
    if (data.nome !== undefined) campos.nome = data.nome;
    if (data.perfil !== undefined) campos.perfil = data.perfil;
    if (data.setor !== undefined) campos.setor = data.setor;
    if (data.bloqueado !== undefined) campos.bloqueado = data.bloqueado;
    if (data.fotoUrl !== undefined) campos.foto_url = data.fotoUrl;
    if (data.assinatura !== undefined) campos.assinatura = data.assinatura;
    if (Object.keys(campos).length) {
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update(campos)
        .eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }

    if (data.bloqueado !== undefined) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        ban_duration: data.bloqueado ? "876000h" : "none",
      });
      if (error) throw new Error(error.message);
      if (data.bloqueado) await encerrar(supabaseAdmin, data.userId, "bloqueio");
    }

    if (data.novaSenha) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        password: data.novaSenha,
      });
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

/** Exclusão definitiva do usuário (perfil + conta de acesso). */
export const excluirUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    const solicitante = (context as any).userId as string;
    await exigirAdmin(context as any);
    if (data.userId === solicitante)
      throw new Error("Você não pode excluir o seu próprio usuário");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await protegerProprietario(supabaseAdmin, data.userId, solicitante);
    await exigirMesmaEmpresa(context as any, data.userId);
    await encerrar(supabaseAdmin, data.userId, "usuario_excluido");
    await supabaseAdmin.from("user_profiles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Transferência da propriedade do sistema: exige a senha do Proprietário atual,
 * rebaixa o Proprietário atual para Administrador e promove o novo usuário.
 */
export const transferirPropriedade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; senha: string }) => d)
  .handler(async ({ data, context }) => {
    const solicitante = (context as any).userId as string;
    await exigirProprietario(context as any);
    if (data.userId === solicitante)
      throw new Error("Este usuário já é o Proprietário do Sistema");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: atual } = await supabaseAdmin.auth.admin.getUserById(solicitante);
    const email = atual?.user?.email;
    if (!email) throw new Error("Não foi possível validar a sua conta");
    await conferirSenha(email, data.senha);

    const { data: alvo, error: erroAlvo } = await supabaseAdmin
      .from("user_profiles")
      .select("user_id,nome,bloqueado")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (erroAlvo) throw new Error(erroAlvo.message);
    if (!alvo) throw new Error("Usuário de destino não encontrado");
    if (alvo.bloqueado) throw new Error("O novo Proprietário não pode estar bloqueado");

    // Rebaixa primeiro para nunca existirem dois Proprietários simultâneos.
    const { error: erroRebaixa } = await supabaseAdmin
      .from("user_profiles")
      .update({ perfil: "administrador" })
      .eq("user_id", solicitante);
    if (erroRebaixa) throw new Error(erroRebaixa.message);

    const { error: erroPromove } = await supabaseAdmin
      .from("user_profiles")
      .update({ perfil: "proprietario" })
      .eq("user_id", data.userId);
    if (erroPromove) {
      await supabaseAdmin
        .from("user_profiles")
        .update({ perfil: "proprietario" })
        .eq("user_id", solicitante);
      throw new Error(erroPromove.message);
    }

    await supabaseAdmin.from("auditoria").insert({
      user_id: solicitante,
      usuario: email,
      nome: atual?.user?.user_metadata?.["nome"] ?? email,
      perfil: "proprietario",
      tipo_acao: "administracao",
      acao: "propriedade_transferida",
      detalhe: `Propriedade do sistema transferida para ${alvo.nome ?? data.userId}`,
      modulo: "ADMIN",
      resultado: "sucesso",
    });

    return { ok: true };
  });

/** Confirmação de senha do usuário logado antes de ações críticas. */
export const validarSenhaAtual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { senha: string; acao: string }) => d)
  .handler(async ({ data, context }) => {
    const solicitante = (context as any).userId as string;
    await exigirAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conta } = await supabaseAdmin.auth.admin.getUserById(solicitante);
    const email = conta?.user?.email;
    if (!email) throw new Error("Sessão inválida");
    await conferirSenha(email, data.senha);
    return { ok: true, acao: data.acao };
  });

/** Logout remoto: encerra as sessões registradas do usuário. */
export const encerrarSessoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; sessaoId?: string }) => d)
  .handler(async ({ data, context }) => {
    const solicitante = (context as any).userId as string;
    await exigirAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await protegerProprietario(supabaseAdmin, data.userId, solicitante);
    await exigirMesmaEmpresa(context as any, data.userId);
    await encerrar(supabaseAdmin, data.userId, "logout_remoto", data.sessaoId);
    return { ok: true };
  });

async function encerrar(admin: any, userId: string, motivo: string, sessaoId?: string) {
  let q = admin
    .from("sessoes_usuario")
    .update({ encerrada_em: new Date().toISOString(), motivo_encerramento: motivo })
    .eq("user_id", userId)
    .is("encerrada_em", null);
  if (sessaoId) q = q.eq("id", sessaoId);
  await q;
}
