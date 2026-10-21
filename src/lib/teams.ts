/**
 * Notificações pelo Microsoft Teams: regras puras (sem acesso a banco ou rede).
 *
 * O servidor envia ao fluxo do Power Automate (gatilho "When a Teams webhook request is
 * received") um card adaptativo com o MESMO conteúdo do e-mail (`conteudoNotificacao`) e a lista
 * de destinatários; o fluxo posta o card no chat de cada um (Flow bot).
 */
import {
  conteudoNotificacao,
  fmtDataBR,
  tipoInfo,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";

/** Hosts aceitos para o endereço do fluxo (Power Automate / Logic Apps da Microsoft). */
const HOSTS_FLUXO = [".logic.azure.com", ".api.powerplatform.com"];

export type ValidacaoUrl = { ok: true; url: string } | { ok: false; motivo: string };

/**
 * Valida o endereço do fluxo: somente HTTPS em domínios da Microsoft (evita que o servidor seja
 * usado para chamar endereços arbitrários) e com a assinatura de acesso (`sig`).
 */
export function validarUrlFluxo(bruta: string): ValidacaoUrl {
  const texto = (bruta ?? "").trim();
  if (!texto) return { ok: false, motivo: "Informe o endereço do fluxo." };
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return {
      ok: false,
      motivo: "Endereço inválido. Copie a URL de HTTP POST do gatilho do fluxo.",
    };
  }
  if (url.protocol !== "https:")
    return { ok: false, motivo: "O endereço do fluxo precisa começar com https://." };
  const host = url.hostname.toLowerCase();
  if (!HOSTS_FLUXO.some((h) => host.endsWith(h)))
    return {
      ok: false,
      motivo:
        "O endereço não é de um fluxo do Power Automate. Copie a URL de HTTP POST do gatilho “When a Teams webhook request is received”.",
    };
  if (!url.searchParams.get("sig"))
    return {
      ok: false,
      motivo: "O endereço está incompleto (falta a assinatura “sig”). Copie a URL inteira.",
    };
  return { ok: true, url: url.toString() };
}

/** Versão exibível do endereço: só o domínio (a assinatura nunca vai ao navegador). */
export function mascararUrlFluxo(url?: string | null) {
  if (!url) return null;
  try {
    return `${new URL(url).hostname}/…`;
  } catch {
    return "configurado";
  }
}

export function emailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Destinatários normalizados: minúsculos, sem espaços, sem repetição e só e-mails válidos. */
export function normalizarDestinatarios(lista: readonly string[] | null | undefined) {
  const vistos = new Set<string>();
  for (const bruto of lista ?? []) {
    const email = String(bruto ?? "")
      .trim()
      .toLowerCase();
    if (email && emailValido(email)) vistos.add(email);
  }
  return [...vistos];
}

/** Domínios de e-mail pessoais: não recebem mensagens do Teams da organização. */
const DOMINIOS_PESSOAIS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "bol.com.br",
  "uol.com.br",
];

export function emailPessoal(email: string) {
  const dominio = email.split("@")[1]?.trim().toLowerCase() ?? "";
  return DOMINIOS_PESSOAIS.includes(dominio);
}

const LIMITE_TEXTO = 500;
const LIMITE_DIVERGENCIAS = 25;

const curto = (s: string) => (s.length > LIMITE_TEXTO ? `${s.slice(0, LIMITE_TEXTO)}…` : s);

/** Cor do cabeçalho do card conforme a gravidade da notificação. */
function estiloCabecalho(gravidade?: string | null) {
  if (gravidade === "critica") return "attention";
  if (gravidade === "atencao") return "warning";
  if (gravidade === "sucesso") return "good";
  return "accent";
}

export type CardAdaptativo = Record<string, unknown>;

/**
 * Card adaptativo (v1.4, suportado pelo Teams) com o mesmo conteúdo do e-mail: título, introdução,
 * tabela de detalhes e divergências, além do botão para abrir o sistema.
 */
