/**
 * Webhook do Mercado Pago: ambiente da notificação (`live_mode`) e idempotência.
 *
 * As notificações de assinatura (`subscription_preapproval`) não trazem `live_mode`: devem usar
 * o ambiente configurado no sistema (em produção, "live" → token de produção). Banco e API do
 * provedor são simulados em memória; os tokens aqui são valores fictícios de teste.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ambienteDaNotificacao } from "@/lib/mercadopago.server";

// ---------- Ambiente configurado (VITE_COBRANCA_AMBIENTE) ----------
const config = vi.hoisted(() => ({ ambiente: "live" as "live" | "sandbox" }));
vi.mock("@/lib/cobranca", () => ({ ambienteCobranca: () => config.ambiente }));

// ---------- Rota: só precisamos do handler ----------
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opcoes: unknown) => opcoes,
}));

// ---------- Banco em memória (com as mesmas chaves únicas da produção) ----------
type Linha = Record<string, unknown>;
const banco = vi.hoisted(() => ({ tabelas: {} as Record<string, Record<string, unknown>[]> }));
// Padrões das colunas (como no banco real).
const PADROES: Record<string, Linha> = { webhook_eventos_pagamento: { processado: false } };
const UNICAS: Record<string, string[]> = {
  webhook_eventos_pagamento: ["provider", "provider_event_id"],
  assinaturas: ["provider_subscription_id"],
  assinatura_pagamentos: ["provider_transaction_id", "status"],
};

function tabela(nome: string): Linha[] {
  return (banco.tabelas[nome] ??= []);
}

function consulta(nome: string) {
  const filtros: ((l: Linha) => boolean)[] = [];
  let operacao: { tipo: "select" } | { tipo: "update"; valores: Linha } = { tipo: "select" };
  let unico = false;
  const executar = () => {
    const linhas = tabela(nome).filter((l) => filtros.every((f) => f(l)));
    if (operacao.tipo === "update") {
      for (const l of linhas) Object.assign(l, operacao.valores);
      return { data: null, error: null };
    }
    return { data: unico ? (linhas[0] ?? null) : linhas, error: null };
  };
  const q = {
    select: () => q,
    update: (valores: Linha) => ((operacao = { tipo: "update", valores }), q),
    eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
    is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
    maybeSingle: () => ((unico = true), Promise.resolve(executar())),
    then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(executar()).then(ok, falha),
    insert: (linha: Linha) => {
      const chave = UNICAS[nome] ?? [];
      if (chave.length && tabela(nome).some((l) => chave.every((c) => l[c] === linha[c]))) {
        return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
      }
      tabela(nome).push({ id: `${nome}-${tabela(nome).length + 1}`, ...PADROES[nome], ...linha });
      return Promise.resolve({ error: null });
    },
    upsert: (linha: Linha, opcoes: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const chave = opcoes.onConflict.split(",");
      const existente = tabela(nome).find((l) => chave.every((c) => l[c] === linha[c]));
      if (existente) {
        if (!opcoes.ignoreDuplicates) Object.assign(existente, linha);
      } else {
        tabela(nome).push({ id: `${nome}-${tabela(nome).length + 1}`, ...linha });
      }
      return Promise.resolve({ error: null });
    },
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (nome: string) => consulta(nome),
    rpc: async (fn: string, args: { _user_id?: string }) =>
      fn === "empresa_do_usuario" && args._user_id === "usuario-1"
        ? { data: "empresa-1", error: null }
        : { data: null, error: null },
  }),
}));

// ---------- API do Mercado Pago simulada ----------
const TOKEN_LIVE = "token-ficticio-producao";
const TOKEN_TESTE = "token-ficticio-teste";
const SEGREDO = "segredo-ficticio-webhook";
const PREAPPROVAL = "d8f44368282d4957ae753f39368c9fe9";

let statusPreapproval = "authorized";
const chamadas: { url: string; token: string }[] = [];

function preapproval() {
  return {
    id: PREAPPROVAL,
    status: statusPreapproval,
    external_reference: "user:usuario-1|plano:essencial_mensal",
    payer_id: 123,
    date_created: "2026-10-05T23:42:00.000Z",
    last_modified: "2026-10-05T23:42:58.000Z",
    next_payment_date: "2026-10-19T23:42:00.000Z",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 79,
      currency_id: "BRL",
      free_trial: { frequency: 14, frequency_type: "days" },
      start_date: "2026-10-05T23:42:00.000Z",
    },
    summarized: { last_charged_date: null },
  };
}

function respostaMp(url: string): Response {
  if (url.includes(`/preapproval/${PREAPPROVAL}`)) return Response.json(preapproval());
  if (url.includes("/authorized_payments/777")) {
    return Response.json({
      id: 777,
      preapproval_id: PREAPPROVAL,
      status: "processed",
      transaction_amount: 79,
      currency_id: "BRL",
      date_created: "2026-10-19T23:42:00.000Z",
      external_reference: "user:usuario-1|plano:essencial_mensal",
      payment: { id: 999, status: "approved" },
    });
  }
  return new Response("not found", { status: 404 });
}

// ---------- Utilidades ----------
function assinar(dataId: string, requestId: string, ts = "1759707778") {
  const v1 = createHmac("sha256", SEGREDO)
    .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return `ts=${ts},v1=${v1}`;
}

function notificacao(corpo: Record<string, unknown>, opcoes: { assinatura?: string } = {}) {
  const dataId = String((corpo.data as { id: string }).id);
  return new Request("https://conferenciarapida.com.br/api/public/payments/mercadopago", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-1",
      "x-signature": opcoes.assinatura ?? assinar(dataId, "req-1"),
    },
    body: JSON.stringify(corpo),
  });
}

/** Igual ao que chegou em produção: sem `live_mode`. */
function eventoAssinatura(extra: Record<string, unknown> = {}) {
  return {
    id: 40295832985015280,
    type: "subscription_preapproval",
    action: "updated",
    entity: "preapproval",
    data: { id: PREAPPROVAL },
    ...extra,
  };
}

