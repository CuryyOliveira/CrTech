import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useMaster } from "@/hooks/useMaster";

/**
 * PAINEL MASTER — camada de rota.
 *
 * Proteção em duas frentes: a rota só renderiza para a identidade Master
 * confirmada pelo servidor, e cada função do painel revalida essa identidade no
 * backend. Perfil, nível ou Matriz de Permissões não concedem esse acesso.
 */
export const Route = createFileRoute("/_authenticated/master")({
  component: MasterLayout,
});

function MasterLayout() {
  const { carregando, master } = useMaster();
  const navigate = useNavigate();

  useEffect(() => {
    if (!carregando && !master) navigate({ to: "/menu", replace: true });
  }, [carregando, master, navigate]);

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!master) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-2 p-8 text-center">
            <ShieldAlert className="mx-auto size-7 text-destructive" />
            <h1 className="font-bold">Acesso restrito</h1>
            <p className="text-sm text-muted-foreground">
              Esta área é exclusiva do proprietário do sistema.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
