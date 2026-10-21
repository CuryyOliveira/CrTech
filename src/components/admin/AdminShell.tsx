import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Crown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePermissoes } from "@/hooks/usePermissoes";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type Trilha = { label: string; to?: string };

/** Casca das telas administrativas: cabeçalho, breadcrumb e pesquisa global. */
export function AdminShell({
  titulo,
  descricao,
  trilha = [],
  acoes,
  voltar,
  children,
}: {
  titulo: string;
  descricao?: string;
  trilha?: Trilha[];
  acoes?: ReactNode;
  /** Botão "← Voltar" acima do título (telas de grupo da Central). */
  voltar?: { to: string; label: string };
  children: ReactNode;
}) {
  const { perfil, nome } = usePermissoes();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <h1 className="flex-1 text-lg font-bold tracking-tight">CENTRAL ADMINISTRATIVA</h1>
          {perfil === "proprietario" && (
            <Badge
              className="bg-amber-500 text-black hover:bg-amber-500"
              title={`${nome ?? "Você"} é o Proprietário do Sistema`}
            >
              <Crown className="mr-1 size-3.5" /> PROPRIETÁRIO
            </Badge>
          )}
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-56 pl-8"
              placeholder="Pesquisar no sistema..."
              aria-label="Pesquisa global"
            />
          </div>
          <ThemeToggle />
          <Button variant="outline" size="sm" asChild>
            <Link to="/menu">Tela inicial</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/menu">Início</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {trilha.map((t) => (
              <span key={t.label} className="flex items-center gap-1.5">
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {t.to ? (
                    <BreadcrumbLink asChild>
                      <Link to={t.to}>{t.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{t.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {voltar && (
          <Button variant="ghost" size="sm" className="-ml-2 h-11" asChild>
            <Link to={voltar.to}>
              <ArrowLeft className="size-4" aria-hidden /> {voltar.label}
            </Link>
          </Button>
        )}

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

/** Placeholder padrão das áreas ainda não implementadas. */
export function EmDesenvolvimento({ nome }: { nome: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="font-semibold">{nome}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Em desenvolvimento — será liberado nas próximas fases.
      </p>
    </div>
  );
}
