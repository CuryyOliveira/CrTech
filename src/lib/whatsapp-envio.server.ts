/**
 * Envio real das notificações por WhatsApp (Cloud API da Meta).
 *
 * Roda SOMENTE no servidor: usa o token da conta do WhatsApp Business e o
 * service role para gravar o resultado em `whatsapp_notificacoes`.
 * Cada destinatário tem uma chave idempotente, então a mesma notificação
 * nunca é enviada duas vezes (mesmo com reenvio ou sincronização offline).
 */
import {
  chaveIdempotente,
  destinatariosDoEvento,
  mascararTelefone,
  type DestinatarioWhatsapp,
  type EventoWhatsapp,
} from "@/lib/whatsapp";

type Notificacao = {
  id: string;
  conferencia_id: string | null;
  unidade_id: string | null;
  tipo: string;
  modulo: string | null;
  local: string | null;
  data: string | null;
  hora: string | null;
  usuario_nome: string | null;
  matricula: string | null;
  payload: Record<string, unknown> | null;
};

export type ResultadoWhatsapp = {
  enviados: number;
  ignorados: number;
  falhas: number;
  motivo?: string;
};

const EVENTO_POR_TIPO: Record<string, EventoWhatsapp> = {
  conferencia_iniciada: "CONFERENCIA_INICIADA",
  conferencia_concluida: "CONFERENCIA_CONCLUIDA",
};

const API = "https://graph.facebook.com/v21.0";

function credenciais() {
  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  if (!token || !phoneId) return null;
  return {
    token,
    phoneId,
    templateInicio: process.env["WHATSAPP_TEMPLATE_INICIO"] ?? "",
    templateConclusao: process.env["WHATSAPP_TEMPLATE_CONCLUSAO"] ?? "",
    idioma: process.env["WHATSAPP_TEMPLATE_IDIOMA"] ?? "pt_BR",
  };
}

/** Texto humano da mensagem — também usado como parâmetro do template. */
function montarTexto(n: Notificacao, evento: EventoWhatsapp) {
  const quando = [n.data, n.hora].filter(Boolean).join(" ");
  const linhas: string[] = [];
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const conferente = (p["conferente"] as string | null) ?? n.usuario_nome ?? "—";
  if (evento === "CONFERENCIA_INICIADA") {
    linhas.push("*Conferência iniciada*");
  } else {
    linhas.push("*Conferência concluída*");
  }
  linhas.push(`Módulo: ${n.modulo ?? "—"}`);
  linhas.push(`Local: ${n.local ?? "—"}`);
  linhas.push(`Conferente: ${conferente}${n.matricula ? ` (${n.matricula})` : ""}`);
  if (quando) linhas.push(`Data/hora: ${quando}`);
  if (evento === "CONFERENCIA_CONCLUIDA") {
    const num = (chave: string) => {
      const v = p[chave];
      return typeof v === "number" ? v : Number(v ?? 0) || 0;
    };
    linhas.push(`Itens: ${num("itens")}`);
    linhas.push(`Corretos: ${num("corretos")}`);
    linhas.push(`Divergências: ${num("divergentes")}`);
    const dur = p["duracao"];
    if (typeof dur === "string" && dur) linhas.push(`Duração: ${dur}`);
  }
  return linhas.join("\n");
}

