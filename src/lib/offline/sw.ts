/**
 * Registro do Service Worker responsável pelo cache das rotas e recursos.
 * Nunca registra em desenvolvimento nem nas pré-visualizações da Lovable,
 * e aceita `?sw=off` para remover o registro do aplicativo.
 */

const CAMINHO = "/sw.js";

function bloqueado() {
  if (typeof window === "undefined") return true;
  if (!import.meta.env.PROD) return true;
  if (window.self !== window.top) return true;
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return true;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function remover() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registros = await navigator.serviceWorker.getRegistrations().catch(() => []);
  for (const r of registros) {
    const url = r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "";
    if (url.endsWith(CAMINHO)) await r.unregister().catch(() => null);
  }
}

export function registrarServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (bloqueado()) {
    void remover();
    return;
  }
  void navigator.serviceWorker.register(CAMINHO, { scope: "/" }).catch(() => null);
}
