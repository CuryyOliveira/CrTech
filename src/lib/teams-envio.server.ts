/**
 * Envio das notificações pelo Microsoft Teams (servidor). Nunca lança erro para o chamador:
 * falhas são gravadas no banco (app_private.teams_envios) e reprocessadas pelo agendador.
 *
 * O endereço do fluxo é um segredo (quem o tem posta mensagens): fica só no banco, em
 * app_private, é lido apenas aqui e nunca é devolvido ao navegador nem gravado em logs.
 */
import { dataHoraLocal, type NotificacaoConferenciaRow } from "@/lib/notificacoes-conferencia";
import {
  CONFIG_TEAMS_PADRAO,
  cardDaNotificacao,
  emailValido,
  erroSeguro,
  mascararUrlFluxo,
  motivoParaNaoEnviar,
  normalizarDestinatarios,
  payloadFluxo,
  teamsLiberado,
  validarUrlFluxo,
  type ConfigTeams,
} from "@/lib/teams";

const PAINEL_URL = `${process.env["APP_URL"] || "https://conferenciarapida.com.br"}/admin/notificacoes`;
const TIMEOUT_MS = 15_000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (n: string, a?: Record<string, unknown>) => any;
  };
}
type Sb = Awaited<ReturnType<typeof admin>>;

async function lerConfig(sb: Sb): Promise<ConfigTeams> {
  const { data, error } = await sb.rpc("teams_config_obter");
  if (error) throw new Error(`Configuração do Teams indisponível: ${error.message}`);
  const linha = (Array.isArray(data) ? data[0] : data) as Partial<ConfigTeams> | undefined;
  return { ...CONFIG_TEAMS_PADRAO, ...(linha ?? {}), destinatarios: linha?.destinatarios ?? [] };
}

async function gravarConfig(sb: Sb, patch: Partial<ConfigTeams>) {
  const { error } = await sb.rpc("teams_config_salvar", { _patch: patch });
  if (error) throw new Error(`Não foi possível salvar a configuração do Teams: ${error.message}`);
}

/** Envia o card ao fluxo. O Power Automate responde 202 quando aceita a execução. */
export async function postarNoFluxo(
  url: string,
  corpo: unknown,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    throw new Error(
      nome === "TimeoutError" || nome === "AbortError"
        ? "O fluxo do Teams não respondeu a tempo."
        : "Não foi possível conectar ao fluxo do Teams.",
    );
  }
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    let detalhe = "";
    try {
      const j = JSON.parse(texto) as { error?: { code?: string; message?: string } };
      detalhe = j.error?.message || j.error?.code || "";
    } catch {
      detalhe = texto.slice(0, 200);
    }
    const dica =
      resposta.status === 401 || resposta.status === 403
        ? " Verifique se o gatilho do fluxo está como “Anyone” (qualquer pessoa)."
        : resposta.status === 404
          ? " O fluxo foi apagado, desativado ou o endereço mudou."
          : "";
    throw new Error(
      erroSeguro(
        `O fluxo do Teams respondeu HTTP ${resposta.status}${detalhe ? `: ${detalhe}` : ""}.${dica}`,
      ),
    );
  }
}

export type ResultadoTeams = { ok: boolean; status: string; erro: string | null };

/**
 * Envia uma notificação ao Teams (uma única vez por notificação). Retorna o status sem lançar.
 * Usado no processamento do servidor, no agendador, no monitor e no envio pedido pelo app.
 */
export async function enviarTeamsNotificacao(
  notificacaoId: string,
  fetcher: typeof fetch = fetch,
): Promise<ResultadoTeams> {
  try {
    const sb = await admin();
    const cfg = await lerConfig(sb);
    const { data: notif } = await sb
      .from("notificacoes_conferencia")
      .select("*")
      .eq("id", notificacaoId)
      .maybeSingle();
    if (!notif) return { ok: false, status: "nao_encontrada", erro: null };
    const n = notif as NotificacaoConferenciaRow;

    const motivo = motivoParaNaoEnviar(cfg, n.created_at);
    if (motivo) return { ok: false, status: motivo, erro: null };

    const destinatarios = normalizarDestinatarios(cfg.destinatarios);
    const { data: reservado, error } = await sb.rpc("reservar_envio_teams", {
      _notificacao_id: n.id,
      _destinatarios: destinatarios,
    });
    if (error)
      return { ok: false, status: "falha", erro: `Reserva indisponível: ${error.message}` };
    if (reservado !== true) return { ok: true, status: "ja_processado", erro: null };

    try {
      const card = cardDaNotificacao(n, { painelUrl: PAINEL_URL });
      await postarNoFluxo(cfg.webhook_url!, payloadFluxo(card, destinatarios), fetcher);
      await sb.rpc("concluir_envio_teams", { _notificacao_id: n.id, _enviado: true, _erro: null });
      return { ok: true, status: "enviado", erro: null };
    } catch (e) {
      const erro = erroSeguro(e instanceof Error ? e.message : "Falha desconhecida no envio");
      await sb.rpc("concluir_envio_teams", { _notificacao_id: n.id, _enviado: false, _erro: erro });
      return { ok: false, status: "falha", erro };
    }
  } catch (e) {
    return {
      ok: false,
      status: "falha",
      erro: erroSeguro(e instanceof Error ? e.message : "Falha desconhecida"),
    };
  }
}

