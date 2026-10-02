import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { StatusConexao } from "@/components/StatusConexao";
import { SyncV2 } from "@/components/sync-v2/SyncV2";
import { MOTOR_V2_ATIVO } from "@/lib/conferencia-v2/flag";
import { registrarServiceWorker } from "@/lib/offline/sw";
import { SCRIPT_NAVEGADOR_ANTIGO } from "@/lib/navegador-antigo";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Conferência de Materiais — Acesso" },
      {
        name: "description",
        content:
          "Sistema de conferência de materiais da oficina: frota de caminhões, caixas de ferramentas e contagem de estoque.",
      },
      { name: "theme-color", content: "#ea580c" },
      {
        name: "google-site-verification",
        content: "xOtCkoiihsTaUrP851EmeXMvFFhyabw58uPVenl9mCE",
      },
      { property: "og:title", content: "Conferência de Materiais — Acesso" },
      {
        property: "og:description",
        content:
          "Sistema de conferência de materiais da oficina: frota de caminhões, caixas de ferramentas e contagem de estoque.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Conferência de Materiais — Acesso" },
      {
        name: "twitter:description",
        content:
          "Sistema de conferência de materiais da oficina: frota de caminhões, caixas de ferramentas e contagem de estoque.",
      },
      { property: "og:image", content: "https://conferenciarapida.com.br/icon-512.png" },
      { name: "twitter:image", content: "https://conferenciarapida.com.br/icon-512.png" },
    ],

    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],

    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://conferenciarapida.com.br/#organizacao",
              name: "C.R Tech",
              url: "https://conferenciarapida.com.br",
              email: "contato@conferenciarapida.com.br",
              contactPoint: [
                {
                  "@type": "ContactPoint",
                  contactType: "customer support",
                  email: "contato@conferenciarapida.com.br",
                  availableLanguage: ["pt-BR"],
                },
              ],
            },
            {
              "@type": "WebSite",
              "@id": "https://conferenciarapida.com.br/#site",
              name: "Conferência Rápida",
              url: "https://conferenciarapida.com.br",
              inLanguage: "pt-BR",
              publisher: { "@id": "https://conferenciarapida.com.br/#organizacao" },
            },
          ],
        }),
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* ES5 puro: em WebView desatualizado mostra como atualizar (nos atuais não faz nada). */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_NAVEGADOR_ANTIGO }} />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Cache das rotas e recursos: o aplicativo abre mesmo sem internet.
  useEffect(() => {
    registrarServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <StatusConexao />
      {MOTOR_V2_ATIVO && <SyncV2 />}
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
