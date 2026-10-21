import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Casca do Painel Master: identidade visual própria, separada da Central Administrativa. */
export function MasterShell({
  titulo,
  descricao,
  acoes,
  children,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <Crown className="size-5 text-amber-500" />
          <h1 className="flex-1 text-lg font-bold tracking-tight">PAINEL MASTER</h1>
          <Badge className="bg-amber-500 text-black hover:bg-amber-500">
            <ShieldCheck className="mr-1 size-3.5" /> PROPRIETÁRIO DO SISTEMA
          </Badge>
          <ThemeToggle />
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin">Central Administrativa</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/menu">Tela inicial</Link>
          </Button>
        </div>
        <nav
          aria-label="Navegação do Painel Master"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2"
        >
          {[
            { to: "/master", label: "Visão geral" },
            { to: "/master/empresas", label: "Empresas" },
            { to: "/master/auditoria", label: "Auditoria" },
            { to: "/master/restaurar", label: "Restaurar dados" },
          ].map((i) => (
            <Button key={i.to} variant="ghost" size="sm" asChild>
              <Link
                to={i.to}
                activeOptions={{ exact: i.to === "/master" }}
                activeProps={{ className: "bg-muted font-semibold" }}
              >
                {i.label}
              </Link>
            </Button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{titulo}</h2>
            {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
          </div>
          {acoes}
        </div>
        {children}
      </main>
    </div>
  );
}