/** Corpo da chamada à Cloud API: template aprovado quando configurado. */
function corpoMensagem(
  telefone: string,
  texto: string,
  template: string,
  idioma: string,
) {
  if (template) {
    return {
      messaging_product: "whatsapp",
      to: telefone,
      type: "template",
      template: {
        name: template,
        language: { code: idioma },
        components: [
          { type: "body", parameters: [{ type: "text", text: texto.replace(/\n/g, " • ") }] },
        ],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to: telefone,
    type: "text",
    text: { preview_url: false, body: texto },
  };
}

/**
 * Envia a notificação (início ou conclusão) para todos os números ativos da
 * empresa que optaram por receber aquele evento. Falhas são registradas e
 * nunca propagadas para o fluxo da conferência.
 */
export async function enviarWhatsappNotificacao(
  notificacaoId: string,
  empresaIdFallback?: string | null,
): Promise<ResultadoWhatsapp> {
  const vazio: ResultadoWhatsapp = { enviados: 0, ignorados: 0, falhas: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: notifRow } = await supabaseAdmin
    .from("notificacoes_conferencia")
    .select(
      "id, conferencia_id, unidade_id, tipo, modulo, local, data, hora, usuario_nome, matricula, payload",
    )
    .eq("id", notificacaoId)
    .maybeSingle();
  const n = notifRow as Notificacao | null;
  if (!n) return { ...vazio, motivo: "Notificação não encontrada." };

  const evento = EVENTO_POR_TIPO[n.tipo];
  if (!evento) return { ...vazio, motivo: "Este evento não envia WhatsApp." };

  // Empresa vem da unidade da conferência (fonte da verdade multiempresa).
  let empresaId: string | null = empresaIdFallback ?? null;
  if (n.unidade_id) {
    const { data: uni } = await supabaseAdmin
      .from("unidades")
      .select("empresa_id")
      .eq("id", n.unidade_id)
      .maybeSingle();
    empresaId = (uni as { empresa_id: string | null } | null)?.empresa_id ?? empresaId;
  }
  if (!empresaId) return { ...vazio, motivo: "Empresa não identificada." };

  const { data: destRows } = await supabaseAdmin
    .from("empresa_whatsapp_destinatarios")
    .select("*")
    .eq("empresa_id", empresaId);
  const destinatarios = destinatariosDoEvento(
    (destRows ?? []) as unknown as DestinatarioWhatsapp[],
    evento,
  );
  if (!destinatarios.length) return { ...vazio, motivo: "Nenhum número cadastrado." };

  const cred = credenciais();
  const texto = montarTexto(n, evento);
  const template =
    evento === "CONFERENCIA_INICIADA" ? (cred?.templateInicio ?? "") : (cred?.templateConclusao ?? "");

  const resultado: ResultadoWhatsapp = { ...vazio };

  for (const d of destinatarios) {
    const idempotency_key = chaveIdempotente(empresaId, n.conferencia_id ?? n.id, evento, d.id);
    const base = {
      empresa_id: empresaId,
      conferencia_id: n.conferencia_id,
      destinatario_id: d.id,
      tipo_evento: evento,
      idempotency_key,
      telefone_mascarado: mascararTelefone(d.telefone_normalizado),
      payload: { notificacao_id: n.id, texto } as never,
    };

    // Reserva a linha: se a chave já existe, a mensagem já foi tratada.
    const { data: criada, error: erroInsert } = await supabaseAdmin
      .from("whatsapp_notificacoes")
      .insert({ ...base, status: cred ? "enviando" : "pendente" })
      .select("id")
      .maybeSingle();
    if (erroInsert) {
      if (/duplicate key|uq_wa_notif_idempotency/i.test(erroInsert.message)) {
        resultado.ignorados += 1;
        continue;
      }
      resultado.falhas += 1;
      continue;
    }
    const linhaId = (criada as { id: string } | null)?.id;

    if (!cred) {
      // Sem credenciais configuradas a mensagem fica pendente para envio futuro.
      resultado.ignorados += 1;
      resultado.motivo = "WhatsApp ainda não configurado.";
      continue;
    }

    try {
      const resposta = await fetch(`${API}/${cred.phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(corpoMensagem(d.telefone_normalizado, texto, template, cred.idioma)),
      });
      const corpo = (await resposta.json().catch(() => null)) as
        | { messages?: { id?: string }[]; error?: { message?: string } }
        | null;
      if (!resposta.ok) {
        const msg = corpo?.error?.message ?? `Falha HTTP ${resposta.status}`;
        resultado.falhas += 1;
        if (linhaId)
          await supabaseAdmin
            .from("whatsapp_notificacoes")
            .update({ status: "erro", erro: msg.slice(0, 500) })
            .eq("id", linhaId);
        continue;
      }
      resultado.enviados += 1;
      if (linhaId)
        await supabaseAdmin
          .from("whatsapp_notificacoes")
          .update({
            status: "enviado",
            provider_message_id: corpo?.messages?.[0]?.id ?? null,
            sent_at: new Date().toISOString(),
            erro: null,
          })
          .eq("id", linhaId);
    } catch (e) {
      resultado.falhas += 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (linhaId)
        await supabaseAdmin
          .from("whatsapp_notificacoes")
          .update({ status: "erro", erro: msg.slice(0, 500) })
          .eq("id", linhaId);
    }
  }

  return resultado;
}

/** Reenvia (ou envia pela primeira vez) as mensagens pendentes/com erro da empresa. */
export async function reenviarWhatsappPendentes(empresaId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("whatsapp_notificacoes")
    .select("id, payload")
    .eq("empresa_id", empresaId)
    .in("status", ["pendente", "erro"])
    .order("created_at", { ascending: true })
    .limit(50);

  const ids = new Set<string>();
  for (const row of (data ?? []) as { id: string; payload: Record<string, unknown> | null }[]) {
    const notifId = row.payload?.["notificacao_id"];
    if (typeof notifId === "string") ids.add(notifId);
  }
  // Apaga as reservas antigas para que a chave idempotente possa ser reusada.
  const linhas = (data ?? []) as { id: string }[];
  if (linhas.length)
    await supabaseAdmin
      .from("whatsapp_notificacoes")
      .delete()
      .in(
        "id",
        linhas.map((l) => l.id),
      );

  const total: ResultadoWhatsapp = { enviados: 0, ignorados: 0, falhas: 0 };
  for (const id of ids) {
    const r = await enviarWhatsappNotificacao(id, empresaId);
    total.enviados += r.enviados;
    total.ignorados += r.ignorados;
    total.falhas += r.falhas;
  }
  return total;
}
