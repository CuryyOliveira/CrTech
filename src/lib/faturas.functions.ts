/**
 * Faturas e recibos do próprio cliente.
 * Os registros vêm de `assinatura_pagamentos`, alimentada exclusivamente pelo
 * webhook oficial do Mercado Pago (payload já validado por HMAC e reconsultado
 * na API do provedor). O aplicativo nunca cria nem altera cobranças.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  empresaDoUsuario,
  exigirAdministrador,
  type ContextoAuth,
} from "@/lib/assinatura-gestao.server";

export type AmbienteCobranca = "sandbox" | "live";

export type Fatura = {
  id: string;
  status: string;
  valorCentavos: number | null;
  moeda: string;
  ocorridoEm: string;
  provedorTransacao: string | null;
  numeroFatura: string | null;
  motivoFalha: string | null;
  urlRecibo: string | null;
  meioPagamento: string | null;
  descricao: string | null;
};

type LinhaPagamento = {
  id: string;
  status: string;
  valor_centavos: number | null;
  moeda: string | null;
  ocorrido_em: string;
  provider_transaction_id: string | null;
  provider_invoice_numero: string | null;
  motivo_falha: string | null;
  url_recibo: string | null;
  payload: Record<string, unknown> | null;
};

/** Extrai o meio de pagamento do payload original do provedor (somente leitura). */
function meioPagamento(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const pagamento = (payload["payment"] as Record<string, unknown> | undefined) ?? payload;
  const metodo = pagamento["payment_method_id"] ?? pagamento["payment_type_id"];
  const bandeira = pagamento["payment_method_id"];
  const ultimos = (
    (pagamento["card"] as Record<string, unknown> | undefined)?.["last_four_digits"] ?? null
  ) as string | null;
  const base = typeof metodo === "string" ? metodo : typeof bandeira === "string" ? bandeira : null;
  if (!base) return null;
  return ultimos ? `${base} •••• ${ultimos}` : base;
}

function descricao(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const pagamento = (payload["payment"] as Record<string, unknown> | undefined) ?? payload;
  const texto = pagamento["description"] ?? pagamento["reason"] ?? payload["reason"];
  return typeof texto === "string" && texto.trim() ? texto.trim() : null;
}

function recibo(linha: LinhaPagamento): string | null {
  if (linha.url_recibo) return linha.url_recibo;
  const payload = linha.payload ?? null;
  if (!payload) return null;
  const pagamento = (payload["payment"] as Record<string, unknown> | undefined) ?? payload;
  const url =
    pagamento["receipt_url"] ??
    (pagamento["transaction_details"] as Record<string, unknown> | undefined)?.[
      "external_resource_url"
    ];
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/**
 * Histórico de cobranças da empresa do usuário autenticado.
 * A empresa é resolvida no servidor e as políticas do banco garantem que
 * ninguém veja pagamentos de outra empresa.
 */
export const minhasFaturas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => ({
    ambiente: data.ambiente === "live" ? ("live" as const) : ("sandbox" as const),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ContextoAuth;
    await exigirAdministrador(ctx);

    const empresaId = await empresaDoUsuario(ctx);
    if (!empresaId) {
      return { empresaId: null, faturas: [] as Fatura[], totalPagoCentavos: 0, moeda: "BRL" };
    }

    const { data: linhas, error } = await ctx.supabase
      .from("assinatura_pagamentos")
      .select(
        "id, status, valor_centavos, moeda, ocorrido_em, provider_transaction_id, provider_invoice_numero, motivo_falha, url_recibo, payload",
      )
      .eq("empresa_id", empresaId)
      .eq("ambiente", data.ambiente)
      .order("ocorrido_em", { ascending: false })
      .limit(120);
    if (error) throw new Error("Não foi possível carregar as faturas.");

    const faturas: Fatura[] = ((linhas ?? []) as LinhaPagamento[]).map((l) => ({
      id: l.id,
      status: l.status,
      valorCentavos: l.valor_centavos,
      moeda: l.moeda ?? "BRL",
      ocorridoEm: l.ocorrido_em,
      provedorTransacao: l.provider_transaction_id,
      numeroFatura: l.provider_invoice_numero,
      motivoFalha: l.motivo_falha,
      urlRecibo: recibo(l),
      meioPagamento: meioPagamento(l.payload),
      descricao: descricao(l.payload),
    }));

    const totalPagoCentavos = faturas
      .filter((f) => f.status === "aprovado")
      .reduce((soma, f) => soma + (f.valorCentavos ?? 0), 0);

    return {
      empresaId,
      faturas,
      totalPagoCentavos,
      moeda: faturas[0]?.moeda ?? "BRL",
    };
  });
