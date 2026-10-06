import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardCheck,
  FileSpreadsheet,
  PenTool,
  WifiOff,
  BarChart3,
  ShieldCheck,
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

const TITULO = "Conferência de estoque e materiais na palma da mão | Conferência Rápida";
const DESCRICAO =
  "Sistema para conferir estoque, ferramentas e frota item por item: importação de planilha, uso offline, assinatura digital e relatórios. Teste grátis por 14 dias.";

export const Route = createFileRoute("/")({
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
  component: LandingPage,
});

const DORES = [
  {
    titulo: "Contagem em papel que ninguém confere depois",
    texto:
      "Folhas soltas, letras ilegíveis e nenhum registro de quem contou o quê. No Conferência Rápida cada item conferido fica gravado com responsável, horário e observação.",
  },
  {
    titulo: "Planilha que se perde entre versões",
    texto:
      "Importe a lista de materiais em Excel e conte direto no celular. O resultado sai pronto em Excel e PDF, sem digitar duas vezes.",
  },
  {
    titulo: "Divergência descoberta tarde demais",
    texto:
      "Cada contagem separa itens corretos, divergentes e pendentes em tempo real, e avisa os responsáveis por e-mail ao concluir.",
  },
  {
    titulo: "Almoxarifado sem sinal de internet",
    texto:
      "O aplicativo funciona offline no celular e sincroniza tudo automaticamente quando a conexão volta.",
  },
];

const RECURSOS = [
  { icone: FileSpreadsheet, titulo: "Importação de planilha", texto: "Suba a lista em Excel e comece a conferir em minutos." },
  { icone: WifiOff, titulo: "Funciona offline", texto: "Conte sem internet; a sincronização acontece sozinha depois." },
  { icone: PenTool, titulo: "Assinatura digital", texto: "Conferente e responsável assinam na tela ao fechar a contagem." },
  { icone: BarChart3, titulo: "Histórico e relatórios", texto: "Tempo trabalhado, divergências e exportação em Excel e PDF." },
  { icone: ShieldCheck, titulo: "Perfis e permissões", texto: "Administrador, operação e módulos configuráveis por empresa." },
  { icone: ClipboardCheck, titulo: "Módulos sob medida", texto: "Estoque, ferramentaria, agrícola, indústria, frota — você define." },
];

const PASSOS = [
  { n: "1", titulo: "Crie sua conta", texto: "Teste grátis por 14 dias, sem instalar nada. Configure empresa, setores e módulos." },
  { n: "2", titulo: "Importe os materiais", texto: "Envie a planilha de itens ou cadastre manualmente por unidade." },
  { n: "3", titulo: "Confira item por item", texto: "No celular, com ou sem internet, registrando quantidade e observações." },
  { n: "4", titulo: "Feche e compartilhe", texto: "Assinatura digital, e-mail automático e relatório em Excel ou PDF." },
];

