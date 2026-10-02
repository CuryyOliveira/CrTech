/**
 * Versão Android mais recente, lida da API pública do GitHub do repositório oficial.
 *
 * A consulta sem login ao GitHub tem limite por IP (60/hora), e os IPs de saída da Cloudflare
 * são compartilhados: o GitHub pode responder 403 (limite esgotado) mesmo com tudo certo aqui.
 * Por isso a última versão válida fica guardada em camadas que sobrevivem a um novo deploy:
 *  1. memória da instância (1 hora);
 *  2. Cache API da Cloudflare (`caches.default`): consultado antes do GitHub (1 hora) e usado
 *     como "última versão conhecida" (30 dias) quando o GitHub falha;
 *  3. versão lida do GitHub no momento do deploy (variável VERSAO_ANDROID_DEPLOY, só
 *     {versionName, versionCode}), para um deploy novo já ter uma versão válida.
 * Tudo o que é lido dessas camadas passa pela mesma validação da resposta do endpoint.
 * Nenhum dado do cliente é usado para montar a consulta.
 */
import {
  compararVersoes,
  escolherRelease,
  lerVersaoRemota,
  REPOSITORIO_OFICIAL,
  type VersaoApp,
} from "./versao";

export const CACHE_VERSAO_MS = 3600_000;
/** Por quanto tempo a última versão válida é guardada para uso quando o GitHub falha. */
export const ULTIMA_CONHECIDA_MS = 30 * 24 * 3600_000;
/** Depois de uma falha do GitHub, esta instância espera isto antes de consultá-lo de novo. */
export const RETENTAR_APOS_FALHA_MS = 10 * 60_000;
const TIMEOUT_GITHUB_MS = 5000;
const API_RELEASES = `https://api.github.com/repos/${REPOSITORIO_OFICIAL}/releases?per_page=30`;
/** Chave interna do Cache API (nunca é servida a ninguém: o Worker responde antes do cache). */
const CHAVE_CACHE = "https://conferenciarapida.com.br/__interno/versao-android-v1";

type Registro = { valor: VersaoApp; em: number };

/** Armazenamento persistente da última versão válida (Cache API da Cloudflare em produção). */
export type ArmazemVersao = {
  ler(): Promise<unknown>;
  gravar(r: Registro): Promise<void>;
};

let memoria: Registro | null = null;

export function limparCacheVersao() {
  memoria = null;
}

/** Valida um registro lido de fora (cache ou variável): só versionName/versionCode válidos. */
function lerRegistro(dados: unknown): Registro | null {
  if (!dados || typeof dados !== "object") return null;
  const d = dados as Record<string, unknown>;
  const valor = lerVersaoRemota(d.valor);
  const em = typeof d.em === "number" && Number.isFinite(d.em) ? d.em : 0;
  return valor ? { valor, em } : null;
}

/** Cache API da Cloudflare; fora do Worker (Node, testes) não existe e nada é guardado. */
function armazemCloudflare(): ArmazemVersao | null {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return null;
  return {
    async ler() {
      const r = await cache.match(CHAVE_CACHE);
      return r ? ((await r.json()) as Registro) : null;
    },
    async gravar(reg) {
      await cache.put(
        CHAVE_CACHE,
        new Response(JSON.stringify(reg), {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${ULTIMA_CONHECIDA_MS / 1000}`,
          },
        }),
      );
    },
  };
}

/** Versão gravada no deploy (JSON {versionName, versionCode}); inválida ou ausente → null. */
export function versaoDoDeploy(bruto: unknown): VersaoApp | null {
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  try {
    return lerVersaoRemota(JSON.parse(bruto));
  } catch {
    return null;
  }
}

function maior(a: VersaoApp | null, b: VersaoApp | null): VersaoApp | null {
  if (!a) return b;
  if (!b) return a;
  return compararVersoes(b.versionName, a.versionName) > 0 ? b : a;
}

async function consultarGithub(
  f: typeof fetch,
  timeoutMs: number,
): Promise<{ valor: VersaoApp | null; motivo?: string }> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resp = await f(API_RELEASES, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "conferencia-rapida",
        "x-github-api-version": "2022-11-28",
      },
      signal: controle.signal,
      redirect: "manual", // redirecionamento (3xx) não é seguido: conta como falha
    });
    if (!resp.ok) {
      const restante = resp.headers.get("x-ratelimit-remaining");
      return { valor: null, motivo: `HTTP ${resp.status} (limite restante: ${restante ?? "?"})` };
    }
    const valor = escolherRelease(await resp.json());
    return valor ? { valor } : { valor: null, motivo: "nenhuma release oficial válida" };
  } catch (e) {
    return { valor: null, motivo: controle.signal.aborted ? "timeout" : `rede: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function versaoAndroidMaisRecente(
  opcoes: {
    fetch?: typeof fetch;
    agora?: () => number;
    timeoutMs?: number;
    armazem?: ArmazemVersao | null;
    deploy?: unknown;
  } = {},
): Promise<VersaoApp | null> {
  const agora = (opcoes.agora ?? Date.now)();
  if (memoria && agora - memoria.em < CACHE_VERSAO_MS) return memoria.valor;

  const armazem = opcoes.armazem === undefined ? armazemCloudflare() : opcoes.armazem;
  // Tudo o que vem do armazenamento é validado de novo (pode estar corrompido ou adulterado).
  const guardado = lerRegistro(await armazem?.ler().catch(() => null));
  const guardadoValido = guardado && agora - guardado.em < ULTIMA_CONHECIDA_MS ? guardado : null;
  if (guardadoValido && agora - guardadoValido.em < CACHE_VERSAO_MS) {
    memoria = guardadoValido;
    return guardadoValido.valor;
  }

  const { valor, motivo } = await consultarGithub(
    opcoes.fetch ?? fetch,
    opcoes.timeoutMs ?? TIMEOUT_GITHUB_MS,
  );
  if (valor) {
    memoria = { valor, em: agora };
    await armazem?.gravar(memoria).catch(() => undefined);
    return valor;
  }

  // GitHub fora do ar, lento ou com limite esgotado: última versão válida conhecida, se houver.
  const deploy = versaoDoDeploy(
    "deploy" in opcoes ? opcoes.deploy : process.env.VERSAO_ANDROID_DEPLOY,
  );
  const reserva = maior(maior(memoria?.valor ?? null, guardadoValido?.valor ?? null), deploy);
  // Não insiste no GitHub a cada pedido (agravaria o limite): tenta de novo em alguns minutos.
  if (reserva) memoria = { valor: reserva, em: agora - CACHE_VERSAO_MS + RETENTAR_APOS_FALHA_MS };
  console.warn(
    `versao-android: GitHub indisponível (${motivo}); ${
      reserva ? `usando a última versão conhecida ${reserva.versionName}` : "sem versão conhecida"
    }`,
  );
  return reserva;
}
