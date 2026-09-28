import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { RodapeLegal } from "@/components/publico/RodapeLegal";

const TITULO = "Inventário de estoque: tipos e passo a passo da auditoria | Conferência Rápida";
const DESCRICAO =
  "Guia de inventário de estoque: diferenças entre inventário geral, cíclico e rotativo, passo a passo da auditoria e como sair da digitação manual.";
const URL = "https://conferenciarapida.com.br/inventario-de-estoque";

export const Route = createFileRoute("/inventario-de-estoque")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: InventarioDeEstoque,
});

const TIPOS = [
  {
    titulo: "Inventário geral",
    quando: "Uma ou duas vezes por ano, normalmente no fechamento contábil.",
    texto:
      "Todos os itens do estoque são contados no mesmo período, com a movimentação parada ou congelada. Dá a foto mais completa, mas exige mais gente e costuma interromper a operação.",
  },
  {
    titulo: "Inventário cíclico",
    quando: "Em ciclos fixos, por setor, família de material ou depósito.",
    texto:
      "O estoque é dividido em blocos e cada bloco é contado dentro do seu ciclo. Ao fim do período, tudo foi conferido pelo menos uma vez, sem parar a empresa de uma só vez.",
  },
  {
    titulo: "Inventário rotativo",
    quando: "Continuamente, priorizando itens de maior valor ou giro.",
    texto:
      "Os itens críticos são recontados com mais frequência que os demais (lógica de curva ABC). É o formato que encontra divergência mais cedo e reduz surpresa no fechamento.",
  },
  {
    titulo: "Inventário por amostragem",
    quando: "Como verificação pontual entre contagens completas.",
    texto:
      "Confere-se um recorte representativo do estoque para medir a confiabilidade do saldo. Se a amostra apresentar muita divergência, amplia-se a contagem.",
  },
];

const PASSOS = [
  {
    titulo: "Defina escopo, data e responsáveis",
    texto:
      "Escolha o tipo de inventário, quais depósitos e setores entram, a data de corte e quem responde por cada equipe. Sem escopo definido, a divergência apurada não significa nada.",
  },
  {
    titulo: "Organize e identifique o estoque",
    texto:
      "Endereçamento em ordem, itens iguais no mesmo lugar, embalagens fechadas identificadas e materiais avariados separados. Boa parte das divergências nasce da desorganização física, não do erro de contagem.",
  },
  {
    titulo: "Congele a movimentação",
    texto:
      "Durante a contagem, entradas e saídas ficam suspensas ou registradas em área separada, para não contar duas vezes nem deixar item de fora.",
  },
  {
    titulo: "Extraia a lista de saldos do sistema",
    texto:
      "Tire do ERP a relação de código, descrição, unidade e quantidade esperada na data de corte. Essa é a base de comparação da auditoria.",
  },
  {
    titulo: "Faça a primeira contagem, de preferência cega",
    texto:
      "Na contagem cega o conferente não vê a quantidade esperada, o que evita a tentação de confirmar o saldo do sistema em vez de contar de fato.",
  },
  {
    titulo: "Recontar apenas o que divergiu",
    texto:
      "Compare contado x esperado e faça a segunda contagem só nos itens com diferença, com outra pessoa quando possível.",
  },
  {
    titulo: "Apure, justifique e ajuste",
    texto:
      "Classifique cada divergência (quebra, avaria, erro de lançamento, troca de código) antes de acertar o saldo. Ajuste sem causa apontada volta a acontecer no próximo inventário.",
  },
  {
    titulo: "Feche com relatório assinado",
    texto:
      "O inventário termina com um documento que mostra data, responsáveis, itens conferidos, divergências, justificativas e assinatura de quem aprovou.",
  },
];

const INDICADORES = [
  "Acuracidade do estoque: itens sem divergência ÷ itens contados × 100.",
  "Divergência em valor: soma financeira das diferenças, positivas e negativas.",
  "Cobertura: percentual do estoque conferido no período.",
  "Tempo de contagem por conferente e por setor.",
];

const MANUAL_VS_DIGITAL = [
  {
    titulo: "Anotação em papel e digitação depois",
    texto:
      "Cada item é anotado à mão e depois redigitado na planilha. É onde entram troca de dígito, linha pulada e item contado duas vezes — e ninguém consegue apontar em que etapa o erro aconteceu.",
  },
  {
    titulo: "Contagem direta no celular",
    texto:
      "O conferente registra a quantidade no aparelho, na própria prateleira. Não existe redigitação, e cada lançamento fica com autor e horário.",
  },
  {
    titulo: "Divergência calculada na hora",
    texto:
      "Como a quantidade esperada já está no sistema, a diferença aparece no momento da contagem e a recontagem começa ainda com a equipe no depósito.",
  },
  {
    titulo: "Fechamento auditável",
    texto:
      "Início, pausas, término, conferentes, assinatura e histórico ficam registrados, e o relatório sai em Excel e PDF sem montar fórmula.",
  },
];

