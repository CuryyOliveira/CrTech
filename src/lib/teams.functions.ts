/**
 * Microsoft Teams: funções do servidor usadas pela aba da Administração do Sistema.
 * Somente administradores (e acima). O endereço do fluxo nunca é devolvido ao navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exigirAdmin } from "@/lib/notificacoes-conferencia.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

/** Situação do canal: endereço mascarado, destinatários, validação e últimos envios. */
export const obterStatusTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { statusTeams } = await import("@/lib/teams-envio.server");
    return statusTeams();
  });

/** Salva endereço do fluxo (opcional), destinatários e ativação. */
export const salvarTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { webhookUrl?: string | null; destinatarios?: string[]; ativo?: boolean }) => data,
  )
  .handler(async ({ data, context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { salvarConfigTeams } = await import("@/lib/teams-envio.server");
    return salvarConfigTeams(data);
  });

/** Envia um card de teste; aprovado, libera os disparos automáticos. */
export const testarTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { destino?: string }) => data)
  .handler(async ({ data, context }) => {
    await exigirAdmin(context as unknown as Ctx);
    const { testarConexaoTeams } = await import("@/lib/teams-envio.server");
    return testarConexaoTeams(data.destino ?? null);
  });
