/** Estado de conexão do aplicativo: Online, Offline ou Sincronizando. */

export type EstadoConexao = "online" | "offline" | "sincronizando";

let estado: EstadoConexao = "online";
const ouvintes = new Set<(e: EstadoConexao) => void>();

function avisar() {
  for (const fn of ouvintes) fn(estado);
}

export function estadoConexao(): EstadoConexao {
  return estado;
}

export function definirEstado(novo: EstadoConexao) {
  if (estado === novo) return;
  estado = novo;
  avisar();
}

export function assinarConexao(fn: (e: EstadoConexao) => void) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/** true quando o navegador está sem rede (ou o servidor está inacessível). */
export function estaOffline() {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false || estado === "offline";
}

/** Marca queda de conexão detectada por uma falha de rede em requisição. */
export function marcarQueda() {
  definirEstado("offline");
}

/** Detecta se um erro é de rede (e não uma resposta do servidor). */
export function erroDeRede(e: unknown) {
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed")
  );
}
