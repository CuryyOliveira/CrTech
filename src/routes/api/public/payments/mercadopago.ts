/**
 * Webhook do Mercado Pago (assinaturas).
 * Rota pública obrigatória — o provedor não envia sessão. Segurança:
 * validação HMAC da notificação (quando o segredo está configurado) +
 * releitura obrigatória do recurso na API oficial + registro idempotente.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ambienteCobranca } from "@/lib/cobranca";
import {
  ambienteDaNotificacao,
  obterPagamentoAutorizado,
  obterPreapproval,
  periodicidadeInterna,
  statusInternoPreapproval,
  lerReferencia,
  validarAssinaturaWebhook,
  ErroMercadoPago,
  ErroAssinaturaWebhook,
  type AmbienteCobranca,
  type Preapproval,
} from "@/lib/mercadopago.server";

const PROVIDER = "mercadopago";

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

/** Falha silenciosa nunca é aceitável: toda gravação é verificada. */
function exigirSucesso(contexto: string, erro: { message?: string } | null) {
  if (erro) throw new Error(`${contexto}: ${erro.message ?? "erro desconhecido"}`);
}

async function auditar(acao: string, detalhe: string, empresaId?: string | null) {
  const { error } = await getSupabase().from("auditoria").insert({
    usuario: "webhook-mercadopago",
    nome: "Mercado Pago",
    perfil: "sistema",
    acao,
    detalhe,
    tipo_acao: "cobranca",
    modulo: "assinaturas",
    resultado: "sucesso",
    lista: empresaId ?? null,
  });
  exigirSucesso("Falha ao registrar auditoria da cobrança", error);
}

/**
 * A empresa é resolvida exclusivamente a partir do usuário autenticado no
 * momento do checkout (external_reference gravado pelo servidor).
 */
async function resolverEmpresa(externalReference?: string | null): Promise<string | null> {
  const { userId } = lerReferencia(externalReference);
  if (!userId) return null;
  const { data } = await getSupabase().rpc("empresa_do_usuario", { _user_id: userId });
  return typeof data === "string" && data ? data : null;
}

/** Eventos podem chegar fora de ordem: só aplicamos o mais recente. */
async function eventoMaisRecente(
  preapprovalId: string,
  ambiente: AmbienteCobranca,
  ocorridoEm: string | null,
): Promise<boolean> {
  if (!ocorridoEm) return true;
  const { data } = await getSupabase()
    .from("assinaturas")
    .select("ultimo_evento_em")
    .eq("provider_subscription_id", preapprovalId)
    .eq("ambiente", ambiente)
    .maybeSingle();
  const anterior = (data as { ultimo_evento_em?: string | null } | null)?.ultimo_evento_em;
  if (!anterior) return true;
  return new Date(ocorridoEm).getTime() >= new Date(anterior).getTime();
}