const FAQ = [
  {
    p: "Preciso instalar algum programa?",
    r: "Não. O Conferência Rápida funciona no navegador do computador e do celular, e pode ser instalado como aplicativo (PWA) na tela inicial.",
  },
  {
    p: "Funciona sem internet no depósito?",
    r: "Sim. Depois do primeiro acesso, o aplicativo guarda os dados no aparelho de forma criptografada, permite conferir offline e sincroniza quando a conexão voltar.",
  },
  {
    p: "Consigo usar minha planilha atual?",
    r: "Sim. A importação aceita planilhas em Excel com código, descrição, unidade e quantidade esperada, reconhecendo variações comuns de nome de coluna.",
  },
  {
    p: "Quanto custa e como é o teste grátis?",
    r: "Os planos começam em R$ 79/mês e todos incluem 14 dias de teste grátis. Você pode cancelar quando quiser, direto no painel.",
  },
  {
    p: "Serve para outros tipos de conferência além de estoque?",
    r: "Sim. Os módulos são configuráveis por empresa: almoxarifado, ferramentaria, insumos agrícolas, peças de indústria, frota e outros.",
  },
];

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ClipboardCheck className="size-5" />
            </div>
            <span className="font-bold tracking-tight">Conferência Rápida</span>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/controle-de-estoque"
              className="hidden px-2 font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Controle de estoque
            </Link>
            <Link
              to="/controle-de-ferramentas"
              className="hidden px-2 font-medium text-muted-foreground hover:text-foreground lg:inline"
            >
              Ferramentas
            </Link>
            <Link
              to="/contagem-de-estoque"
              className="hidden px-2 font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Contagem de estoque
            </Link>

            <Link
              to="/inventario-de-estoque"
              className="hidden px-2 font-medium text-muted-foreground hover:text-foreground lg:inline"
            >
              Inventário
            </Link>
            <Link to="/precos" className="px-2 font-medium text-muted-foreground hover:text-foreground">
              Preços
            </Link>
            <Button asChild size="sm" variant="outline">
              <Link to="/entrar">Entrar</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Herói */}
        <section className="mx-auto w-full max-w-5xl px-4 py-14 md:py-20">
          <div className="max-w-3xl space-y-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              C.R Tech · Conferência de materiais
            </p>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
              Confere+
            </h1>
            <p className="text-lg font-bold text-foreground">
              Mais praticidade e agilidade a sua conferência
            </p>
            <p className="text-lg text-muted-foreground">
              Importe sua planilha, confira item por item no celular (mesmo offline) e feche cada
              contagem com assinatura digital, divergências apuradas e relatório pronto.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/entrar">Começar teste grátis de 14 dias</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/precos">Ver planos e preços</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              A partir de R$ 79/mês · sem cartão para começar · cancele quando quiser
            </p>
          </div>
        </section>

        {/* Dores */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto w-full max-w-5xl px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              O que costuma dar errado na contagem
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {DORES.map((d) => (
                <Card key={d.titulo}>
                  <CardContent className="space-y-2 p-6">
                    <h3 className="font-semibold">{d.titulo}</h3>
                    <p className="text-sm text-muted-foreground">{d.texto}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Recursos */}
        <section className="mx-auto w-full max-w-5xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Tudo que a conferência precisa em um só lugar
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
              <div key={titulo} className="rounded-xl border p-5">
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icone className="size-5" />
                </div>
                <h3 className="font-semibold">{titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Como funciona */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto w-full max-w-5xl px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Como funciona</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-4">
              {PASSOS.map((p) => (
                <li key={p.n} className="rounded-xl border bg-background p-5">
                  <div className="mb-3 flex size-8 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                    {p.n}
                  </div>
                  <h3 className="font-semibold">{p.titulo}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto w-full max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Perguntas frequentes</h2>
          <Accordion type="single" collapsible className="mt-6">
            {FAQ.map((item, i) => (
              <AccordionItem key={item.p} value={`faq-${i}`}>
                <AccordionTrigger className="text-left">{item.p}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{item.r}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* CTA final */}
        <section className="border-t">
          <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-14 text-center">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              Comece sua primeira conferência hoje
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              14 dias de teste grátis para testar com a sua própria planilha e a sua equipe.
            </p>
            <Button asChild size="lg">
              <Link to="/entrar">Criar conta grátis</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Ainda conta pelo Excel?{" "}
              <Link to="/contagem-de-estoque" className="font-medium text-primary hover:underline">
                Veja o checklist e o modelo de planilha de contagem de estoque
              </Link>{" "}
              , entenda como funciona o{" "}
              <Link to="/controle-de-estoque" className="font-medium text-primary hover:underline">
                controle de estoque sem planilha
              </Link>{" "}
              ou veja o{" "}
              <Link to="/inventario-de-estoque" className="font-medium text-primary hover:underline">
                guia de inventário de estoque
              </Link>
              . Também há uma página dedicada ao{" "}
              <Link to="/controle-de-ferramentas" className="font-medium text-primary hover:underline">
                controle de ferramentas
              </Link>
              .

            </p>
          </div>
        </section>
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
