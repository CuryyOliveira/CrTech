import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => {
  // Expõe as variáveis VITE_* do .env para o código do cliente e do servidor.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  );

  return {
  define,
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  server: { host: "::", port: 8080 },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Entrada do servidor em src/server.ts (tratamento de erros de SSR).
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // Cloudflare Workers por padrão (deploy com `npx wrangler deploy`); para um servidor Node,
    // use NITRO_PRESET=node-server e `npm start`.
    ...(command === "build"
      ? [
          nitro({
            preset: process.env.NITRO_PRESET || "cloudflare-module",
            output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
            cloudflare: { nodeCompat: true, deployConfig: true },
          }),
        ]
      : []),
    viteReact(),
    // Cache das rotas, JS, CSS e ícones para o aplicativo abrir sem internet.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      // O bundle do cliente fica em dist/client (build SSR do TanStack Start).
      outDir: "dist/client",
      devOptions: { enabled: false },
      workbox: {
        globDirectory: "dist/client",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Páginas visitadas ficam disponíveis offline (nunca cache-first).
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" && !url.pathname.startsWith("/~oauth"),
            handler: "NetworkFirst",
            options: {
              cacheName: "paginas",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\.(?:js|css|woff2|png|svg|ico)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "recursos",
              expiration: { maxEntries: 300 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  };
});
