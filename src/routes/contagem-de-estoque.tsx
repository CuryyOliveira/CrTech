import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { RodapeLegal } from "@/components/publico/RodapeLegal";

const TITULO = "Contagem de estoque: checklist e modelo de planilha | Conferência Rápida";
const DESCRICAO =
  "Como fazer a contagem de estoque passo a passo: checklist pronto, modelo de planilha de controle de estoque e quando o Excel deixa de servir.";

export const Route = createFileRoute("/contagem-de-estoque")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContagemDeEstoque,
});

const COLUNAS = [
  { campo: "Código", exemplo: "MAT-0193", porque: "Identifica o item sem depender da descrição digitada à mão." },
  { campo: "Descrição", exemplo: "Graxa azul 500g", porque: "Permite que quem conta reconheça o material na prateleira." },
  { campo: "Unidade", exemplo: "UN, KG, L, CX", porque: "Evita confundir caixa com unidade na hora de somar." },
  { campo: "Local / prateleira", exemplo: "Corredor B — P16", porque: "Define a ordem da contagem e reduz item esquecido." },
  { campo: "Quantidade esperada", exemplo: "24", porque: "É a base da comparação; vem do sistema ou do último inventário." },
  { campo: "Quantidade contada", exemplo: "22", porque: "Preenchida no momento da contagem, nunca depois de memória." },
  { campo: "Divergência", exemplo: "-2", porque: "Contada menos esperada; é o número que gera ação." },
  { campo: "Observação", exemplo: "2 embalagens violadas", porque: "Explica a divergência para quem vai aprovar." },
  { campo: "Conferente", exemplo: "Ana B. Costa", porque: "Dá rastreabilidade: quem contou aquele item e quando." },
];

const CHECKLIST = [
  {
    fase: "Antes da contagem",
    itens: [
      "Congele movimentações: nada entra nem sai durante a conferência.",
      "Emita a lista de itens com quantidade esperada e local de armazenagem.",
      "Organize prateleiras, separe itens vencidos, avariados e devoluções.",
      "Defina duplas: quem conta e quem registra, com setor/área delimitada.",
      "Combine a regra da segunda contagem (o que será recontado e por quem).",
    ],
  },
  {
    fase: "Durante a contagem",
    itens: [
      "Conte por local, seguindo a ordem física do depósito — não pela planilha.",
      "Registre a quantidade encontrada sem olhar a esperada, para evitar viés.",
      "Anote observação sempre que houver avaria, embalagem aberta ou item sem código.",
      "Marque item não localizado como zero contado, nunca deixe em branco.",
      "Recontagem cega dos itens com divergência, feita por outra pessoa.",
    ],
  },
  {
    fase: "Depois da contagem",
    itens: [
      "Compare contado x esperado e classifique: corretos, divergentes e pendentes.",
      "Investigue as divergências maiores antes de qualquer ajuste no sistema.",
      "Registre o ajuste com responsável, data e motivo — não só o número final.",
      "Colha a assinatura do conferente e do responsável pelo setor.",
      "Guarde o relatório da contagem para comparar com o próximo inventário.",
    ],
  },
];

const LIMITES = [
  "Duas pessoas contam ao mesmo tempo e uma sobrescreve o arquivo da outra.",
  "Ninguém sabe qual é a versão final: contagem_final_v3_ok.xlsx.",
  "Não há registro de quem contou cada item nem de quanto tempo levou.",
  "Fórmula apagada sem ninguém perceber e a divergência sai errada.",
  "No celular, dentro do depósito e sem sinal, a planilha é impossível de preencher.",
  "Não existe assinatura nem trilha de auditoria para o ajuste feito no sistema.",
];

