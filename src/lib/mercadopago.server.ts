/**
 * Integração com o Mercado Pago (somente servidor).
 * Nenhuma credencial trafega pelo navegador: o token de acesso fica no backend
 * e o cartão é informado apenas no checkout oficial do provedor.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const MP_BASE_URL = "https://api.mercadopago.com";

export type AmbienteCobranca = "sandbox" | "live";

/** Token de acesso do ambiente. Hoje somente credenciais de teste existem. */
export function getAccessToken(ambiente: AmbienteCobranca): string {
  const chave =
    ambiente === "sandbox" ? "MERCADOPAGO_TEST_ACCESS_TOKEN" : "MERCADOPAGO_ACCESS_TOKEN";
  const valor = process.env[chave];
  if (!valor) throw new Error(`${chave} não configurado`);
  return valor;
}

/** Erro HTTP do provedor, preservando o código para decisões de fluxo. */
export class ErroMercadoPago extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroMercadoPago";
  }
  /** Recurso inexistente (ex.: identificador fictício da simulação do painel). */
  get naoEncontrado() {
    return this.status === 404;
  }
}

export async function mpFetch<T>(
  ambiente: AmbienteCobranca,
  path: string,
  init?: RequestInit & { body?: string },
): Promise<T> {
  const resposta = await fetch(`${MP_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken(ambiente)}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new ErroMercadoPago(
      resposta.status,
      `Mercado Pago ${resposta.status}: ${texto.slice(0, 400)}`,
    );
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

export type Preapproval = {
  id: string;
  status: string;
  init_point?: string;
  sandbox_init_point?: string;
  preapproval_plan_id?: string;
  external_reference?: string;
  payer_id?: number;
  payer_email?: string;
  reason?: string;
  date_created?: string;
  last_modified?: string;
  next_payment_date?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
    free_trial?: { frequency?: number; frequency_type?: string } | null;
    start_date?: string;
    end_date?: string;
  };
  summarized?: { charged_quantity?: number | null; last_charged_date?: string | null };
};

/**
 * Cria a assinatura recorrente (preapproval) pendente e devolve o link oficial
 * de autorização. Os valores vêm sempre do plano gravado no banco — nunca do
 * frontend — e o cartão é informado apenas no ambiente do Mercado Pago.
 */
export async function criarPreapproval(
  ambiente: AmbienteCobranca,
  dados: {
    payerEmail: string;
    externalReference: string;
    backUrl: string;
    motivo: string;
    valorCentavos: number;
    periodicidade: "mensal" | "anual";
    moeda: string;
    diasTrial: number;
  },
): Promise<Preapproval> {
  const auto: Record<string, unknown> = {
    frequency: dados.periodicidade === "anual" ? 12 : 1,
    frequency_type: "months",
    transaction_amount: Number((dados.valorCentavos / 100).toFixed(2)),
    currency_id: dados.moeda || "BRL",
  };
  if (dados.diasTrial > 0) {
    auto["free_trial"] = { frequency: dados.diasTrial, frequency_type: "days" };
  }

  return mpFetch<Preapproval>(ambiente, "/preapproval", {
    method: "POST",
    body: JSON.stringify({
      payer_email: dados.payerEmail,
      external_reference: dados.externalReference,
      back_url: dados.backUrl,
      reason: dados.motivo,
      status: "pending",
      auto_recurring: auto,
    }),
  });
}

/** Identificadores gravados pelo servidor no external_reference. */
export function lerReferencia(ref?: string | null): {
  userId: string | null;
  planoCodigo: string | null;
} {
  const partes = (ref ?? "").split("|");
  let userId: string | null = null;
  let planoCodigo: string | null = null;
  for (const parte of partes) {
    if (parte.startsWith("user:")) userId = parte.slice(5) || null;
    if (parte.startsWith("plano:")) planoCodigo = parte.slice(6) || null;
  }
  return { userId, planoCodigo };
}

export function obterPreapproval(ambiente: AmbienteCobranca, id: string) {
  return mpFetch<Preapproval>(ambiente, `/preapproval/${encodeURIComponent(id)}`);
}

export type PagamentoAutorizado = {
  id: number | string;
  preapproval_id?: string;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
  payment?: { id?: number; status?: string; status_detail?: string };
  external_reference?: string;
};

export function obterPagamentoAutorizado(ambiente: AmbienteCobranca, id: string) {
  return mpFetch<PagamentoAutorizado>(
    ambiente,
    `/authorized_payments/${encodeURIComponent(id)}`,
  );
}

/** Cancela/pausa a assinatura no provedor. */
export function alterarStatusPreapproval(
  ambiente: AmbienteCobranca,
  id: string,
  status: "paused" | "authorized" | "cancelled",
) {
  return mpFetch<Preapproval>(ambiente, `/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

/** Tradução dos status do Mercado Pago para os status internos do aplicativo. */
export function statusInternoPreapproval(pre: Preapproval): string {
  switch (pre.status) {
    case "authorized": {
      const emTrial =
        Boolean(pre.auto_recurring?.free_trial) && !pre.summarized?.last_charged_date;
      return emTrial ? "trial" : "ativa";
    }
    case "paused":
      return "suspensa";
    case "cancelled":
      return "cancelada";
    case "pending":
    default:
      return "incompleta";
  }
}

/** Periodicidade interna a partir da recorrência do provedor. */
export function periodicidadeInterna(pre: Preapproval): string | null {
  const tipo = pre.auto_recurring?.frequency_type;
  const freq = pre.auto_recurring?.frequency ?? 1;
  if (tipo === "months") return freq >= 12 ? "anual" : "mensal";
  if (tipo === "days") return freq >= 365 ? "anual" : "mensal";
  return null;
}

/** Assinatura HMAC ausente ou inválida: a requisição é rejeitada (401/403). */
export class ErroAssinaturaWebhook extends Error {
  constructor(public readonly motivo: string) {
    super(`Assinatura do webhook rejeitada: ${motivo}`);
    this.name = "ErroAssinaturaWebhook";
  }
}

/**
 * Valida a assinatura HMAC (x-signature) da notificação. Obrigatória:
 * sem segredo configurado, ou com assinatura ausente/divergente, o evento é
 * rejeitado e nenhum dado é alterado (fail-closed).
 *
 * O Mercado Pago emite um segredo por configuração de webhook (produção e
 * teste podem ser diferentes). Por isso aceitamos o segredo de produção
 * (MERCADOPAGO_WEBHOOK_SECRET) e, se existir, o de teste
 * (MERCADOPAGO_TEST_WEBHOOK_SECRET) — ambos comparados em tempo constante.
 */
export function validarAssinaturaWebhook(
  req: Request,
  dataId: string | null,
): { ok: boolean; motivo?: string } {
  const segredos = [
    process.env["MERCADOPAGO_WEBHOOK_SECRET"],
    process.env["MERCADOPAGO_TEST_WEBHOOK_SECRET"],
  ].filter((s): s is string => Boolean(s));
  if (segredos.length === 0) return { ok: false, motivo: "segredo do webhook não configurado" };

  const assinatura = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
  if (!assinatura) return { ok: false, motivo: "cabeçalho x-signature ausente" };

  const partes = Object.fromEntries(
    assinatura.split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [(k ?? "").trim(), v.join("=").trim()];
    }),
  ) as { ts?: string; v1?: string };
  if (!partes.ts || !partes.v1) return { ok: false, motivo: "x-signature inválido" };

  const manifest =
    `${dataId ? `id:${dataId.toLowerCase()};` : ""}` +
    `${requestId ? `request-id:${requestId};` : ""}` +
    `ts:${partes.ts};`;
  const recebido = Buffer.from(partes.v1);
  const ok = segredos.some((secret) => {
    const esperado = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  });
  return ok ? { ok: true } : { ok: false, motivo: "assinatura divergente" };
}


