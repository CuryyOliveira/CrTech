/**
 * FASE 0 — Cadastro dos destinatários de WhatsApp da empresa.
 *
 * Nenhum envio acontece aqui: são apenas operações de cadastro. A empresa
 * NUNCA vem do frontend — é resolvida no servidor a partir da sessão, e todas
 * as operações exigem perfil administrativo.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NIVEL_ADMIN, temNivel, type Perfil } from "@/lib/permissions";
import {
  MAX_DESTINATARIOS_WHATSAPP,
  normalizarTelefone,
  type DestinatarioWhatsapp,
} from "@/lib/whatsapp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

/** Garante perfil administrativo e devolve a empresa do usuário autenticado. */
async function empresaAdministrada(context: Ctx): Promise<string> {
  const { data: perfilRow, error } = await context.supabase
    .from("user_profiles")
    .select("perfil,bloqueado")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const perfil = perfilRow?.perfil as Perfil | undefined;
  if (perfilRow?.bloqueado || !temNivel(perfil, NIVEL_ADMIN))
    throw new Error("Acesso não autorizado");

  const { data: empresaId } = await context.supabase.rpc("empresa_do_usuario", {
    _user_id: context.userId,
  });
  if (!empresaId) throw new Error("Nenhuma empresa vinculada a este usuário.");
  return empresaId as string;
}

/** Lista os destinatários da própria empresa. */
export const listarDestinatariosWhatsapp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);
    const { data, error } = await ctx.supabase
      .from("empresa_whatsapp_destinatarios")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as DestinatarioWhatsapp[];
  });

type Entrada = {
  id?: string | null;
  nome: string;
  telefone: string;
  ativo?: boolean;
  receber_inicio_conferencia?: boolean;
  receber_conclusao_conferencia?: boolean;
};

function validar(data: Entrada) {
  const nome = (data.nome ?? "").trim();
  if (nome.length < 2) throw new Error("Informe o nome do destinatário.");
  if (nome.length > 80) throw new Error("O nome do destinatário é muito longo.");
  const telefone_normalizado = normalizarTelefone(data.telefone);
  if (!telefone_normalizado)
    throw new Error("Número inválido. Use DDD + número, ex.: (17) 99999-9999.");
  return {
    id: data.id ?? null,
    nome,
    telefone: (data.telefone ?? "").trim().slice(0, 40),
    telefone_normalizado,
    ativo: data.ativo ?? true,
    receber_inicio_conferencia: data.receber_inicio_conferencia ?? true,
    receber_conclusao_conferencia: data.receber_conclusao_conferencia ?? true,
  };
}

function traduzirErro(mensagem: string) {
  if (/uq_wa_dest_empresa_telefone|duplicate key/i.test(mensagem))
    return "Este número já está cadastrado.";
  if (/Limite de 5/i.test(mensagem)) return "Limite de 5 números atingido.";
  return mensagem;
}

/** Cria ou atualiza um destinatário da própria empresa. */
export const salvarDestinatarioWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Entrada) => validar(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);

    const campos = {
      nome: data.nome,
      telefone: data.telefone,
      telefone_normalizado: data.telefone_normalizado,
      ativo: data.ativo,
      receber_inicio_conferencia: data.receber_inicio_conferencia,
      receber_conclusao_conferencia: data.receber_conclusao_conferencia,
    };

    if (data.id) {
      const { error } = await ctx.supabase
        .from("empresa_whatsapp_destinatarios")
        .update(campos)
        .eq("id", data.id)
        .eq("empresa_id", empresaId);
      if (error) throw new Error(traduzirErro(error.message));
      return { ok: true, id: data.id };
    }

    // Limite também é garantido por trigger no banco; aqui só antecipamos a mensagem.
    const { count } = await ctx.supabase
      .from("empresa_whatsapp_destinatarios")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("ativo", true);
    if ((count ?? 0) >= MAX_DESTINATARIOS_WHATSAPP && data.ativo)
      throw new Error("Limite de 5 números atingido.");

    const { data: criado, error } = await ctx.supabase
      .from("empresa_whatsapp_destinatarios")
      .insert({ ...campos, empresa_id: empresaId, created_by: ctx.userId })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(traduzirErro(error.message));
    return { ok: true, id: (criado as { id: string } | null)?.id ?? null };
  });

/** Ativa ou desativa um destinatário da própria empresa. */
export const alternarDestinatarioWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; ativo: boolean }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);
    const { error } = await ctx.supabase
      .from("empresa_whatsapp_destinatarios")
      .update({ ativo: data.ativo })
      .eq("id", data.id)
      .eq("empresa_id", empresaId);
    if (error) throw new Error(traduzirErro(error.message));
    return { ok: true };
  });

/** Exclui um destinatário da própria empresa. */
export const excluirDestinatarioWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);
    const { error } = await ctx.supabase
      .from("empresa_whatsapp_destinatarios")
      .delete()
      .eq("id", data.id)
      .eq("empresa_id", empresaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Dispara o WhatsApp de uma notificação já registrada (início ou conclusão).
 * A empresa e os números vêm sempre do servidor; o cliente só informa o ID.
 */
export const dispararWhatsappNotificacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { notificacaoId: string }) => {
    if (!data?.notificacaoId) throw new Error("Notificação inválida.");
    return { notificacaoId: data.notificacaoId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    // Quem não é administrador só dispara as notificações que ele mesmo gerou.
    const { data: perfilRow } = await ctx.supabase
      .from("user_profiles")
      .select("perfil,bloqueado")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (perfilRow?.bloqueado) throw new Error("Acesso não autorizado");
    const admin = temNivel(perfilRow?.perfil as Perfil | undefined, NIVEL_ADMIN);
    if (!admin) {
      const { data: notif } = await ctx.supabase
        .from("notificacoes_conferencia")
        .select("user_id")
        .eq("id", data.notificacaoId)
        .maybeSingle();
      if (!notif || notif.user_id !== ctx.userId) throw new Error("Acesso não autorizado");
    }
    const { data: empresaId } = await ctx.supabase.rpc("empresa_do_usuario", {
      _user_id: ctx.userId,
    });
    const { enviarWhatsappNotificacao } = await import("@/lib/whatsapp-envio.server");
    return enviarWhatsappNotificacao(data.notificacaoId, (empresaId as string | null) ?? null);
  });

/** Reenvia as mensagens pendentes ou com erro da própria empresa (admin). */
export const reenviarWhatsappPendentesEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);
    const { reenviarWhatsappPendentes } = await import("@/lib/whatsapp-envio.server");
    return reenviarWhatsappPendentes(empresaId);
  });

/** Últimos envios de WhatsApp da empresa, para acompanhamento na Central. */
export const listarEnviosWhatsapp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const empresaId = await empresaAdministrada(ctx);
    const { data, error } = await ctx.supabase
      .from("whatsapp_notificacoes")
      .select("id, tipo_evento, status, telefone_mascarado, erro, sent_at, created_at")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      id: string;
      tipo_evento: string;
      status: string;
      telefone_mascarado: string | null;
      erro: string | null;
      sent_at: string | null;
      created_at: string;
    }[];
  });
