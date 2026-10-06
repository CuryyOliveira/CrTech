import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AcessoNegado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="size-7" />
          </div>
          <h1 className="text-xl font-bold">Acesso não autorizado</h1>
          <p className="text-sm text-muted-foreground">
            Você não possui permissão para acessar esta área.
          </p>
          <Button asChild className="w-full">
            <Link to="/menu">Voltar para a tela inicial</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