type Handler = (ctx: { request: Request }) => Promise<Response>;
let POST: Handler;

async function enviar(corpo: Record<string, unknown>, opcoes?: { assinatura?: string }) {
  return POST({ request: notificacao(corpo, opcoes) });
}

const eventos = () => tabela("webhook_eventos_pagamento");
const assinaturas = () => tabela("assinaturas");

beforeEach(async () => {
  banco.tabelas = {
    planos: [
      { id: "plano-live", codigo: "essencial_mensal", ambiente: "live", dias_trial: 14 },
      { id: "plano-sandbox", codigo: "essencial_mensal", ambiente: "sandbox", dias_trial: 14 },
    ],
  };
  config.ambiente = "live";
  statusPreapproval = "authorized";
  chamadas.length = 0;
  vi.stubEnv("SUPABASE_URL", "http://supabase.teste");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "chave-ficticia");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SEGREDO);
  vi.stubEnv("MERCADOPAGO_TEST_WEBHOOK_SECRET", "");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", TOKEN_LIVE);
  vi.stubEnv("MERCADOPAGO_TEST_ACCESS_TOKEN", "");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    chamadas.push({ url, token: auth.replace(/^Bearer /, "") });
    return respostaMp(url);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const mod = (await import("@/routes/api/public/payments/mercadopago")) as unknown as {
    Route: { server: { handlers: { POST: Handler } } };
  };
  POST = mod.Route.server.handlers.POST;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ambienteDaNotificacao", () => {
  it("live_mode decide quando presente; ausente → ambiente configurado", () => {
    expect(ambienteDaNotificacao(true, "sandbox")).toBe("live");
    expect(ambienteDaNotificacao(false, "live")).toBe("sandbox");
    expect(ambienteDaNotificacao(undefined, "live")).toBe("live");
    expect(ambienteDaNotificacao(undefined, "sandbox")).toBe("sandbox");
    // Valores que não são booleanos não decidem nada.
    expect(ambienteDaNotificacao("true", "sandbox")).toBe("sandbox");
    expect(ambienteDaNotificacao(null, "live")).toBe("live");
  });
});