export function cardDaNotificacao(
  n: NotificacaoConferenciaRow,
  opcoes: { painelUrl: string; teste?: boolean },
): CardAdaptativo {
  const c = conteudoNotificacao(n);
  const info = tipoInfo(n.tipo);
  const titulo = opcoes.teste ? `TESTE — ${c.titulo}` : c.titulo;
  const divergencias = c.divergencias.slice(0, LIMITE_DIVERGENCIAS);
  const restantes = c.divergencias.length - divergencias.length;

  const body: unknown[] = [
    {
      type: "Container",
      style: estiloCabecalho(n.gravidade ?? info.gravidade),
      bleed: true,
      items: [
        {
          type: "TextBlock",
          text: "CONFERÊNCIA RÁPIDA",
          size: "Small",
          weight: "Bolder",
          isSubtle: true,
          spacing: "None",
        },
        { type: "TextBlock", text: titulo, size: "Large", weight: "Bolder", wrap: true },
      ],
    },
    { type: "TextBlock", text: c.intro, wrap: true, spacing: "Medium" },
    {
      type: "FactSet",
      facts: c.linhas.map((l) => ({ title: l.rotulo, value: curto(l.valor) })),
    },
  ];

  if (divergencias.length) {
    body.push({
      type: "TextBlock",
      text: `Divergências (${c.divergencias.length})`,
      weight: "Bolder",
      spacing: "Medium",
      separator: true,
    });
    body.push({
      type: "FactSet",
      facts: divergencias.map((d) => {
        const diferenca =
          d.encontrada != null && d.esperada != null ? d.encontrada - d.esperada : null;
        return {
          title: curto(`${d.codigo ?? "—"} — ${d.descricao ?? "—"}`),
          value: `esperada ${d.esperada ?? "—"} · encontrada ${d.encontrada ?? "—"}${
            diferenca != null ? ` · diferença ${diferenca > 0 ? "+" : ""}${diferenca}` : ""
          }`,
        };
      }),
    });
    if (restantes > 0)
      body.push({
        type: "TextBlock",
        text: `+ ${restantes} item(ns). Veja a lista completa no sistema.`,
        isSubtle: true,
        wrap: true,
      });
  }

  body.push({
    type: "TextBlock",
    text: `${fmtDataBR(n.data)}${n.hora ? ` ${n.hora}` : ""} · Mensagem automática.`,
    size: "Small",
    isSubtle: true,
    wrap: true,
    spacing: "Medium",
  });

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    msteams: { width: "Full" },
    body,
    actions: [{ type: "Action.OpenUrl", title: "Abrir no sistema", url: opcoes.painelUrl }],
  };
}

/**
 * Corpo enviado ao fluxo: formato de mensagem do Teams (o fluxo lê o card em
 * `attachments[0].content`) mais a lista `destinatarios`, percorrida pelo "Apply to each".
 */
export function payloadFluxo(card: CardAdaptativo, destinatarios: string[]) {
  return {
    type: "message",
    attachments: [
      { contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card },
    ],
    destinatarios,
  };
}

export type ConfigTeams = {
  webhook_url: string | null;
  destinatarios: string[];
  ativo: boolean;
  validado_em: string | null;
  validado_por: string | null;
  liberado_em: string | null;
  ultimo_erro: string | null;
};

export const CONFIG_TEAMS_PADRAO: ConfigTeams = {
  webhook_url: null,
  destinatarios: [],
  ativo: true,
  validado_em: null,
  validado_por: null,
  liberado_em: null,
  ultimo_erro: null,
};

/** Disparos automáticos só depois da conexão validada, com destinatários e o canal ativo. */
export function teamsLiberado(cfg: ConfigTeams) {
  return (
    cfg.ativo &&
    !!cfg.webhook_url &&
    !!cfg.validado_em &&
    !!cfg.liberado_em &&
    normalizarDestinatarios(cfg.destinatarios).length > 0
  );
}

/**
 * Motivo para NÃO enviar uma notificação ao Teams (ou null quando deve enviar). Notificações
 * criadas antes da liberação do canal não são enviadas (evita uma enxurrada de avisos antigos).
 */
export function motivoParaNaoEnviar(
  cfg: ConfigTeams,
  criadaEm: string | null | undefined,
): string | null {
  if (!cfg.ativo) return "desativado";
  if (!teamsLiberado(cfg)) return "nao_configurado";
  if (criadaEm && cfg.liberado_em && new Date(criadaEm) < new Date(cfg.liberado_em))
    return "anterior_liberacao";
  return null;
}

/** Texto de erro seguro para gravar/exibir: nunca contém o endereço (com a assinatura) do fluxo. */
export function erroSeguro(mensagem: string) {
  return curto(mensagem.replace(/https?:\/\/\S+/gi, "[endereço do fluxo]"));
}

export function rotuloEstadoTeams(estado?: string | null) {
  if (estado === "enviado") return "Enviado";
  if (estado === "falha") return "Falhou";
  if (estado === "reservado") return "Enviando";
  return estado ?? "—";
}
