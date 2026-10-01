/**
 * Versão Android mais recente, lida da API pública do GitHub do repositório oficial.
 * Guarda o resultado por 1 hora (por instância do servidor) para não consultar o GitHub a cada
 * pedido. Nenhum dado do cliente é usado para montar a consulta.
 */
import { escolherRelease, REPOSITORIO_OFICIAL, type VersaoApp } from "./versao";

export const CACHE_VERSAO_MS = 3600_000;
const TIMEOUT_GITHUB_MS = 5000;
const API_RELEASES = `https://api.github.com/repos/${REPOSITORIO_OFICIAL}/releases?per_page=30`;

type Cache = { valor: VersaoApp; em: number } | null;
let cache: Cache = null;

export function limparCacheVersao() {
  cache = null;
}

export async function versaoAndroidMaisRecente(
  opcoes: { fetch?: typeof fetch; agora?: () => number; timeoutMs?: number } = {},
): Promise<VersaoApp | null> {
  const agora = (opcoes.agora ?? Date.now)();
  if (cache && agora - cache.em < CACHE_VERSAO_MS) return cache.valor;

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), opcoes.timeoutMs ?? TIMEOUT_GITHUB_MS);
  try {
    const resp = await (opcoes.fetch ?? fetch)(API_RELEASES, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "conferencia-rapida",
        "x-github-api-version": "2022-11-28",
      },
      signal: controle.signal,
      redirect: "manual", // redirecionamento (3xx) não é seguido: conta como falha
    });
    if (!resp.ok) return cache?.valor ?? null;
    const valor = escolherRelease(await resp.json());
    if (!valor) return cache?.valor ?? null;
    cache = { valor, em: agora };
    return valor;
  } catch {
    // GitHub fora do ar ou lento: usa o último valor conhecido, se houver.
    return cache?.valor ?? null;
  } finally {
    clearTimeout(timer);
  }
}