const FAQ = [
  {
    p: "O que é inventário de estoque?",
    r: "É a contagem física dos materiais em estoque comparada ao saldo registrado no sistema, com apuração e justificativa das divergências encontradas. Serve tanto para o fechamento contábil quanto para o controle operacional do dia a dia.",
  },
  {
    p: "Qual a diferença entre inventário geral, cíclico e rotativo?",
    r: "No inventário geral todo o estoque é contado de uma vez, em um período definido. No cíclico o estoque é dividido em blocos contados em ciclos, até cobrir tudo. No rotativo a contagem é contínua e prioriza os itens de maior valor ou giro, que são recontados com mais frequência.",
  },
  {
    p: "Com que frequência devo fazer inventário?",
    r: "O inventário geral costuma acompanhar o fechamento anual. Além dele, contagens cíclicas ou rotativas ao longo do ano mantêm a acuracidade alta e evitam concentrar toda a divergência no fim do exercício.",
  },
  {
    p: "O que é contagem cega e por que usar?",
    r: "Na contagem cega o conferente não vê a quantidade esperada pelo sistema, apenas registra o que encontrou. Isso evita que ele confirme o saldo do sistema por conveniência e torna a divergência apurada mais confiável.",
  },
  {
    p: "Preciso trocar de ERP para digitalizar o inventário?",
    r: "Não. Você exporta a lista de saldos do sistema atual em Excel, faz a contagem no Conferência Rápida e devolve o resultado com as divergências para ajustar onde já trabalha.",
  },
  {
    p: "Dá para fazer inventário sem internet no depósito?",
    r: "Sim. Depois do primeiro acesso, o aplicativo guarda os dados no aparelho de forma criptografada, permite conferir totalmente offline e sincroniza quando a conexão volta.",
  },
];

function InventarioDeEstoque() {
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
            <Link
              to="/controle-de-estoque"
              className="hidden px-2 font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Controle de estoque
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

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <article className="space-y-12">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">
              Inventário de estoque
            </p>
            <h1 className="text-4xl font-bold tracking-tight">
              Inventário de estoque: tipos, passo a passo e como parar de digitar contagem
            </h1>
            <p className="text-lg text-muted-foreground">
              Um inventário confiável depende de três coisas: escopo definido, contagem feita sem
              olhar o saldo do sistema e divergência justificada antes do ajuste. Neste guia estão os
              tipos de inventário, a sequência completa da auditoria e o que muda quando a contagem
              sai do papel e vai direto para o celular.
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

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Tipos de inventário de estoque</h2>
            <p className="text-muted-foreground">
              A escolha do tipo define quanto a operação para e com que rapidez você descobre a
              divergência. Na prática, muitas empresas combinam o inventário geral anual com
              contagens cíclicas ou rotativas ao longo do ano.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {TIPOS.map((t) => (
                <Card key={t.titulo}>
                  <CardContent className="space-y-2 p-5">
                    <h3 className="font-semibold">{t.titulo}</h3>
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">
                      {t.quando}
                    </p>
                    <p className="text-sm text-muted-foreground">{t.texto}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Passo a passo da auditoria de inventário
            </h2>
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

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Indicadores para medir o resultado
            </h2>
            <p className="text-muted-foreground">
              Sem número, o inventário vira opinião. Estes quatro indicadores mostram se a
              acuracidade está melhorando de um ciclo para o outro:
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {INDICADORES.map((i) => (
                <li key={i} className="flex gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Da digitação manual para a contagem digital
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {MANUAL_VS_DIGITAL.map((m) => (
                <Card key={m.titulo}>
                  <CardContent className="space-y-2 p-5">
                    <h3 className="font-semibold">{m.titulo}</h3>
                    <p className="text-sm text-muted-foreground">{m.texto}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Veja também como fica o{" "}
              <Link to="/controle-de-estoque" className="font-medium text-primary hover:underline">
                controle de estoque sem planilha
              </Link>{" "}
              no dia a dia.
            </p>
          </section>

          <section className="space-y-4 rounded-2xl border bg-muted/30 p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Faça o próximo inventário sem redigitar nada
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Importe a lista de saldos do seu sistema e teste com a equipe por 14 dias, grátis.
              Planos a partir de R$ 79/mês.
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