async function sincronizarAssinatura(pre: Preapproval, ambiente: AmbienteCobranca) {
  const sb = getSupabase();
  const empresaId = await resolverEmpresa(pre.external_reference);
  if (!empresaId) {
    console.warn("Assinatura sem empresa vinculada", { preapproval: pre.id });
    return;
  }

  const ocorridoEm = pre.last_modified ?? pre.date_created ?? null;
  if (!(await eventoMaisRecente(pre.id, ambiente, ocorridoEm))) {
    console.log("Evento antigo ignorado:", pre.id);
    return;
  }

  const status = statusInternoPreapproval(pre);
  const periodicidade = periodicidadeInterna(pre);

  const { planoCodigo } = lerReferencia(pre.external_reference);
  const { data: plano } = planoCodigo
    ? await sb
        .from("planos")
        .select("id, codigo, dias_trial")
        .eq("codigo", planoCodigo)
        .eq("ambiente", ambiente)
        .maybeSingle()
    : { data: null };
  const linhaPlano = plano as { id?: string; codigo?: string; dias_trial?: number } | null;

  const inicio = pre.auto_recurring?.start_date ?? pre.date_created ?? null;
  const emTrial = status === "trial";
  const valor = pre.auto_recurring?.transaction_amount;
  const agora = new Date().toISOString();

  // Estado já gravado: usado para preservar o período pago quando o provedor
  // deixa de informar as datas (típico após cancelamento).
  const { data: anteriorRaw } = await sb
    .from("assinaturas")
    .select(
      "periodo_atual_inicio, periodo_atual_fim, proxima_cobranca, trial_inicio, trial_fim, cancelada_em",
    )
    .eq("provider_subscription_id", pre.id)
    .eq("ambiente", ambiente)
    .maybeSingle();
  const anterior = anteriorRaw as {
    periodo_atual_inicio?: string | null;
    periodo_atual_fim?: string | null;
    proxima_cobranca?: string | null;
    trial_inicio?: string | null;
    trial_fim?: string | null;
    cancelada_em?: string | null;
  } | null;

  const proxima = pre.next_payment_date ?? null;
  const periodoInicio =
    pre.summarized?.last_charged_date ?? anterior?.periodo_atual_inicio ?? inicio;
  const periodoFim = proxima ?? anterior?.periodo_atual_fim ?? anterior?.proxima_cobranca ?? null;
  const cancelada = status === "cancelada";
  // Cancelou com período pago em curso: o acesso continua até o fim do período.
  const cancelarNoFim = cancelada && Boolean(periodoFim) && new Date(periodoFim!) > new Date();

  const { error: erroAssinatura } = await sb.from("assinaturas").upsert(
    {
      empresa_id: empresaId,
      plano_codigo: linhaPlano?.codigo ?? null,
      plano_id: linhaPlano?.id ?? null,
      ambiente,
      status,
      provider: PROVIDER,
      provider_subscription_id: pre.id,
      provider_customer_id: pre.payer_id != null ? String(pre.payer_id) : null,
      provider_price_id: pre.preapproval_plan_id ?? null,
      metadata: { external_reference: pre.external_reference ?? null },
      quantidade: 1,
      valor_centavos: typeof valor === "number" ? Math.round(valor * 100) : null,
      moeda: pre.auto_recurring?.currency_id ?? "BRL",
      periodicidade,
      data_inicio: inicio,
      periodo_atual_inicio: periodoInicio,
      periodo_atual_fim: periodoFim,
      proxima_cobranca: cancelada ? null : proxima,
      trial_inicio: emTrial ? inicio : (anterior?.trial_inicio ?? null),
      trial_fim: emTrial ? proxima : (anterior?.trial_fim ?? null),
      cancelada_em: cancelada ? (anterior?.cancelada_em ?? agora) : null,
      cancelar_no_fim_periodo: cancelarNoFim,
      encerrada_em: cancelada && !cancelarNoFim ? agora : null,
      ultimo_evento_em: ocorridoEm,
      updated_at: agora,
    },
    { onConflict: "provider_subscription_id" },
  );
  exigirSucesso("Falha ao gravar a assinatura recebida do provedor", erroAssinatura);


  // O pagamento pode chegar antes da assinatura: vinculamos os órfãos da empresa.
  const { data: gravada } = await sb
    .from("assinaturas")
    .select("id")
    .eq("provider_subscription_id", pre.id)
    .eq("ambiente", ambiente)
    .maybeSingle();
  const assinaturaId = (gravada as { id?: string } | null)?.id ?? null;
  if (assinaturaId) {
    const { error: erroVinculo } = await sb
      .from("assinatura_pagamentos")
      .update({ assinatura_id: assinaturaId })
      .eq("empresa_id", empresaId)
      .eq("ambiente", ambiente)
      .is("assinatura_id", null);
    exigirSucesso("Falha ao vincular pagamentos à assinatura", erroVinculo);
  }

  await auditar(
    "Assinatura sincronizada pelo provedor",
    `Assinatura ${pre.id} (${linhaPlano?.codigo ?? "sem plano"}) status ${status}`,
    empresaId,
  );
}

function statusPagamento(status?: string): "aprovado" | "recusado" | "pendente" {
  if (status === "approved" || status === "accredited") return "aprovado";
  if (status === "rejected" || status === "cancelled") return "recusado";
  return "pendente";
}

async function registrarPagamento(id: string, ambiente: AmbienteCobranca) {
  const sb = getSupabase();
  const pagamento = await obterPagamentoAutorizado(ambiente, id);

  let assinaturaId: string | null = null;
  let empresaId: string | null = null;
  if (pagamento.preapproval_id) {
    const { data } = await sb
      .from("assinaturas")
      .select("id, empresa_id")
      .eq("provider_subscription_id", pagamento.preapproval_id)
      .eq("ambiente", ambiente)
      .maybeSingle();
    const linha = data as { id?: string; empresa_id?: string } | null;
    assinaturaId = linha?.id ?? null;
    empresaId = linha?.empresa_id ?? null;
  }
  if (!empresaId) empresaId = await resolverEmpresa(pagamento.external_reference);

  const status = statusPagamento(pagamento.payment?.status ?? pagamento.status);

  const { error } = await sb.from("assinatura_pagamentos").upsert(
    {
      assinatura_id: assinaturaId,
      empresa_id: empresaId,
      ambiente,
      provider: PROVIDER,
      provider_transaction_id: String(pagamento.payment?.id ?? pagamento.id),
      status,
      valor_centavos:
        typeof pagamento.transaction_amount === "number"
          ? Math.round(pagamento.transaction_amount * 100)
          : null,
      moeda: pagamento.currency_id ?? "BRL",
      ocorrido_em: pagamento.date_created ?? new Date().toISOString(),
      motivo_falha: status === "recusado" ? (pagamento.payment?.status_detail ?? null) : null,
      payload: pagamento as unknown as Record<string, unknown>,
    },
    { onConflict: "provider_transaction_id,status", ignoreDuplicates: true },
  );
  exigirSucesso("Falha ao registrar o pagamento do provedor", error);

  if (status === "recusado" && assinaturaId) {
    const { error: erroStatus } = await sb
      .from("assinaturas")
      .update({
        status: "pagamento_pendente",
        motivo_status: "Pagamento recusado pelo provedor",
        updated_at: new Date().toISOString(),
      })
      .eq("id", assinaturaId);
    exigirSucesso("Falha ao marcar pagamento pendente", erroStatus);
  }

  // Após a cobrança, o estado real da assinatura vem sempre do provedor.
  if (pagamento.preapproval_id) {
    const pre = await obterPreapproval(ambiente, pagamento.preapproval_id);
    await sincronizarAssinatura(pre, ambiente);
  }

  await auditar(
    status === "aprovado" ? "Pagamento aprovado" : `Pagamento ${status}`,
    `Cobrança ${pagamento.id} (${pagamento.currency_id ?? "BRL"})`,
    empresaId,
  );
}

