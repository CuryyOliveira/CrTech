/**
 * Regras do aviso de nova versão do APK (sem efeitos colaterais: usadas pelo site e pelo endpoint).
 *
 * Segurança:
 *  - o endereço de atualização é sempre montado a partir de uma constante (repositório oficial);
 *    a única parte variável é a versão, aceita só no formato MAJOR.MINOR.PATCH;
 *  - a versão remota só é aceita de releases oficiais (sem draft/prerelease, tag android-vX.Y.Z);
 *  - nunca há "atualização" para versão igual ou inferior (sem downgrade).
 */

export const REPOSITORIO_OFICIAL = "CuryyOliveira/CrTech";
export const URL_RELEASES = `https://github.com/${REPOSITORIO_OFICIAL}/releases`;
export const URL_RELEASE_MAIS_RECENTE = `${URL_RELEASES}/latest`;

/** Configuração (em milissegundos). */
export const CONFIG_ATUALIZACAO = {
  /** Intervalo mínimo entre consultas por aparelho. */
  intervaloVerificacaoMs: 12 * 3600_000,
  /** "Depois": não pergunta de novo neste período. */
  adiarMs: 3 * 24 * 3600_000,
  /** Depois de uma falha (sem rede, timeout, erro), espera este tempo para tentar de novo. */
  esperaAposFalhaMs: 3600_000,
  /** Tempo máximo da consulta ao endpoint. */
  timeoutMs: 8000,
};

/** APKs até a 2.0.2 não informam a versão: são tratados como esta. */
export const VERSAO_APK_SEM_IDENTIFICACAO = "2.0.2";

export type VersaoApp = { versionName: string; versionCode: number | null };

const NUM = "(?:0|[1-9]\\d{0,3})";
const RE_VERSAO = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}$`);
const RE_TAG = new RegExp(`^android-v(${NUM}\\.${NUM}\\.${NUM})$`);
const MAX_VERSION_CODE = 2_100_000_000; // limite do Android

export function versaoValida(v: unknown): v is string {
  return typeof v === "string" && RE_VERSAO.test(v);
}

export function codigoValido(c: unknown): c is number {
  return typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= MAX_VERSION_CODE;
}

/** Compara numericamente (2.0.10 > 2.0.9). Ambas precisam ser válidas. */
export function compararVersoes(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Há atualização somente se a versão remota for MAIOR que a instalada e, quando as duas têm
 * versionCode, o código remoto também for maior. Qualquer valor inválido → sem atualização.
 */
export function haAtualizacao(instalada: VersaoApp, remota: VersaoApp): boolean {
  if (!versaoValida(instalada.versionName) || !versaoValida(remota.versionName)) return false;
  if (compararVersoes(remota.versionName, instalada.versionName) <= 0) return false;
  if (codigoValido(instalada.versionCode) && codigoValido(remota.versionCode)) {
    return remota.versionCode > instalada.versionCode;
  }
  return true;
}

export function versaoDaTag(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const m = RE_TAG.exec(tag);
  return m ? m[1] : null;
}

/** Página oficial da release (montada aqui; nunca vem de fora). Versão inválida → /latest. */
export function urlDaRelease(versao: unknown): string {
  return versaoValida(versao) ? `${URL_RELEASES}/tag/android-v${versao}` : URL_RELEASE_MAIS_RECENTE;
}

/** Só aceita https://github.com/<repositório oficial>/releases/latest ou /releases/tag/android-vX.Y.Z. */
export function urlOficialPermitida(url: unknown): boolean {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.port !== "") return false;
  if (u.username || u.password || u.search || u.hash) return false;
  const base = `/${REPOSITORIO_OFICIAL}/releases`;
  if (u.pathname === `${base}/latest`) return url === URL_RELEASE_MAIS_RECENTE;
  const prefixo = `${base}/tag/`;
  if (!u.pathname.startsWith(prefixo)) return false;
  const versao = versaoDaTag(u.pathname.slice(prefixo.length));
  return versao !== null && url === urlDaRelease(versao);
}

type ReleaseGithub = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
};

/** versionCode publicado pelo workflow nas notas da release ("versionCode 14"). */
function codigoDasNotas(body: unknown): number | null {
  if (typeof body !== "string") return null;
  const m = /\bversionCode (\d{1,10})\b/.exec(body);
  const n = m ? Number(m[1]) : NaN;
  return codigoValido(n) ? n : null;
}

/** Escolhe a maior release oficial (ignora draft, prerelease e tags fora de android-vX.Y.Z). */
export function escolherRelease(releases: unknown): VersaoApp | null {
  if (!Array.isArray(releases)) return null;
  let melhor: VersaoApp | null = null;
  for (const r of releases as ReleaseGithub[]) {
    if (!r || typeof r !== "object" || r.draft !== false || r.prerelease !== false) continue;
    const versao = versaoDaTag(r.tag_name);
    if (!versao) continue;
    if (!melhor || compararVersoes(versao, melhor.versionName) > 0) {
      melhor = { versionName: versao, versionCode: codigoDasNotas(r.body) };
    }
  }
  return melhor;
}

/** Valida a resposta do endpoint: só versionName/versionCode (qualquer outro campo é ignorado). */
export function lerVersaoRemota(dados: unknown): VersaoApp | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Record<string, unknown>;
  if (!versaoValida(d.versionName)) return null;
  return {
    versionName: d.versionName,
    versionCode: codigoValido(d.versionCode) ? d.versionCode : null,
  };
}