const FAQ = [
  {
    p: "Como fazer a contagem de estoque passo a passo?",
    r: "Congele as movimentações, emita a lista com quantidade esperada e local, conte por prateleira em duplas registrando a quantidade encontrada, faça recontagem cega das divergências e só então compare contado x esperado, investigue e registre o ajuste com responsável e assinatura.",
  },
  {
    p: "Qual a diferença entre inventário e contagem cíclica?",
    r: "O inventário geral conta todo o estoque em uma data, normalmente com a operação parada. A contagem cíclica conta uma parte a cada semana ou mês (por curva ABC ou por endereço), mantendo a operação funcionando e distribuindo o esforço ao longo do ano.",
  },
  {
    p: "Que colunas uma planilha de controle de estoque precisa ter?",
    r: "Código, descrição, unidade, local/prateleira, quantidade esperada, quantidade contada, divergência calculada, observação e o nome do conferente. Sem local e sem conferente a contagem não é auditável.",
  },
  {
    p: "Dá para usar minha planilha atual no Conferência Rápida?",
    r: "Sim. A importação aceita planilhas em Excel com código, descrição, unidade e quantidade esperada, reconhecendo variações comuns de nome de coluna.",
  },
  {
    p: "Preciso de internet no depósito para conferir?",
    r: "Não. Depois do primeiro acesso o aplicativo guarda os dados no aparelho de forma criptografada, permite conferir offline e sincroniza quando a conexão voltar.",
  },
];

function ContagemDeEstoque() {
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
              Guia prático · contagem de estoque
            </p>
            <h1 className="text-4xl font-bold tracking-tight">
              Contagem de estoque: checklist, modelo de planilha e quando trocar o Excel
            </h1>
            <p className="text-lg text-muted-foreground">
              Um roteiro para conferir estoque sem retrabalho: as colunas que a planilha de controle
              de estoque precisa ter, o checklist das três fases da contagem e os sinais de que o
              Excel já não dá conta do volume da sua operação.
            </p>
          </div>

          {/* Modelo de planilha */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Modelo de planilha de controle de estoque
            </h2>
            <p className="text-muted-foreground">
              Monte a sua planilha com estas nove colunas. Elas são o mínimo para que a contagem
              possa ser auditada depois — e são exatamente os campos que o Conferência Rápida
              reconhece na importação em Excel.
            </p>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Colunas recomendadas para uma planilha de contagem de estoque
                </caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="p-3 font-semibold">Coluna</th>
                    <th scope="col" className="p-3 font-semibold">Exemplo</th>
                    <th scope="col" className="p-3 font-semibold">Por que existe</th>
                  </tr>
                </thead>
                <tbody>
                  {COLUNAS.map((c) => (
                    <tr key={c.campo} className="border-t align-top">
                      <th scope="row" className="p-3 text-left font-medium">{c.campo}</th>
                      <td className="p-3 text-muted-foreground">{c.exemplo}</td>
                      <td className="p-3 text-muted-foreground">{c.porque}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">
              Dica: deixe a coluna de divergência como fórmula (contada − esperada) e nunca preencha
              a quantidade contada em casa ou no fim do dia — só no momento da contagem.
            </p>
          </section>

          {/* Checklist */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Checklist de contagem em 3 fases</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {CHECKLIST.map((bloco) => (
                <Card key={bloco.fase}>
                  <CardContent className="space-y-3 p-5">
                    <h3 className="font-semibold">{bloco.fase}</h3>
                    <ul className="space-y-2">
                      {bloco.itens.map((item) => (
                        <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Limites da planilha */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              Quando a planilha deixa de servir
            </h2>
            <p className="text-muted-foreground">
              A planilha resolve bem uma contagem pequena, feita por uma pessoa, em um único local.
              A partir daí ela começa a custar mais tempo do que economiza. Sinais típicos:
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {LIMITES.map((l) => (
                <li key={l} className="flex gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              O Conferência Rápida mantém o mesmo raciocínio da planilha — lista de itens,
              quantidade esperada, quantidade contada e divergência — mas com várias pessoas
              conferindo ao mesmo tempo, funcionando offline no celular, com histórico, tempo
              trabalhado, assinatura digital e relatório em Excel e PDF ao fechar a contagem.
            </p>
          </section>

          {/* CTA */}
          <section className="space-y-4 rounded-2xl border bg-muted/30 p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Teste com a sua própria planilha
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground">
              Importe a lista que você já usa e faça a próxima contagem no celular. Teste grátis por
              14 dias, a partir de R$ 79/mês depois.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/entrar">Começar teste grátis de 14 dias</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/controle-de-estoque">Como funciona o controle de estoque</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              <Link to="/precos" className="font-medium text-primary hover:underline">
                Ver planos e preços
              </Link>
            </p>
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