type Notificacao = {
  id?: number | string;
  type?: string;
  topic?: string;
  action?: string;
  live_mode?: boolean;
  data?: { id?: string | number };
};

async function processar(req: Request) {
  const url = new URL(req.url);
  const corpo = await req.text();
  const evento = (corpo ? JSON.parse(corpo) : {}) as Notificacao;

  const tipo = evento.type ?? evento.topic ?? url.searchParams.get("type") ?? "";
  const recursoId = String(
    evento.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  );

  // Camada 1 (obrigatória): assinatura HMAC. Verificada antes de qualquer
  // gravação — nenhum dado é tocado quando ela falha.
  const validacao = validarAssinaturaWebhook(req, recursoId || null);
  if (!validacao.ok) throw new ErroAssinaturaWebhook(validacao.motivo ?? "inválida");

  if (!tipo || !recursoId) throw new Error("Notificação sem tipo ou identificador");

  // Sem `live_mode` (notificações de assinatura), vale o ambiente configurado no sistema.
  const ambiente: AmbienteCobranca = ambienteDaNotificacao(evento.live_mode, ambienteCobranca());
  const sb = getSupabase();
  const eventoId = `${tipo}:${recursoId}:${evento.action ?? "-"}:${evento.id ?? "-"}`;

  const { error: erroRegistro } = await sb.from("webhook_eventos_pagamento").insert({
    provider: PROVIDER,
    provider_event_id: eventoId,
    event_type: tipo,
    ambiente,
    payload: evento as unknown as Record<string, unknown>,
  });
  if (erroRegistro) {
    if (erroRegistro.code !== "23505") throw erroRegistro;
    const { data: anterior } = await sb
      .from("webhook_eventos_pagamento")
      .select("processado")
      .eq("provider", PROVIDER)
      .eq("provider_event_id", eventoId)
      .maybeSingle();
    if ((anterior as { processado?: boolean } | null)?.processado) {
      console.log("Evento já processado:", eventoId);
      return;
    }
  }

  try {
    switch (tipo) {
      case "subscription_preapproval":
      case "preapproval": {
        const pre = await obterPreapproval(ambiente, recursoId);
        await sincronizarAssinatura(pre, ambiente);
        break;
      }
      case "subscription_authorized_payment":
      case "authorized_payment": {
        await registrarPagamento(recursoId, ambiente);
        break;
      }
      default:
        console.log("Evento não tratado:", tipo);
    }
    await sb
      .from("webhook_eventos_pagamento")
      // `ambiente` corrige o registro de uma tentativa anterior classificada de outra forma.
      .update({ processado: true, processado_em: new Date().toISOString(), ambiente })
      .eq("provider", PROVIDER)
      .eq("provider_event_id", eventoId);
  } catch (e) {
    // A simulação do painel envia identificadores fictícios: o recurso não
    // existe na API oficial. Isso não é falha do endpoint — registramos o
    // evento como processado sem alterar nenhuma assinatura.
    if (e instanceof ErroMercadoPago && e.naoEncontrado) {
      console.log("Notificação de teste: recurso inexistente no provedor", {
        tipo,
        recursoId,
      });
      await sb
        .from("webhook_eventos_pagamento")
        .update({
          processado: true,
          processado_em: new Date().toISOString(),
          erro: "Recurso inexistente no provedor (notificação de teste) — nada aplicado",
        })
        .eq("provider", PROVIDER)
        .eq("provider_event_id", eventoId);
      return;
    }
    await sb
      .from("webhook_eventos_pagamento")
      .update({ erro: e instanceof Error ? e.message : String(e) })
      .eq("provider", PROVIDER)
      .eq("provider_event_id", eventoId);
    throw e;
  }
}

export const Route = createFileRoute("/api/public/payments/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await processar(request);
          return Response.json({ received: true });
        } catch (e) {
          if (e instanceof ErroAssinaturaWebhook) {
            console.warn("Webhook Mercado Pago rejeitado:", e.motivo);
            return new Response("Invalid signature", { status: 401 });
          }
          console.error("Erro no webhook Mercado Pago:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