/** Situação do canal para a aba Microsoft Teams (sem o endereço do fluxo). */
export async function statusTeams() {
  const sb = await admin();
  const cfg = await lerConfig(sb);
  const { data: envios } = await sb.rpc("teams_envios_recentes", { _limite: 20 });
  return {
    urlConfigurada: !!cfg.webhook_url,
    urlMascarada: mascararUrlFluxo(cfg.webhook_url),
    destinatarios: normalizarDestinatarios(cfg.destinatarios),
    ativo: cfg.ativo,
    validadoEm: cfg.validado_em,
    validadoPor: cfg.validado_por,
    liberadoEm: cfg.liberado_em,
    ultimoErro: cfg.ultimo_erro,
    liberado: teamsLiberado(cfg),
    envios: (
      (envios ?? []) as {
        id: string;
        notificacao_id: string | null;
        tipo: string | null;
        teste: boolean;
        destinatarios: string[];
        estado: string;
        tentativas: number;
        reservado_em: string;
        concluido_em: string | null;
        erro: string | null;
      }[]
    ).map((e) => ({ ...e, erro: e.erro ? erroSeguro(e.erro) : null })),
  };
}

/** Salva endereço (opcional), destinatários e ativação. Trocar o endereço exige novo teste. */
export async function salvarConfigTeams(entrada: {
  webhookUrl?: string | null;
  destinatarios?: string[];
  ativo?: boolean;
}) {
  const sb = await admin();
  const patch: Record<string, unknown> = {};
  if (entrada.webhookUrl != null && entrada.webhookUrl.trim()) {
    const v = validarUrlFluxo(entrada.webhookUrl);
    if (!v.ok) throw new Error(v.motivo);
    patch.webhook_url = v.url;
  }
  if (entrada.destinatarios) {
    const invalidos = entrada.destinatarios.filter((d) => d.trim() && !emailValido(d));
    if (invalidos.length) throw new Error(`E-mail inválido: ${invalidos[0]}`);
    patch.destinatarios = normalizarDestinatarios(entrada.destinatarios);
  }
  if (typeof entrada.ativo === "boolean") patch.ativo = entrada.ativo;
  await gravarConfig(sb, patch as Partial<ConfigTeams>);
  return statusTeams();
}

/** Card de teste: aprova a conexão e libera os disparos automáticos. */
export async function testarConexaoTeams(
  destino?: string | null,
  fetcher: typeof fetch = fetch,
): Promise<ResultadoTeams> {
  const sb = await admin();
  const cfg = await lerConfig(sb);
  if (!cfg.webhook_url)
    return { ok: false, status: "nao_configurado", erro: "Informe e salve o endereço do fluxo." };
  const destinatarios = destino?.trim()
    ? normalizarDestinatarios([destino])
    : normalizarDestinatarios(cfg.destinatarios);
  if (!destinatarios.length)
    return {
      ok: false,
      status: "nao_configurado",
      erro: destino?.trim() ? "Informe um e-mail válido." : "Nenhum destinatário cadastrado.",
    };

  const { data, hora } = dataHoraLocal();
  const modelo = {
    id: "teste",
    conferencia_id: "TESTE",
    tipo: "conferencia_iniciada",
    usuario_nome: "Teste de configuração",
    frota: "—",
    matricula: "—",
    local: "—",
    tipo_conferencia: "Teste",
    data,
    hora,
    payload: {},
    gravidade: "info",
  } as unknown as NotificacaoConferenciaRow;

  try {
    const card = cardDaNotificacao(modelo, { painelUrl: PAINEL_URL, teste: true });
    await postarNoFluxo(cfg.webhook_url, payloadFluxo(card, destinatarios), fetcher);
    await sb.rpc("registrar_teste_teams", {
      _destinatarios: destinatarios,
      _enviado: true,
      _erro: null,
    });
    const agora = new Date().toISOString();
    await gravarConfig(sb, {
      validado_em: agora,
      validado_por: destinatarios[0] ?? null,
      liberado_em: cfg.liberado_em ?? agora,
      ultimo_erro: null,
    });
    return { ok: true, status: "enviado", erro: null };
  } catch (e) {
    const erro = erroSeguro(e instanceof Error ? e.message : "Falha desconhecida no envio");
    await sb.rpc("registrar_teste_teams", {
      _destinatarios: destinatarios,
      _enviado: false,
      _erro: erro,
    });
    await gravarConfig(sb, { validado_em: null, ultimo_erro: erro });
    return { ok: false, status: "falha", erro };
  }
}

/** Notificações cujo envio ao Teams falhou/travou (para o agendador reprocessar). */
export async function teamsPendentes(): Promise<string[]> {
  try {
    const sb = await admin();
    const { data } = await sb.rpc("teams_envios_pendentes");
    return ((data ?? []) as (string | { teams_envios_pendentes: string })[]).map((x) =>
      typeof x === "string" ? x : x.teams_envios_pendentes,
    );
  } catch {
    return [];
  }
}
