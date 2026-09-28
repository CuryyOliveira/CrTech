/**
 * Envio dos e-mails de notificação (servidor). Nunca lança erro para o
 * chamador: falhas são gravadas no banco e refletidas no status.
 */
import {
  CHAVE_CONFIG_EMAILS,
  dataHoraLocal,
  CONFIG_EMAILS_PADRAO,
  conteudoNotificacao,
  etapasEnvio,
  tipoInfo,
  type ConfigEmails,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";
import { SISTEMA_NOME } from "@/lib/email-layout";
import type { NotificacaoConferenciaEmailProps } from "@/lib/email-templates/notificacao-conferencia";

type Resultado = { ok: boolean; status: string; erro: string | null };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

async function config(sb: Awaited<ReturnType<typeof admin>>): Promise<ConfigEmails> {
  const { data } = await sb
    .from("configuracoes_sistema")
    .select("valor")
    .eq("chave", CHAVE_CONFIG_EMAILS)
    .maybeSingle();
  return { ...CONFIG_EMAILS_PADRAO, ...((data?.valor ?? {}) as Partial<ConfigEmails>) };
}

async function salvarConfig(
  sb: Awaited<ReturnType<typeof admin>>,
  cfg: ConfigEmails,
  patch: Partial<ConfigEmails>,
) {
  await sb
    .from("configuracoes_sistema")
    .upsert({ chave: CHAVE_CONFIG_EMAILS, valor: { ...cfg, ...patch } }, { onConflict: "chave" });
}

/**
 * Diagnóstico do servidor de envio: etapas concluídas, chave de API disponível
 * e se os disparos reais já estão liberados.
 */
export async function diagnosticarEnvio() {
  const sb = await admin();
  const cfg = await config(sb);
  const etapas = etapasEnvio(cfg);
  const apiKey = !!process.env["LOVABLE_API_KEY"];
  return {
    etapas,
    apiKey,
    validadoEm: cfg.validado_em,
    validadoPor: cfg.validado_por,
    ultimoErro: cfg.ultimo_erro,
    liberado: apiKey && cfg.ativo && etapas.every((e) => e.concluida),
  };
}

function remetenteDe(cfg: ConfigEmails) {
  const dominio = (cfg.sender_domain ?? "").trim();
  const remetente = (cfg.remetente ?? "").trim() || (dominio ? `nao-responda@${dominio}` : "");
  return { dominio, remetente };
}

function dadosDoTemplate(
  notificacao: NotificacaoConferenciaRow,
  assunto: string,
): NotificacaoConferenciaEmailProps {
  const conteudo = conteudoNotificacao(notificacao);
  return {
    assunto,
    titulo: conteudo.titulo,
    introducao: conteudo.intro,
    detalhes: conteudo.linhas,
    divergencias: conteudo.divergencias,
  };
}

const PAINEL_URL = "https://conferenciamat.lovable.app/admin/notificacoes";
const num = (x?: number | null) => (x == null ? "" : String(x));

/** Escolhe o modelo de e-mail e monta seus dados conforme o tipo do evento. */
function modeloDoEvento(
  n: NotificacaoConferenciaRow,
  assunto: string,
): { nome: string; dados: Record<string, unknown> } {
  if (n.tipo === "conferencia_concluida") {
    const p = n.payload ?? {};
    return {
      nome: "conferencia-concluida",
      dados: {
        nome: p.unidade_nome ?? n.local ?? n.frota ?? "Conferência",
        usuario: n.usuario_nome ?? n.usuario_email ?? "",
        conferente: p.conferente ?? "",
        matricula: n.matricula ?? "",
        frota: n.frota ?? "",
        local: n.local ?? "",
        tipoConferencia: n.tipo_conferencia ?? "",
        inicio: p.inicio ?? "",
        fim: p.fim ?? "",
        duracao: p.duracao ?? "",
        conferenciaId: n.conferencia_id ?? "",
        previstos: num(p.previstos ?? p.itens),
        contados: num(p.contados ?? p.corretos),
        divergentes: num(p.divergentes),
        faltantes: num(p.faltantes),
        sobras: num(p.sobras),
        percentual: p.percentual == null ? "" : `${p.percentual}%`,
        urlRelatorio: PAINEL_URL,
      },
    };
  }
  return {
    nome: "notificacao-conferencia",
    dados: dadosDoTemplate(n, assunto) as unknown as Record<string, unknown>,
  };
}

/** Erros temporários do provedor (limite ou indisponibilidade) permitem retentativa. */
function temporario(e: unknown) {
  const status = (e as { status?: number } | null)?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/** Envia com retentativas automáticas em falhas temporárias do provedor. */
async function enviarComRetry(
  modelo: string,
  destinatario: string,
  dados: Record<string, unknown>,
  idempotencyKey: string,
) {
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  let ultimo: unknown = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      return await sendTemplateEmail(modelo, destinatario, {
        templateData: dados,
        idempotencyKey,
      });
    } catch (e) {
      ultimo = e;
      if (!temporario(e) || tentativa === 3) throw e;
      const espera = Number((e as { retryAfterSeconds?: number }).retryAfterSeconds) || 5;
      await new Promise((r) => setTimeout(r, Math.min(espera, 30) * 1000));
    }
  }
  throw ultimo;
}


