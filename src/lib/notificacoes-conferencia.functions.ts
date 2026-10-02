import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NIVEL_ADMIN, temNivel, type Perfil } from "@/lib/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

/** Só administradores (e acima) podem disparar, reenviar ou diagnosticar e-mails. */
async function exigirAdmin(context: Ctx) {
  const { data, error } = await context.supabase
    .from("user_profiles")
    .select("perfil,bloqueado")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const perfil = data?.perfil as Perfil | undefined;
  if (data?.bloqueado || !temNivel(perfil, NIVEL_ADMIN))
    throw new Error("Acesso não autorizado");
}

/** Perfil do solicitante (ou undefined). */
async function perfilDe(context: Ctx): Promise<Perfil | undefined> {
  const { data } = await context.supabase
    .from("user_profiles")
    .select("perfil,bloqueado")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (data?.bloqueado) return undefined;
  return data?.perfil as Perfil | undefined;
}

/**
 * Envia o e-mail de uma notificação registrada. Administradores podem enviar
 * qualquer notificação; demais usuários apenas as suas próprias.
 */
export const enviarEmailNotificacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { notificacaoId: string; reenvio?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const perfil = await perfilDe(ctx);
    if (!perfil) throw new Error("Acesso não autorizado");
    if (!temNivel(perfil, NIVEL_ADMIN)) {
      // Reenvio manual é exclusivo de administradores.
      if (data.reenvio) throw new Error("Acesso não autorizado");
      const { data: notif } = await ctx.supabase
        .from("notificacoes_conferencia")
        .select("user_id")
        .eq("id", data.notificacaoId)
        .maybeSingle();
      if (!notif || notif.user_id !== ctx.userId) throw new Error("Acesso não autorizado");
    }
    const { enviarNotificacao } = await import("@/lib/notificacoes-email.server");
    return enviarNotificacao(data.notificacaoId, data.reenvio ?? false);
  });

/** Compatibilidade: envio do e-mail de início de conferência. */
export const enviarEmailInicioConferencia = enviarEmailNotificacao;

/** Reenvia todas as notificações cujo envio falhou ou ficou pendente. */
export const reenviarEmailsFalhados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { reenviarFalhas } = await import("@/lib/notificacoes-email.server");
    return reenviarFalhas();
  });

/** Envia um e-mail de teste para validar a configuração do servidor. */
export const enviarEmailTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { destino?: string }) => data)
  .handler(async ({ data, context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { enviarTeste } = await import("@/lib/notificacoes-email.server");
    return enviarTeste(data.destino ?? null);
  });

/** Diagnóstico do fluxo guiado de configuração do servidor de envio. */
export const diagnosticarConexaoEnvio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { diagnosticarEnvio } = await import("@/lib/notificacoes-email.server");
    return diagnosticarEnvio();
  });
