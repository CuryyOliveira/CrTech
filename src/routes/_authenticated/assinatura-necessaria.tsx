import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CreditCard, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAcesso } from "@/hooks/useAcesso";

export const Route = createFileRoute("/_authenticated/assinatura-necessaria")({
  head: () => ({
    meta: [
      { title: "Assinatura necessária — Conferência Rápida" },
      {
        name: "description",
        content:
          "Escolha um plano do Conferência Rápida para liberar os módulos de conferência da sua empresa.",
      },
      { property: "og:title", content: "Assinatura necessária — Conferência Rápida" },
      {
        property: "og:description",
        content: "Escolha um plano para liberar os módulos de conferência da sua empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssinaturaNecessaria,
});

/** FASE 6 — Tela de acesso bloqueado por falta de assinatura válida. */
function AssinaturaNecessaria() {
  const navigate = useNavigate();
  const { carregando, bloqueio, acesso } = useAcesso();

  // Empresas e usuários existentes nunca ficam nesta tela.
  useEffect(() => {
    if (carregando) return;
    if (!bloqueio) navigate({ to: "/menu", replace: true });
    else if (bloqueio === "sem_empresa") navigate({ to: "/bem-vindo", replace: true });
  }, [carregando, bloqueio, navigate]);

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const status = acesso?.plano?.status;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldAlert className="size-7" />
          </div>
          <h1 className="text-xl font-bold">Sua assinatura é necessária</h1>
          <p className="text-sm text-muted-foreground">
            Escolha um plano para começar a utilizar o Conferência Rápida.
          </p>
          {status && (
            <p className="text-xs text-muted-foreground">
              Situação atual da assinatura: <strong>{status}</strong>
            </p>
          )}
          <Button asChild className="w-full">
            <Link to="/planos" aria-label="Ver os planos disponíveis">
              <CreditCard className="size-4" /> Ver planos
            </Link>
          </Button>
          <div className="space-y-2 pt-1 text-left">
            <p className="text-xs font-medium text-muted-foreground">
              Precisa revisar o que você cadastrou?
            </p>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/admin/$secao" params={{ secao: "minha-empresa" }}>
                Dados da empresa e segmento
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/admin/$secao" params={{ secao: "setores" }}>
                Setores da empresa
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link to="/admin/$secao" params={{ secao: "modulos" }}>
                Módulos da empresa
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

  );
}
