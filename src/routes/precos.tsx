import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RodapeLegal } from "@/components/publico/RodapeLegal";
import { planosPublicos, type PlanoPublico } from "@/lib/planos-publicos.functions";

const TITULO = "Preços e planos — C.R Tech";
const DESCRICAO =
  "Planos e valores do Conferência Rápida: assinatura mensal a partir de R$ 79, com 14 dias de teste grátis e cancelamento a qualquer momento.";

export const Route = createFileRoute("/precos")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // Os valores da vitrine vêm do mesmo catálogo usado no checkout (produção).
  loader: () => planosPublicos({ data: { ambiente: "live" } }),
  component: Precos,
});

/** Benefícios apresentados por família de plano. */
const BENEFICIOS: Record<string, string[]> = {
  essencial: [
    "Conferências de estoque e itens diversos",
    "Histórico completo das contagens",
    "Relatórios em Excel e PDF",
  ],
  profissional: [
    "Módulos personalizados por empresa",
    "Notificações por e-mail das conferências",
    "Painel gerencial e metas",
  ],
  empresarial: [
    "Unidades, setores e frota sem limite",
    "Auditoria e monitoramento em tempo real",
    "Relatórios agendados automáticos",
  ],
};

function familia(codigo: string) {
  return codigo.split("_")[0] ?? codigo;
}

function moeda(centavos: number | null, m: string) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: m || "BRL",
    minimumFractionDigits: 0,
  });
}

function Precos() {
  const planos = Route.useLoaderData() as PlanoPublico[];
  const mensais = planos.filter((p) => p.periodicidade === "mensal");
  const anuais = planos.filter((p) => p.periodicidade === "anual");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-10">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Preços simples e transparentes</h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Assinatura por empresa, com 14 dias de teste grátis. Sem taxa de instalação e
            cancelamento a qualquer momento. Valores em reais (BRL), cobrados de forma recorrente
            pelo Mercado Pago.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {mensais.map((p) => {
            const fam = familia(p.codigo);
            const anual = anuais.find((a) => familia(a.codigo) === fam);
            return (
              <Card key={p.codigo} className={fam === "profissional" ? "border-primary shadow-md" : undefined}>
                <CardContent className="flex h-full flex-col gap-4 p-6">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">{p.nome}</h2>
                    <p className="text-3xl font-bold">
                      {moeda(p.valorCentavos, p.moeda)}
                      <span className="text-sm font-normal text-muted-foreground">/mês</span>
                    </p>
                    {anual && (
                      <p className="text-xs text-muted-foreground">
                        ou {moeda(anual.valorCentavos, anual.moeda)} por ano
                      </p>
                    )}
                    {p.descricao && (
                      <p className="text-sm text-muted-foreground">{p.descricao}</p>
                    )}
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>
                        {p.maxUsuarios ? `Até ${p.maxUsuarios} usuários ativos` : "Usuários conforme contrato"}
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>
                        {p.maxModulos
                          ? `Até ${p.maxModulos} módulos de conferência`
                          : "Módulos de conferência sem limite"}
                      </span>
                    </li>
                    {(BENEFICIOS[fam] ?? []).map((i) => (
                      <li key={i} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-auto w-full">
                    <Link to="/entrar">Começar teste de {p.diasTrial || 14} dias</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <section className="space-y-2 text-sm text-muted-foreground">
          <h2 className="text-base font-semibold text-foreground">O que está incluído</h2>
          <p>
            Todos os planos incluem acesso pelo navegador e pelo celular (aplicativo instalável),
            funcionamento offline com sincronização automática, assinatura digital das conferências,
            controle de acesso por perfil e suporte por e-mail.
          </p>
          <p>
            Condições para operações maiores podem ser combinadas pelo e-mail
            contato@conferenciarapida.com.br. Os valores podem ser reajustados com aviso prévio de
            30 dias.
          </p>
        </section>
      </main>
      <RodapeLegal />
    </div>
  );
}
