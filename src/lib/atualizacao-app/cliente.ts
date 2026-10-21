/**
 * Aviso de nova versão no aplicativo Android (lado do site, dentro do WebView).
 *
 *  - Só roda no app Android (canal nativo CRNativo). No navegador comum não faz nada.
 *  - APK 2.0.3+ informa a versão em `window.__crVersaoApp` (injetado pelo app só no domínio
 *    oficial). APKs antigos não informam: são tratados como 2.0.2.
 *  - Consulta /api/public/versao-android no máximo a cada 12 h, só online, em silêncio.
 *  - "Atualizar agora" nunca baixa nada: pede ao app para abrir a página oficial no navegador.
 */
import {
  CONFIG_ATUALIZACAO,
  codigoValido,
  haAtualizacao,
  lerVersaoRemota,
  urlDaRelease,
  urlOficialPermitida,
  VERSAO_APK_SEM_IDENTIFICACAO,
  versaoValida,
  type VersaoApp,
} from "./versao";

export const ENDPOINT_VERSAO = "/api/public/versao-android";
const CHAVE = "cr.atualizacao.v1";

type CanalNativo = { postMessage: (dados: string) => void };
type JanelaApp = {
  __crVersaoApp?: unknown;
  __crAndroid?: unknown;
  CRNativo?: CanalNativo;
};

export type AppInstalado = {
  instalada: VersaoApp;
  /** true quando o APK informou a versão (2.0.3+) e sabe abrir a página oficial sozinho. */
  identificado: boolean;
};

type Estado = {
  ultimaVerificacao?: number;
  ultimaFalha?: number;
  adiadoAte?: number;
  remota?: VersaoApp;
};

export type Ambiente = {
  janela?: JanelaApp;
  armazenamento?: Pick<Storage, "getItem" | "setItem">;
  fetch?: typeof fetch;
  online?: () => boolean;
  agora?: () => number;
};

function janelaPadrao(): JanelaApp | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as JanelaApp);
}

function armazenamentoPadrao() {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function lerEstado(a: Ambiente): Estado {
  try {
    const bruto = (a.armazenamento ?? armazenamentoPadrao())?.getItem(CHAVE);
    const e = bruto ? (JSON.parse(bruto) as Estado) : {};
    return e && typeof e === "object" ? e : {};
  } catch {
    return {};
  }
}

function gravarEstado(a: Ambiente, e: Estado) {
  try {
    (a.armazenamento ?? armazenamentoPadrao())?.setItem(CHAVE, JSON.stringify(e));
  } catch {
    /* armazenamento indisponível: só deixa de lembrar o intervalo */
  }
}

/** App Android instalado (e sua versão) ou null fora do app. */
export function appInstalado(janela = janelaPadrao()): AppInstalado | null {
  if (!janela) return null;
  const canal = janela.CRNativo;
  const temCanal = !!canal && typeof canal.postMessage === "function";
  const v = janela.__crVersaoApp as Record<string, unknown> | undefined;
  if (temCanal && v && typeof v === "object" && versaoValida(v.versionName)) {
    return {
      instalada: {
        versionName: v.versionName,
        versionCode: codigoValido(v.versionCode) ? v.versionCode : null,
      },
      identificado: true,
    };
  }
  if (temCanal || janela.__crAndroid === true) {
    return {
      instalada: { versionName: VERSAO_APK_SEM_IDENTIFICACAO, versionCode: null },
      identificado: false,
    };
  }
  return null;
}

export type Atualizacao = { app: AppInstalado; remota: VersaoApp };

/**
 * Verifica (respeitando "Depois", intervalo e rede) se há versão nova. Nunca lança erro:
 * qualquer falha devolve null em silêncio.
 */
export async function verificarAtualizacao(a: Ambiente = {}): Promise<Atualizacao | null> {
  try {
    const app = appInstalado(a.janela ?? janelaPadrao());
    if (!app) return null;
    const agora = (a.agora ?? Date.now)();
    const estado = lerEstado(a);
    if (estado.adiadoAte && agora < estado.adiadoAte) return null;

    let remota = estado.remota ? lerVersaoRemota(estado.remota) : null;
    const recente =
      estado.ultimaVerificacao !== undefined &&
      agora - estado.ultimaVerificacao < CONFIG_ATUALIZACAO.intervaloVerificacaoMs;
    const falhouHaPouco =
      estado.ultimaFalha !== undefined &&
      agora - estado.ultimaFalha < CONFIG_ATUALIZACAO.esperaAposFalhaMs;

    if (!recente && !falhouHaPouco) {
      const online = a.online ?? (() => typeof navigator === "undefined" || navigator.onLine);
      if (!online()) return null; // sem internet: nem tenta
      remota = await consultar(a);
      if (remota)
        gravarEstado(a, { ...estado, ultimaVerificacao: agora, remota, ultimaFalha: undefined });
      else gravarEstado(a, { ...estado, ultimaFalha: agora });
    }
    if (!remota || !haAtualizacao(app.instalada, remota)) return null;
    return { app, remota };
  } catch {
    return null;
  }
}

async function consultar(a: Ambiente): Promise<VersaoApp | null> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), CONFIG_ATUALIZACAO.timeoutMs);
  try {
    const resp = await (a.fetch ?? fetch)(ENDPOINT_VERSAO, {
      signal: controle.signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!resp.ok) return null;
    return lerVersaoRemota(await resp.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Depois": não pergunta de novo por 3 dias. */
export function adiarAviso(a: Ambiente = {}) {
  const agora = (a.agora ?? Date.now)();
  gravarEstado(a, { ...lerEstado(a), adiadoAte: agora + CONFIG_ATUALIZACAO.adiarMs });
}

/**
 * "Atualizar agora": pede ao app Android para abrir a página oficial no navegador.
 *  - APK 2.0.3+: envia só a versão; o Java monta e valida o endereço (constante).
 *  - APK antigo: envia o endereço montado aqui a partir da mesma constante, conferido pela allowlist.
 * Devolve o endereço da página oficial (ou null se não foi possível pedir).
 */
export function abrirPaginaOficial(versao: string, a: Ambiente = {}): string | null {
  const janela = a.janela ?? janelaPadrao();
  const app = appInstalado(janela);
  const canal = janela?.CRNativo;
  if (!app || !canal || typeof canal.postMessage !== "function") return null;
  const url = urlDaRelease(versao);
  if (!urlOficialPermitida(url)) return null;
  const msg = app.identificado
    ? { tipo: "atualizacao", versao: versaoValida(versao) ? versao : "" }
    : { tipo: "externo", url };
  try {
    canal.postMessage(JSON.stringify(msg));
    return url;
  } catch {
    return null;
  }
}
