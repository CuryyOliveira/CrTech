import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardCheck,
  CheckCircle2,
  WifiOff,
  PenLine,
  Users,
  History,
  Wrench,
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

const TITULO = "Controle de ferramentas: saída, devolução e responsável | Conferência Rápida";
const DESCRICAO =
  "Controle de ferramentas pelo celular, mesmo sem internet: registro de saída e devolução, responsável por item, assinatura digital e relatórios em Excel e PDF.";

export const Route = createFileRoute("/controle-de-ferramentas")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://conferenciarapida.com.br/controle-de-ferramentas" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "canonical", href: "https://conferenciarapida.com.br/controle-de-ferramentas" },
    ],
  }),
  component: ControleDeFerramentas,
});

const PROBLEMAS = [
  "Ferramenta sai do almoxarifado e ninguém sabe com quem ficou.",
  "O caderno de retirada some, molha ou fica ilegível.",
  "A devolução é anotada depois, de memória, e nunca bate.",
  "Sem sinal na oficina ou no campo, a planilha simplesmente não abre.",
  "Falta prova de quem retirou quando o item aparece danificado.",
  "A contagem periódica do ferramental leva o dia inteiro.",
];

const RECURSOS = [
  {
    icone: Wrench,
    titulo: "Saída e devolução item a item",
    texto:
      "Cada ferramenta é conferida pelo código ou pela descrição. O que saiu, o que voltou e o que está pendente fica visível na mesma lista.",
  },
  {
    icone: Users,
    titulo: "Responsável identificado",
    texto:
      "A retirada fica vinculada ao funcionário e ao setor, com login próprio de quem registrou. Nada de caderno compartilhado.",
  },
  {
    icone: WifiOff,
    titulo: "Funciona offline na oficina e no campo",
    texto:
      "Depois do primeiro acesso, os dados ficam criptografados no aparelho. A conferência acontece sem internet e sincroniza quando a conexão volta.",
  },
  {
    icone: PenLine,
    titulo: "Assinatura digital de responsabilidade",
    texto:
      "Ao fechar a conferência, conferente e responsável assinam na tela. Fica registrado horário de início, pausas e término.",
  },
  {
    icone: History,
    titulo: "Histórico de cada conferência",
    texto:
      "Compare conferências anteriores do ferramental, acompanhe perdas recorrentes por setor e planeje reposição com dados reais.",
  },
  {
    icone: MonitorSmartphone,
    titulo: "Acompanhamento em tempo real",
    texto:
      "O gestor vê no painel quantos itens já foram conferidos, quais divergiram e quanto tempo a equipe levou.",
  },
];

const PASSOS = [
  {
    titulo: "Importe a lista do ferramental",
    texto:
      "Suba a planilha em Excel com código, descrição, unidade e quantidade esperada de cada ferramenta. O sistema reconhece as variações mais comuns de nome de coluna.",
  },
  {
    titulo: "Registre saída, devolução e conferência",
    texto:
      "A equipe abre o módulo de ferramentas no celular e marca a quantidade encontrada de cada item, com observação e foto quando necessário.",
  },
  {
    titulo: "Feche com divergências e assinatura",
    texto:
      "O sistema compara o encontrado com o esperado, destaca faltas e sobras e gera o relatório assinado em Excel e PDF.",
  },
];

const FAQ = [
  {
    p: "O que é controle de ferramentas?",
    r: "É o registro de quais ferramentas a empresa possui, quem está com cada uma e quando foram devolvidas. No Conferência Rápida isso acontece por conferência: você importa a lista do ferramental, a equipe confere pelo celular e o resultado fica assinado e auditável.",
  },
  {
    p: "Dá para saber quem está com cada ferramenta?",
    r: "Sim. Cada registro fica vinculado ao funcionário, ao setor e ao usuário que fez o lançamento, com data e hora. O histórico mostra a sequência completa de conferências do item.",
  },
  {
    p: "Funciona sem internet na oficina ou no campo?",
    r: "Sim. Após o primeiro acesso, o aplicativo guarda os dados no aparelho de forma criptografada, permite conferir totalmente offline e sincroniza automaticamente quando a conexão retorna.",
  },
  {
    p: "Preciso comprar etiquetas ou leitor especial?",
    r: "Não é obrigatório. A busca por código ou descrição já resolve na maioria das operações, e o campo aceita a leitura de qualquer leitor que funcione como teclado.",
  },
  {
    p: "Quanto custa?",
    r: "Os planos começam em R$ 79/mês com 14 dias de teste grátis, sem compromisso. Consulte a página de preços para comparar os limites de usuários e módulos.",
  },
];

function ControleDeFerramentas() {
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
              Controle de ferramentas
            </p>
            <h1 className="text-4xl font-bold tracking-tight">
              Controle de ferramentas com responsável, assinatura e conferência offline
            </h1>
            <p className="text-lg text-muted-foreground">
              Saiba o que saiu do almoxarifado, com quem está e o que voltou. A equipe confere o
              ferramental pelo celular, mesmo sem internet, e o relatório sai assinado em Excel e
              PDF — usando a planilha que você já tem como lista de importação.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/entrar">Começar teste grátis de 14 dias</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/controle-de-estoque">Ver o controle de estoque</Link>
              </Button>
            </div>
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Por que o caderno de ferramentas nunca fecha
            </h2>
            <p className="text-muted-foreground">
              O controle manual funciona enquanto poucas pessoas retiram ferramentas em um único
              turno. Quando a operação cresce, os problemas se repetem:
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

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              O que muda com o controle de ferramentas digital
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

          <section className="space-y-4 rounded-2xl border bg-muted/30 p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Faça a próxima conferência do ferramental sem caderno
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
