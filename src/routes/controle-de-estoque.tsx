import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardCheck,
  CheckCircle2,
  WifiOff,
  FileSpreadsheet,
  PenLine,
  Users,
  History,
  MonitorSmartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { RodapeLegal } from "@/components/publico/RodapeLegal";

const TITULO = "Controle de estoque: saia da planilha sem parar a operação | Conferência Rápida";
const DESCRICAO =
  "Controle de estoque pelo celular, mesmo sem internet: contagem cega, divergências automáticas, assinatura digital e relatórios em Excel e PDF.";

export const Route = createFileRoute("/controle-de-estoque")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://conferenciarapida.com.br/controle-de-estoque" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "canonical", href: "https://conferenciarapida.com.br/controle-de-estoque" },
    ],
  }),
  component: ControleDeEstoque,
});

const PROBLEMAS = [
  "Duas pessoas editam a mesma planilha e uma sobrescreve a contagem da outra.",
  "A versão final ninguém sabe qual é: controle_final_v3_OK_agora_vai.xlsx.",
  "A fórmula da divergência é apagada sem ninguém perceber.",
  "No depósito, sem sinal no celular, a planilha simplesmente não abre.",
  "Não há registro de quem contou cada item, nem de quanto tempo levou.",
  "O ajuste no sistema sai sem trilha de auditoria nem assinatura de responsável.",
];

const RECURSOS = [
  {
    icone: WifiOff,
    titulo: "Funciona offline no depósito",
    texto:
      "Depois do primeiro acesso, os dados ficam criptografados no aparelho. A equipe confere sem internet e tudo sincroniza quando a conexão volta.",
  },
  {
    icone: Users,
    titulo: "Várias pessoas conferindo ao mesmo tempo",
    texto:
      "Cada conferente trabalha no seu celular com o próprio login. Nada de arquivo compartilhado nem versão sobrescrita.",
  },
  {
    icone: FileSpreadsheet,
    titulo: "Relatórios em Excel e PDF ao fechar",
    texto:
      "Ao concluir a conferência, o relatório sai com corretos, divergências e pendentes — sem montar fórmula nem cruzar abas.",
  },
  {
    icone: PenLine,
    titulo: "Assinatura digital e trilha de auditoria",
    texto:
      "Cada conferência registra conferente, responsável, horário de início e fim, pausas e assinatura. Toda alteração fica auditável.",
  },
  {
    icone: History,
    titulo: "Histórico completo de contagens",
    texto:
      "Compare contagens anteriores, veja a evolução das divergências por setor e prepare o próximo inventário com dados reais.",
  },
  {
    icone: MonitorSmartphone,
    titulo: "Acompanhamento em tempo real",
    texto:
      "O gestor vê o andamento de cada conferência ao vivo: itens conferidos, divergências encontradas e tempo trabalhado.",
  },
];

const PASSOS = [
  {
    titulo: "Importe a planilha que você já usa",
    texto:
      "O sistema reconhece planilhas em Excel com código, descrição, unidade e quantidade esperada — inclusive variações comuns de nome de coluna.",
  },
  {
    titulo: "Distribua a contagem para a equipe",
    texto:
      "Cada conferente abre o módulo no celular, vê a lista do seu setor e registra a quantidade encontrada, item a item.",
  },
  {
    titulo: "Feche com divergências calculadas",
    texto:
      "O sistema compara contado x esperado automaticamente, destaca o que precisa de recontagem e gera o relatório com assinaturas.",
  },
];

