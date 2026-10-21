/**
 * O envio do e-mail chama o Teams logo depois, sempre (inclusive quando o e-mail não sai),
 * e uma falha do Teams nunca altera nem interrompe o resultado do e-mail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const teams = vi.hoisted(() => ({ chamadas: [] as string[], lancar: false }));

vi.mock("@/lib/teams-envio.server", () => ({
  enviarTeamsNotificacao: async (id: string) => {
    teams.chamadas.push(id);
    if (teams.lancar) throw new Error("fluxo fora do ar");
    return { ok: true, status: "enviado", erro: null };
  },
}));

// Banco simulado: notificação inexistente (o e-mail termina cedo, sem provedor).
vi.mock("@/integrations/supabase/client.server", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    supabaseAdmin: { from: () => consulta, rpc: async () => ({ data: null, error: null }) },
  };
});

beforeEach(() => {
  teams.chamadas = [];
  teams.lancar = false;
});

describe("e-mail + Teams", () => {
  it("o Teams é chamado para a mesma notificação, mesmo quando o e-mail não sai", async () => {
    const { enviarNotificacao } = await import("@/lib/notificacoes-email.server");
    const r = await enviarNotificacao("n-1");
    expect(r).toEqual({ ok: false, status: "falha", erro: "Notificação não encontrada" });
    expect(teams.chamadas).toEqual(["n-1"]);
  });

  it("falha do Teams não altera nem interrompe o resultado do e-mail", async () => {
    const { enviarNotificacao } = await import("@/lib/notificacoes-email.server");
    teams.lancar = true;
    const r = await enviarNotificacao("n-2", true);
    expect(r).toEqual({ ok: false, status: "falha", erro: "Notificação não encontrada" });
    expect(teams.chamadas).toEqual(["n-2"]);
  });
});
