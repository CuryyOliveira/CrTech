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
  fmtDuracao,
  frotaCadastrada,
  tipoInfo,
  unidadeLocal,
  type ConfigEmails,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";
import { SISTEMA_NOME } from "@/lib/email-layout";
import type { NotificacaoConferenciaEmailProps } from "@/lib/email-templates/notificacao-conferencia";

type Resultado = { ok: boolean; status: string; erro: string | null };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (n: string, a: Record<string, unknown>) => any;
  };
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
  const apiKey = !!process.env["BREVO_API_KEY"];
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

const PAINEL_URL = `${process.env["APP_URL"] || "https://conferenciarapida.com.br"}/admin/notificacoes`;
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
        nome: p.lista ?? p.unidade_nome ?? n.local ?? n.frota ?? "Conferência",
        responsavel: p.responsavel ?? "",
        lista: p.lista ?? p.unidade_nome ?? n.local ?? "",
        unidadeLocal: unidadeLocal(n, p) ?? "",
        status: "Concluída",
        usuario: n.usuario_nome ?? n.usuario_email ?? "",
        conferente: p.conferente ?? "",
        matricula: n.matricula ?? "",
        frota: frotaCadastrada(n, p) ?? "",
        local: n.local ?? "",
        tipoConferencia: n.tipo_conferencia ?? "",
        inicio: p.inicio ?? "",
        fim: p.fim ?? "",
        duracao: p.duracao ?? (p.duracao_segundos != null ? fmtDuracao(p.duracao_segundos) : ""),
        pendentes: num(p.pendentes),
        itensDivergentes: p.divergencias ?? [],
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

  const apiKey = process.env["BREVO_API_KEY"];
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
  let emOutroEnvio = false;
  for (const destinatario of destinatarios) {
    // Envio automático: cada destinatário é reservado no banco antes de chamar o provedor.
    // Chamadas repetidas/simultâneas (retry, timeout, agendador) não duplicam o e-mail.
    // Reenvio manual (Central Administrativa) é intencional e não passa pela reserva.
    if (!reenvio) {
      const { data: reservado, error } = await sb.rpc("reservar_envio_email", {
        _notificacao_id: n.id,
        _destinatario: destinatario,
      });
      if (error) {
        falhou = `Reserva de envio indisponível: ${error.message}`;
        continue;
      }
      if (reservado !== true) {
        emOutroEnvio = true; // já enviado ou em envio por outra chamada
        continue;
      }
    }
    // Chave estável por notificação/destinatário (identificação no provedor).
    const chave = `notif-${n.id}-${destinatario}`;
    try {
      const resultado = await enviarComRetry(modelo, destinatario, dados, chave);
      if (!resultado.sent) {
        const erro = "Destinatário bloqueado para recebimento";
        if (!reenvio) await marcarEnvio(sb, n.id, destinatario, false, erro);
        await registrar(destinatario, "falha", erro);
        falhou = erro;
        continue;
      }
      if (!reenvio) await marcarEnvio(sb, n.id, destinatario, true, null);
      await registrar(destinatario, reenvio ? "reenviado" : "enviado", null);
    } catch (e) {
      const erro = e instanceof Error ? e.message : "Falha desconhecida no envio";
      if (!reenvio) await marcarEnvio(sb, n.id, destinatario, false, erro);
      falhou = erro;
      await registrar(destinatario, "falha", erro);
    }
  }
  if (reenvio) return concluir(falhou ? "falha" : "reenviado", falhou);
  if (falhou) return concluir("falha", falhou);
  // Status geral pelo estado real de cada destinatário (inclui envios feitos por outra chamada).
  if (emOutroEnvio) {
    const { data: estados } = await sb.rpc("estado_envios_email", { _notificacao_id: n.id });
    const lista = (estados ?? []) as { destinatario: string; estado: string }[];
    const enviados = new Set(
      lista.filter((e) => e.estado === "enviado").map((e) => e.destinatario),
    );
    const todos = destinatarios.every((d) => enviados.has(d.trim().toLowerCase()));
    if (!todos) {
      const esgotado = lista.some((e) => e.estado === "falha");
      return concluir(esgotado ? "falha" : "enviando", null);
    }
  }
  return concluir("enviado", null);
}

async function marcarEnvio(
  sb: Awaited<ReturnType<typeof admin>>,
  notificacaoId: string,
  destinatario: string,
  enviado: boolean,
  erro: string | null,
) {
  await sb.rpc("concluir_envio_email", {
    _notificacao_id: notificacaoId,
    _destinatario: destinatario,
    _enviado: enviado,
    _erro: erro,
  });
}

/**
 * Processa uma notificação criada pelo banco (início, conclusão, divergência): atualiza o
 * relatório com os dados confirmados no servidor, envia o e-mail (sem duplicar) e, para início e
 * conclusão, o WhatsApp da empresa (também idempotente). Nunca lança erro.
 */
export async function processarNotificacaoServidor(notificacaoId: string): Promise<string> {
  try {
    const sb = await admin();
    const { data: notif } = await sb
      .from("notificacoes_conferencia")
      .select("id, tipo, conferencia_id, chave, payload")
      .eq("id", notificacaoId)
      .maybeSingle();
    const n = notif as {
      id: string;
      tipo: string;
      conferencia_id: string | null;
      chave: string | null;
      payload: Record<string, unknown> | null;
    } | null;
    if (!n) return "nao_encontrada";
    if (n.chave && n.conferencia_id) {
      const { data: relatorio } = await sb.rpc("relatorio_notificacao", {
        _conferencia_id: n.conferencia_id,
      });
      if (relatorio && typeof relatorio === "object") {
        await sb
          .from("notificacoes_conferencia")
          .update({ payload: { ...(n.payload ?? {}), ...(relatorio as object) } })
          .eq("id", n.id);
      }
    }
    const r = await enviarNotificacao(n.id);
    if (n.tipo === "conferencia_iniciada" || n.tipo === "conferencia_concluida") {
      try {
        const { enviarWhatsappNotificacao } = await import("@/lib/whatsapp-envio.server");
        await enviarWhatsappNotificacao(n.id);
      } catch {
        /* WhatsApp nunca impede o e-mail */
      }
    }
    return r.status;
  } catch (e) {
    return `erro: ${e instanceof Error ? e.message : "desconhecido"}`;
  }
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
  const apiKey = process.env["BREVO_API_KEY"];
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
