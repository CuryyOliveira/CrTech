import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2, LockKeyhole, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAcesso } from "@/hooks/useAcesso";
import { supabase } from "@/integrations/supabase/client";
import { encerrarSessaoOffline } from "@/lib/offline/cofre";

export const Route = createFileRoute("/_authenticated/empresa-bloqueada")({
  head: () => ({
    meta: [
      { title: "Acesso suspenso — Conferência Rápida" },
      {
        name: "description",
        content:
          "O acesso da sua empresa ao Conferência Rápida está temporariamente suspenso. Fale com o suporte para regularizar.",
      },
      { property: "og:title", content: "Acesso suspenso — Conferência Rápida" },
      {
        property: "og:description",
        content: "O acesso da sua empresa está temporariamente suspenso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmpresaBloqueada,
});

/** Tela exibida quando o proprietário do sistema suspende o acesso da empresa. */
function EmpresaBloqueada() {
  const navigate = useNavigate();
  const { carregando, bloqueio } = useAcesso();

  useEffect(() => {
    if (carregando) return;
    if (bloqueio !== "empresa_bloqueada" && bloqueio !== "empresa_desativada") {
      navigate({ to: "/menu", replace: true });
    }
  }, [carregando, bloqueio, navigate]);

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const desativada = bloqueio === "empresa_desativada";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <LockKeyhole className="size-7" />
          </div>
          <h1 className="text-xl font-bold">
            {desativada ? "Conta desativada" : "Acesso temporariamente suspenso"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {desativada
              ? "A conta da sua empresa foi desativada. Todos os dados permanecem preservados e o acesso pode ser restabelecido."
              : "O acesso da sua empresa está suspenso pela administração do sistema."}{" "}
            Entre em contato com o suporte para regularizar a situação.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              encerrarSessaoOffline();
              await supabase.auth.signOut().catch(() => null);
              window.location.href = "/entrar";
            }}
          >
            <LogOut className="mr-2 size-4" /> Sair do sistema
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
