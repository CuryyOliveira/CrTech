/**
 * Sincronização da assinatura com o Mercado Pago (somente servidor).
 * A verdade é sempre o recurso lido na API oficial do provedor — nenhum valor,
 * plano ou status enviado pelo navegador é aceito.
 */
import {
  obterPreapproval,
  periodicidadeInterna,
  statusInternoPreapproval,
  type AmbienteCobranca,
  type Preapproval,
} from "@/lib/mercadopago.server";

export type AssinaturaSincronizada = {
  status: string;
  plano_codigo: string | null;
  valor_centavos: number | null;
  moeda: string;
  periodicidade: string | null;
  data_inicio: string | null;
  periodo_atual_inicio: string | null;
  periodo_atual_fim: string | null;
  proxima_cobranca: string | null;
  trial_inicio: string | null;
  trial_fim: string | null;
  cancelada_em: string | null;
  cancelar_no_fim_periodo: boolean;
};

/**
 * Grava no banco o estado autoritativo do provedor para a assinatura indicada.
 * Retorna os campos aplicados (já normalizados).
 *
 * Regras de período: o ciclo vigente (`periodo_atual_inicio/fim`) é derivado da
 * última cobrança e da próxima cobrança informadas pelo Mercado Pago. Quando o
 * provedor deixa de informar essas datas (por exemplo, após o cancelamento),
 * preservamos o que já estava gravado — é isso que garante o uso até o fim do
 * período já pago. Datas de teste (trial) nunca são apagadas depois de gravadas.
 */
export async function sincronizarPreapprovalNoBanco(
  ambiente: AmbienteCobranca,
  assinaturaId: string,
  preapprovalId: string,
  planoCodigoAtual: string | null,
): Promise<AssinaturaSincronizada> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: anterior } = await supabaseAdmin
    .from("assinaturas")
    .select(
      "periodo_atual_inicio, periodo_atual_fim, proxima_cobranca, trial_inicio, trial_fim, cancelada_em",
    )
    .eq("id", assinaturaId)
    .maybeSingle();

  const pre: Preapproval = await obterPreapproval(ambiente, preapprovalId);
  const status = statusInternoPreapproval(pre);
  const valor = pre.auto_recurring?.transaction_amount;
  const inicio = pre.auto_recurring?.start_date ?? pre.date_created ?? null;
  const emTrial = status === "trial";
  const agora = new Date().toISOString();

  const ultimaCobranca = pre.summarized?.last_charged_date ?? null;
  const proxima = pre.next_payment_date ?? null;
  const periodoInicio =
    ultimaCobranca ?? (anterior?.periodo_atual_inicio as string | null) ?? inicio;
  const periodoFim =
    proxima ??
    (anterior?.periodo_atual_fim as string | null) ??
    (anterior?.proxima_cobranca as string | null) ??
    null;

  const campos: AssinaturaSincronizada = {
    status,
    plano_codigo: planoCodigoAtual,
    valor_centavos: typeof valor === "number" ? Math.round(valor * 100) : null,
    moeda: pre.auto_recurring?.currency_id ?? "BRL",
    periodicidade: periodicidadeInterna(pre),
    data_inicio: inicio,
    periodo_atual_inicio: periodoInicio,
    periodo_atual_fim: periodoFim,
    proxima_cobranca: status === "cancelada" ? null : proxima,
    trial_inicio: emTrial ? inicio : ((anterior?.trial_inicio as string | null) ?? null),
    trial_fim: emTrial ? proxima : ((anterior?.trial_fim as string | null) ?? null),
    cancelada_em:
      status === "cancelada"
        ? ((anterior?.cancelada_em as string | null) ?? agora)
        : null,
    // Cancelou, mas ainda existe período pago em curso: o acesso continua até lá.
    cancelar_no_fim_periodo:
      status === "cancelada" && Boolean(periodoFim) && new Date(periodoFim!) > new Date(),
  };

  const { error } = await supabaseAdmin
    .from("assinaturas")
    .update({
      ...campos,
      // A assinatura só é encerrada de fato quando o período pago termina.
      encerrada_em:
        status === "cancelada" && !campos.cancelar_no_fim_periodo ? agora : null,
      ultimo_evento_em: pre.last_modified ?? pre.date_created ?? agora,
      updated_at: agora,
    })
    .eq("id", assinaturaId);
  if (error) throw new Error(`Falha ao atualizar a assinatura: ${error.message}`);

  return campos;
}


/** Altera o valor/periodicidade da assinatura recorrente já autorizada. */
export async function atualizarValorPreapproval(
  ambiente: AmbienteCobranca,
  preapprovalId: string,
  dados: {
    valorCentavos: number;
    periodicidade: "mensal" | "anual";
    moeda: string;
    motivo: string;
    externalReference: string;
  },
): Promise<Preapproval> {
  const { mpFetch } = await import("@/lib/mercadopago.server");
  return mpFetch<Preapproval>(ambiente, `/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: "PUT",
    body: JSON.stringify({
      reason: dados.motivo,
      external_reference: dados.externalReference,
      auto_recurring: {
        frequency: dados.periodicidade === "anual" ? 12 : 1,
        frequency_type: "months",
        transaction_amount: Number((dados.valorCentavos / 100).toFixed(2)),
        currency_id: dados.moeda || "BRL",
      },
    }),
  });
}
