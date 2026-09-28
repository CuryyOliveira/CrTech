/*
 * Service Worker do Conferência Rápida.
 *
 * Objetivo: permitir abrir o aplicativo (F5, fechar e reabrir) sem internet.
 * - Navegações: rede primeiro; sem conexão, devolve o app já guardado (shell).
 * - Recursos estáticos (JS/CSS/fontes/imagens): cache primeiro, atualizando em
 *   segundo plano.
 * - Nada de API/Supabase é cacheado: os dados vêm do IndexedDB do aplicativo.
 */

const VERSAO = "cr-v1";
const SHELL = `${VERSAO}-shell`;
const ATIVOS = `${VERSAO}-ativos`;
const RAIZ = "/";

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([RAIZ, "/manifest.webmanifest", "/favicon.png"]))
      .catch(() => null)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function ehApi(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_serverFn") ||
    url.pathname.startsWith("/.mcp") ||
    url.hostname.endsWith(".supabase.co")
  );
}

function ehEstatico(req, url) {
  return (
    req.destination === "script" ||
    req.destination === "style" ||
    req.destination === "font" ||
    req.destination === "image" ||
    url.pathname.startsWith("/assets/")
  );
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || ehApi(url)) return;

  // Navegação: rede primeiro (conteúdo fresco), com o app guardado como reserva.
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          void caches.open(SHELL).then((c) => c.put(RAIZ, copia));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match(req)) ??
            (await cache.match(RAIZ)) ??
            new Response("Aplicativo indisponível offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  if (!ehEstatico(req, url)) return;

  // Estáticos: cache primeiro e atualização silenciosa.
  evento.respondWith(
    caches.open(ATIVOS).then(async (cache) => {
      const guardado = await cache.match(req);
      const rede = fetch(req)
        .then((res) => {
          if (res && res.ok) void cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return guardado ?? (await rede) ?? Response.error();
    }),
  );
});