/** Envia (ou reenvia) o e-mail de uma notificação e registra cada tentativa. */
export async function enviarNotificacao(
  notificacaoId: string,
  reenvio = false,
): Promise<Resultado> {
  const sb = await admin();
  const { data: notif } = await sb
    .from("notificacoes_conferencia")
    .select("*")
    .eq("id", notificacaoId)
    .maybeSingle();
  if (!notif) return { ok: false, status: "falha", erro: "Notificação não encontrada" };
  const n = notif as NotificacaoConferenciaRow;

  const cfg = await config(sb);
  const info = tipoInfo(n.tipo);
  const assunto = n.assunto?.trim() || info.assunto;
  const destinatarios = (cfg.destinatarios ?? []).map((d) => d.trim()).filter(Boolean);
  const tentativa = (n.tentativas ?? 0) + 1;

  const registrar = async (destinatario: string, status: string, erro: string | null) => {
    await sb.from("notificacao_emails").insert({
      notificacao_id: n.id,
      destinatario,
      assunto,
      status,
      confirmado: status === "enviado" || status === "reenviado",
      erro,
      tentativa,
    });
  };

  const concluir = async (status: string, erro: string | null): Promise<Resultado> => {
    await sb
      .from("notificacoes_conferencia")
      .update({
        email_status: status,
        tentativas: tentativa,
        ultima_tentativa: new Date().toISOString(),
      })
      .eq("id", n.id);
    return { ok: status === "enviado" || status === "reenviado", status, erro };
  };

  if (!cfg.ativo) return concluir("pendente", null);
  if (!cfg.validado_em)
    return concluir(
      "nao_configurado",
      "Conexão de envio ainda não validada. Conclua o assistente em Administração do Sistema → Notificações e aprove o teste de conexão.",
    );
  if (!destinatarios.length)
    return concluir("nao_configurado", "Nenhum destinatário cadastrado em Notificações");

  const apiKey = process.env["LOVABLE_API_KEY"];
  const { dominio, remetente } = remetenteDe(cfg);
  if (!apiKey || !dominio || !remetente) {
    const erro =
      "Envio depende da configuração do servidor de e-mail (domínio remetente) em Administração do Sistema → Notificações.";
    for (const d of destinatarios) await registrar(d, "nao_configurado", erro);
    return concluir("nao_configurado", erro);
  }

  // Evita e-mail duplicado: já enviado e não é um reenvio manual.
  if (!reenvio && (n.email_status === "enviado" || n.email_status === "reenviado")) {
    return { ok: true, status: n.email_status, erro: null };
  }

  const { nome: modelo, dados } = modeloDoEvento(n, assunto);

  let falhou: string | null = null;
  for (const destinatario of destinatarios) {
    // Chave estável por notificação/destinatário: retentativas não duplicam envio.
    const chave = `notif-${n.id}-${destinatario}`;
    try {
      const resultado = await enviarComRetry(modelo, destinatario, dados, chave);
      if (!resultado.sent) {
        await registrar(destinatario, "falha", "Destinatário bloqueado para recebimento");
        falhou = "Destinatário bloqueado para recebimento";
        continue;
      }
      await registrar(destinatario, reenvio ? "reenviado" : "enviado", null);
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Falha desconhecida no envio";
      falhou = erro;
      await registrar(destinatario, "falha", erro);
    }
  }
  return concluir(falhou ? "falha" : reenvio ? "reenviado" : "enviado", falhou);
}


/** Reenvia todas as notificações com envio pendente ou falho. */
export async function reenviarFalhas(): Promise<{ total: number; enviadas: number }> {
  const sb = await admin();
  const { data } = await sb
    .from("notificacoes_conferencia")
    .select("id")
    .in("email_status", ["falha", "pendente", "nao_configurado"])
    .order("created_at", { ascending: false })
    .limit(100);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  let enviadas = 0;
  for (const id of ids) {
    const r = await enviarNotificacao(id, true);
    if (r.ok) enviadas++;
  }
  return { total: ids.length, enviadas };
}

/** E-mail de teste para validar a configuração do servidor de e-mail. */
export async function enviarTeste(destino?: string | null): Promise<Resultado> {
  const sb = await admin();
  const cfg = await config(sb);
  const apiKey = process.env["LOVABLE_API_KEY"];
  const { dominio, remetente } = remetenteDe(cfg);
  const destinatarios = destino?.trim()
    ? [destino.trim()]
    : (cfg.destinatarios ?? []).map((d) => d.trim()).filter(Boolean);

  if (!destinatarios.length)
    return { ok: false, status: "nao_configurado", erro: "Nenhum destinatário cadastrado" };
  if (!apiKey || !dominio || !remetente)
    return {
      ok: false,
      status: "nao_configurado",
      erro: "Configure o domínio remetente para enviar e-mails.",
    };

  const modelo = {
    id: "teste",
    conferencia_id: "TESTE",
    tipo: "conferencia_iniciada",
    usuario_nome: "Teste de configuração",
    frota: "—",
    matricula: "—",
    local: "—",
    tipo_conferencia: "Teste",
    data: dataHoraLocal().data,
    hora: dataHoraLocal().hora,
    payload: {},
    gravidade: "info",
  } as unknown as NotificacaoConferenciaRow;

  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  try {
    for (const destinatario of destinatarios) {
      const chave = `validacao-email-${crypto.randomUUID()}`;
      const resultado = await sendTemplateEmail("notificacao-conferencia", destinatario, {
        templateData: dadosDoTemplate(modelo, `TESTE — ${SISTEMA_NOME}`),
        idempotencyKey: chave,
      });
      if (!resultado.sent) {
        throw new Error("O destinatário de teste está bloqueado para recebimento");
      }
    }
    await salvarConfig(sb, cfg, {
      validado_em: new Date().toISOString(),
      validado_por: destinatarios[0] ?? null,
      ultimo_erro: null,
    });
    return { ok: true, status: "enviado", erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Falha desconhecida no envio";
    await salvarConfig(sb, cfg, { validado_em: null, ultimo_erro: erro });
    return { ok: false, status: "falha", erro };
  }
}
