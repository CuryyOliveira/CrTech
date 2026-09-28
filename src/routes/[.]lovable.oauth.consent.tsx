import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Detalhes = {
  client?: { name?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // O cliente do backend lê a sessão do navegador (localStorage).
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s['authorization_id'] === "string" ? s['authorization_id'] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Autorização inválida (authorization_id ausente)");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/entrar", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const oauth = (supabase.auth as unknown as {
      oauth: {
        getAuthorizationDetails: (id: string) => Promise<{ data: Detalhes | null; error: Error | null }>;
      };
    }).oauth;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const imediato = data?.redirect_url ?? data?.redirect_to;
    if (imediato && !data?.client) throw redirect({ href: imediato });
    return data;
  },
  component: Consentimento,
  errorComponent: ({ error }) => (
    <Aviso texto={`Não foi possível carregar esta autorização: ${String((error as Error)?.message ?? error)}`} />
  ),
});

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">{texto}</CardContent>
      </Card>
    </div>
  );
}

function Consentimento() {
  const detalhes = Route.useLoaderData() as Detalhes | null;
  const { authorization_id } = Route.useSearch();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nome = detalhes?.client?.name ?? "o aplicativo";

  async function decidir(aprovar: boolean) {
    setOcupado(true);
    setErro(null);
    const oauth = (supabase.auth as unknown as {
      oauth: {
        approveAuthorization: (id: string) => Promise<{ data: Detalhes | null; error: Error | null }>;
        denyAuthorization: (id: string) => Promise<{ data: Detalhes | null; error: Error | null }>;
      };
    }).oauth;
    const { data, error } = aprovar
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setOcupado(false);
      setErro(error.message);
      return;
    }
    const destino = data?.redirect_url ?? data?.redirect_to;
    if (!destino) {
      setOcupado(false);
      setErro("O servidor de autorização não retornou um endereço de retorno.");
      return;
    }
    window.location.href = destino;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-6">
          <h1 className="text-lg font-bold tracking-tight">Conectar {nome} à sua conta</h1>
          <p className="text-sm text-muted-foreground">
            Isso permite que {nome} consulte as conferências e cadastros do Conferência Rápida em
            seu nome, sempre respeitando o seu perfil de acesso.
          </p>
          {erro && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {erro}
            </p>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={ocupado} onClick={() => void decidir(true)}>
              Autorizar
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={ocupado}
              onClick={() => void decidir(false)}
            >
              Recusar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