describe("webhook: ambiente e token usados", () => {
  it("live_mode: true → token de produção e assinatura live", async () => {
    const r = await enviar(eventoAssinatura({ live_mode: true }));
    expect(r.status).toBe(200);
    expect(chamadas.map((c) => c.token)).toEqual([TOKEN_LIVE]);
    expect(assinaturas()).toHaveLength(1);
    expect(assinaturas()[0]).toMatchObject({
      ambiente: "live",
      status: "trial",
      plano_id: "plano-live",
      empresa_id: "empresa-1",
    });
    expect(eventos()[0]).toMatchObject({ ambiente: "live", processado: true });
  });

  it("live_mode: false → continua sandbox (token de teste), mesmo com o sistema em live", async () => {
    vi.stubEnv("MERCADOPAGO_TEST_ACCESS_TOKEN", TOKEN_TESTE);
    const r = await enviar(eventoAssinatura({ live_mode: false }));
    expect(r.status).toBe(200);
    expect(chamadas.map((c) => c.token)).toEqual([TOKEN_TESTE]);
    expect(assinaturas()[0]).toMatchObject({ ambiente: "sandbox", plano_id: "plano-sandbox" });
  });

  it("live_mode: false sem token de teste → falha como antes (nunca cai no token de produção)", async () => {
    const r = await enviar(eventoAssinatura({ live_mode: false }));
    expect(r.status).toBe(400);
    expect(chamadas).toHaveLength(0);
    expect(assinaturas()).toHaveLength(0);
    expect(eventos()[0]).toMatchObject({
      ambiente: "sandbox",
      processado: false,
      erro: "MERCADOPAGO_TEST_ACCESS_TOKEN não configurado",
    });
  });

  it("sem live_mode com o sistema em live → token de produção (caso real de produção)", async () => {
    const r = await enviar(eventoAssinatura());
    expect(r.status).toBe(200);
    expect(chamadas.map((c) => c.token)).toEqual([TOKEN_LIVE]);
    expect(assinaturas()[0]).toMatchObject({ ambiente: "live", status: "trial" });
    expect(eventos()[0]).toMatchObject({ ambiente: "live", processado: true });
  });

  it("sem live_mode com o sistema em sandbox → token de teste", async () => {
    config.ambiente = "sandbox";
    vi.stubEnv("MERCADOPAGO_TEST_ACCESS_TOKEN", TOKEN_TESTE);
    const r = await enviar(eventoAssinatura());
    expect(r.status).toBe(200);
    expect(chamadas.map((c) => c.token)).toEqual([TOKEN_TESTE]);
    expect(assinaturas()[0]).toMatchObject({ ambiente: "sandbox" });
  });

  it("assinatura HMAC inválida continua rejeitada antes de qualquer gravação", async () => {
    const r = await enviar(eventoAssinatura(), { assinatura: "ts=1,v1=errado" });
    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
    expect(assinaturas()).toHaveLength(0);
  });

  it("nenhum token aparece nos logs", async () => {
    await enviar(eventoAssinatura({ live_mode: false })); // falha (sem token de teste)
    await enviar(eventoAssinatura({ id: 2 })); // sucesso (live)
    const logs = [console.log, console.warn, console.error]
      .flatMap((f) => vi.mocked(f).mock.calls)
      .map((args) => JSON.stringify(args, (_k, v) => (v instanceof Error ? v.message : v)))
      .join("\n");
    expect(logs).not.toContain(TOKEN_LIVE);
    expect(logs).not.toContain(SEGREDO);
  });
});

describe("webhook: reenvios não duplicam nada", () => {
  it("mesma notificação reenviada após sucesso: um evento, uma assinatura, sem nova consulta", async () => {
    expect((await enviar(eventoAssinatura())).status).toBe(200);
    expect((await enviar(eventoAssinatura())).status).toBe(200);
    expect(eventos()).toHaveLength(1);
    expect(assinaturas()).toHaveLength(1);
    expect(chamadas).toHaveLength(1);
  });

  it("evento gravado antes como sandbox com erro (cenário de produção) → reenvio processa como live", async () => {
    eventos().push({
      id: "evento-antigo",
      provider: "mercadopago",
      provider_event_id: `subscription_preapproval:${PREAPPROVAL}:updated:40295832985015280`,
      event_type: "subscription_preapproval",
      ambiente: "sandbox",
      processado: false,
      erro: "MERCADOPAGO_TEST_ACCESS_TOKEN não configurado",
    });
    const r = await enviar(eventoAssinatura());
    expect(r.status).toBe(200);
    expect(eventos()).toHaveLength(1);
    expect(eventos()[0]).toMatchObject({ ambiente: "live", processado: true });
    expect(assinaturas()).toHaveLength(1);
    expect(assinaturas()[0]).toMatchObject({ ambiente: "live", status: "trial" });
    expect(chamadas.map((c) => c.token)).toEqual([TOKEN_LIVE]);
  });

  it("duas notificações diferentes da mesma assinatura (chegam juntas) → uma assinatura", async () => {
    const [a, b] = await Promise.all([
      enviar(eventoAssinatura({ id: 40295829847722744 })),
      enviar(eventoAssinatura({ id: 40295832985015280 })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(eventos()).toHaveLength(2);
    expect(assinaturas()).toHaveLength(1);
  });

  it("cobrança reenviada → um único registro de pagamento", async () => {
    const cobranca = {
      id: 555,
      type: "subscription_authorized_payment",
      action: "created",
      data: { id: "777" },
    };
    expect((await enviar(cobranca)).status).toBe(200);
    expect((await enviar({ ...cobranca, id: 556 })).status).toBe(200);
    const pagamentos = tabela("assinatura_pagamentos");
    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0]).toMatchObject({ ambiente: "live", status: "aprovado" });
    expect(assinaturas()).toHaveLength(1);
    expect(chamadas.every((c) => c.token === TOKEN_LIVE)).toBe(true);
  });

  it("assinatura ainda pendente no provedor não libera acesso (status incompleta)", async () => {
    statusPreapproval = "pending";
    expect((await enviar(eventoAssinatura())).status).toBe(200);
    expect(assinaturas()[0]).toMatchObject({ ambiente: "live", status: "incompleta" });
  });
});