const FAQ = [
  {
    p: "O que é um sistema de controle de estoque?",
    r: "É uma ferramenta que registra o que entra, sai e permanece no estoque, permitindo conferir se a quantidade física bate com a registrada. No Conferência Rápida, o foco é a conferência: contagem no celular, divergências automáticas e relatório auditável.",
  },
  {
    p: "Preciso trocar meu ERP para usar?",
    r: "Não. O Conferência Rápida atua na camada de conferência física: você importa a lista de itens do seu sistema atual em Excel, faz a contagem e exporta o resultado com as divergências para ajustar onde quiser.",
  },
  {
    p: "Funciona sem internet no depósito?",
    r: "Sim. Após o primeiro acesso, o aplicativo guarda os dados no aparelho de forma criptografada, permite conferir totalmente offline e sincroniza automaticamente quando a conexão retorna.",
  },
  {
    p: "Consigo continuar usando minha planilha de controle de estoque?",
    r: "Sim. A planilha vira a fonte de importação: você sobe o arquivo, o sistema monta a lista de conferência e devolve o resultado em Excel e PDF. Veja também o guia de contagem de estoque com modelo de planilha.",
  },
  {
    p: "Quanto custa?",
    r: "Os planos começam em R$ 79/mês com 14 dias de teste grátis, sem compromisso. Consulte a página de preços para comparar os limites de usuários e módulos.",
  },
];

function ControleDeEstoque() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ClipboardCheck className="size-5" />
            </div>
            <span className="font-bold tracking-tight">Conferência Rápida</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/precos" className="px-2 font-medium text-muted-foreground hover:text-foreground">
              Preços
            </Link>
            <Button asChild size="sm" variant="outline">
              <Link to="/entrar">Entrar</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <article className="space-y-12">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              Controle de estoque
            </p>
            <h1 className="text-4xl font-bold tracking-tight">
              Controle de estoque pelo celular, mesmo sem internet no depósito
            </h1>
            <p className="text-lg text-muted-foreground">
              O Conferência Rápida substitui a planilha compartilhada por uma conferência digital:
              cada pessoa conta no próprio celular, as divergências aparecem sozinhas e o relatório
              sai assinado em Excel e PDF. Sem parar a operação e sem perder a planilha que você já
              tem — ela vira a lista de importação.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/entrar">Começar teste grátis de 14 dias</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/contagem-de-estoque">Ver o guia de contagem de estoque</Link>
              </Button>
            </div>
          </div>

          {/* Problemas da planilha */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Por que o controle de estoque em planilha trava a operação
            </h2>
            <p className="text-muted-foreground">
              A planilha funciona enquanto uma pessoa conta sozinha em um único local. Quando a
              operação cresce, aparecem os mesmos problemas em quase toda empresa:
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {PROBLEMAS.map((p) => (
                <li key={p} className="flex gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Recursos */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              O que muda com o controle de estoque digital
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
                <Card key={titulo}>
                  <CardContent className="space-y-2 p-5">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icone className="size-5" />
                    </div>
                    <h3 className="font-semibold">{titulo}</h3>
                    <p className="text-sm text-muted-foreground">{texto}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Como funciona */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Como funciona na prática</h2>
            <ol className="space-y-3">
              {PASSOS.map((passo, i) => (
                <li key={passo.titulo} className="flex gap-3 rounded-xl border bg-card p-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
                    {i + 1}
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold">{passo.titulo}</h3>
                    <p className="text-sm text-muted-foreground">{passo.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* CTA */}
          <section className="space-y-4 rounded-2xl border bg-muted/30 p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Faça a próxima contagem fora da planilha
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Importe sua lista atual e teste com a equipe por 14 dias, grátis. Planos a partir de
              R$ 79/mês.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/entrar">Começar teste grátis</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/precos">Ver planos e preços</Link>
              </Button>
            </div>
          </section>

          {/* FAQ */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Perguntas frequentes</h2>
            <Accordion type="single" collapsible>
              {FAQ.map((item, i) => (
                <AccordionItem key={item.p} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left">{item.p}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{item.r}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </article>
      </main>

      <RodapeLegal />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((item) => ({
              "@type": "Question",
              name: item.p,
              acceptedAnswer: { "@type": "Answer", text: item.r },
            })),
          }),
        }}
      />
    </div>
  );
}