/**
 * Garante que o retorno do checkout aponte para um domínio do próprio
 * aplicativo — evita redirecionamento para destinos controlados por terceiros.
 *
 * O Mercado Pago valida o `back_url` e recusa (400 invalid_field_content)
 * endereços de pré-visualização e endereços locais. Por isso apenas os domínios públicos oficiais são aceitos;
 * qualquer outra origem cai no domínio oficial do aplicativo.
 */
const ORIGENS_RETORNO_PERMITIDAS = ["conferenciarapida.com.br", "www.conferenciarapida.com.br"];

export function urlRetornoValida(origem: string): string {
  try {
    const url = new URL(origem);
    if (url.protocol === "https:" && ORIGENS_RETORNO_PERMITIDAS.includes(url.hostname)) {
      return url.origin;
    }
  } catch {
    /* origem inválida — usa o domínio oficial */
  }
  return "https://conferenciarapida.com.br";
}

/**
 * E-mail da conta que recebe os pagamentos (vendedor). O Mercado Pago não
 * permite que a mesma conta assine o próprio plano: nesse caso o botão
 * "Confirmar" do checkout aparece desabilitado. Guardamos em memória para não
 * repetir a consulta em cada checkout.
 */
const cacheEmailColetor = new Map<AmbienteCobranca, string | null>();

export async function emailContaCobranca(
  ambiente: AmbienteCobranca,
): Promise<string | null> {
  if (cacheEmailColetor.has(ambiente)) return cacheEmailColetor.get(ambiente) ?? null;
  try {
    const conta = await mpFetch<{ email?: string }>(ambiente, "/users/me");
    const email = (conta.email ?? "").trim().toLowerCase() || null;
    cacheEmailColetor.set(ambiente, email);
    return email;
  } catch {
    return null;
  }
}
