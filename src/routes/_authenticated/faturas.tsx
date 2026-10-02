import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Receipt,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { ModuloGuard } from "@/components/ModuloGuard";
import { ambienteCobranca } from "@/lib/cobranca";
import { fmtDataHoraLocal } from "@/lib/datas";
import { minhasFaturas } from "@/lib/faturas.functions";

export const Route = createFileRoute("/_authenticated/faturas")({
  head: () => ({
    meta: [
      { title: "Faturas e recibos | Conferência Rápida" },
      {
        name: "description",
        content:
          "Consulte as faturas, pagamentos aprovados, cobranças pendentes e recibos oficiais da assinatura da sua empresa.",
      },
      { property: "og:title", content: "Faturas e recibos | Conferência Rápida" },
      {
        property: "og:description",
        content:
          "Histórico de cobranças confirmado pelo provedor de pagamento, com recibo oficial de cada fatura.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FaturasProtegidas,
});

const STATUS_LABEL: Record<string, string> = {
  aprovado: "Pago",
  pendente: "Aguardando pagamento",
  recusado: "Recusado",
  estornado: "Estornado",
};

function moeda(centavos: number | null, m: string) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: m || "BRL" });
}

function IconeStatus({ status }: { status: string }) {
  if (status === "aprovado") return <CheckCircle2 className="size-5 text-emerald-600" />;
  if (status === "pendente") return <Clock className="size-5 text-amber-500" />;
  return <XCircle className="size-5 text-destructive" />;
}

function corStatus(status: string) {
  if (status === "aprovado") return "bg-emerald-600 text-white";
  if (status === "pendente") return "bg-amber-500 text-black";
  return "bg-destructive text-white";
}

/** Faturas são exclusivas do administrador da empresa. */
function FaturasProtegidas() {
  return (
    <ModuloGuard modulo="ADMIN" permitirSemAssinatura>
      <Faturas />
    </ModuloGuard>
  );
}

function Faturas() {
  const ambiente = ambienteCobranca();
  const queryClient = useQueryClient();
  const carregar = useServerFn(minhasFaturas);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["minhas-faturas", ambiente],
    queryFn: () => carregar({ data: { ambiente } }),
  });

  const faturas = data?.faturas ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/menu">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["minhas-faturas"] })}
          disabled={isFetching}
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Faturas e recibos</h1>
        <p className="text-sm text-muted-foreground">
          Cada cobrança abaixo foi registrada a partir da confirmação oficial do provedor de
          pagamento. Nenhum valor é definido ou alterado pelo aplicativo.
        </p>
      </header>

      {ambiente === "sandbox" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Ambiente de <strong>teste</strong>: as faturas exibidas não representam cobranças reais.
        </div>
      )}

      {isLoading ? (
        <SkeletonLista linhas={4} />
      ) : error ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Não foi possível carregar as faturas."}
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Receipt className="size-6" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Total pago neste ambiente</p>
                <p className="text-xl font-bold">
                  {moeda(data?.totalPagoCentavos ?? 0, data?.moeda ?? "BRL")}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/assinatura">
                  <CreditCard className="size-4" /> Minha assinatura
                </Link>
              </Button>
            </CardContent>
          </Card>

          {faturas.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {data?.empresaId
                    ? "Nenhuma cobrança registrada ainda. As faturas aparecem aqui automaticamente quando o provedor confirma cada pagamento — inclusive a primeira cobrança após o período de teste."
                    : "Cadastre a empresa para acompanhar as faturas."}
                </p>
                <Button asChild>
                  <Link to="/planos">
                    <CreditCard className="size-4" /> Ver planos
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Histórico de cobranças</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {faturas.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3"
                  >
                    <IconeStatus status={f.status} />
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-semibold">
                        {moeda(f.valorCentavos, f.moeda)}{" "}
                        <Badge className={`ml-1 ${corStatus(f.status)}`}>
                          {STATUS_LABEL[f.status] ?? f.status}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDataHoraLocal(f.ocorridoEm)}
                        {f.meioPagamento ? ` — ${f.meioPagamento}` : ""}
                      </p>
                      {f.descricao && (
                        <p className="text-xs text-muted-foreground">{f.descricao}</p>
                      )}
                      {f.motivoFalha && (
                        <p className="text-xs text-destructive">Motivo: {f.motivoFalha}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {f.numeroFatura
                          ? `Fatura ${f.numeroFatura}`
                          : f.provedorTransacao
                            ? `Transação ${f.provedorTransacao}`
                            : ""}
                      </p>
                    </div>
                    {f.urlRecibo ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={f.urlRecibo} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-4" /> Recibo
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Recibo indisponível</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
