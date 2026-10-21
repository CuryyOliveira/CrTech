import { Link } from "@tanstack/react-router";

/** Rodapé público com os links legais exigidos para venda online. */
export function RodapeLegal() {
  return (
    <footer className="border-t bg-muted/30 px-4 py-8 text-sm">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">C.R Tech</p>
          <p className="text-muted-foreground">
            Conferência Rápida — sistema de conferência e inventário de materiais.
          </p>
          <p className="text-muted-foreground">
            Contato: contato@conferenciarapida.com.br
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            Início
          </Link>
          <Link to="/precos" className="text-muted-foreground hover:text-foreground">
            Preços
          </Link>
          <Link to="/privacidade" className="text-muted-foreground hover:text-foreground">
            Política de Privacidade
          </Link>
          <Link to="/termos" className="text-muted-foreground hover:text-foreground">
            Termos de Uso
          </Link>
          <Link to="/reembolso" className="text-muted-foreground hover:text-foreground">
            Política de Reembolso
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Moldura das páginas públicas de conteúdo/legais. */
export function PaginaPublica({
  titulo,
  atualizado,
  children,
}: {
  titulo: string;
  atualizado?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          {atualizado && (
            <p className="text-sm text-muted-foreground">Última atualização: {atualizado}</p>
          )}
        </div>
        <div className="space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
        <Link to="/" className="inline-block text-sm font-medium text-primary hover:underline">
          ← Voltar ao início
        </Link>
      </main>
      <RodapeLegal />
    </div>
  );
}
