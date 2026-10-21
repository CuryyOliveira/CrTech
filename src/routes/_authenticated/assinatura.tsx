import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  CreditCard,
  Loader2,
  Repeat,
  ShieldCheck,
  XCircle,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { ModuloGuard } from "@/components/ModuloGuard";
import { ambienteCobranca, STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { fmtDataHoraLocal } from "@/lib/datas";

import {
  alterarMeuPlano,
  cancelarMinhaAssinatura,
  minhaAssinaturaDetalhada,
} from "@/lib/assinatura-gestao.functions";
import { iniciarCheckoutMercadoPago, planosDisponiveis } from "@/lib/pagamentos.functions";

export const Route = createFileRoute("/_authenticated/assinatura")({
  head: () => ({
    meta: [
      { title: "Minha assinatura | Conferência Rápida" },
      {
        name: "description",
        content:
          "Acompanhe o plano contratado, valor, status, período de teste e próxima cobrança da assinatura da sua empresa.",
      },
      { property: "og:title", content: "Minha assinatura | Conferência Rápida" },
      {
        property: "og:description",
        content: "Gerencie o plano, cancele ou altere a assinatura da sua empresa com segurança.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssinaturaProtegida,
});

function moeda(centavos: number | null, m: string | null) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: m || "BRL" });
}

const PERIODICIDADE: Record<string, string> = { mensal: "por mês", anual: "por ano" };

function corStatus(status: string) {
  if (status === "ativa" || status === "trial") return "bg-emerald-600 text-white";
  if (status === "pagamento_pendente" || status === "suspensa") return "bg-amber-500 text-black";
  if (status === "cancelada" || status === "encerrada") return "bg-destructive text-white";
  return "bg-muted text-foreground";
}

/** Assinatura é exclusiva do administrador da empresa. */
function AssinaturaProtegida() {
  return (
    <ModuloGuard modulo="ADMIN" permitirSemAssinatura>
      <MinhaAssinatura />
    </ModuloGuard>
  );
}

function MinhaAssinatura() {
  const ambiente = ambienteCobranca();
  const queryClient = useQueryClient();
  const carregar = useServerFn(minhaAssinaturaDetalhada);
  const carregarPlanos = useServerFn(planosDisponiveis);
  const cancelar = useServerFn(cancelarMinhaAssinatura);
  const alterar = useServerFn(alterarMeuPlano);
  const iniciarCheckout = useServerFn(iniciarCheckoutMercadoPago);

  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [processando, setProcessando] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["minha-assinatura", ambiente],
    queryFn: () => carregar({ data: { ambiente } }),
  });
  const { data: catalogo } = useQuery({
    queryKey: ["planos-disponiveis", ambiente],
    queryFn: () => carregarPlanos({ data: { ambiente } }),
  });

  const assinatura = data?.assinatura ?? null;

  const outrosPlanos = useMemo(
    () => (catalogo?.planos ?? []).filter((p) => p.codigo !== assinatura?.planoCodigo),
    [catalogo, assinatura],
  );

  function recarregar() {
    void queryClient.invalidateQueries({ queryKey: ["minha-assinatura"] });
    void queryClient.invalidateQueries({ queryKey: ["planos-disponiveis"] });
    void queryClient.invalidateQueries({ queryKey: ["painel-assinaturas"] });
  }

  async function confirmarCancelamento() {
    setProcessando("cancelar");
    try {
      const r = await cancelar({ data: { ambiente } });
      toast.success(
        r.jaCancelada ? "Esta assinatura já estava cancelada." : "Assinatura cancelada",
        {
          description: r.acessoAte
            ? `Cobrança recorrente encerrada. Você continua com acesso até ${fmtDataHoraLocal(r.acessoAte)}.`
            : "O provedor confirmou o cancelamento da cobrança recorrente.",
        },
      );

      recarregar();
    } catch (e) {
      toast.error("Não foi possível cancelar", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setProcessando(null);
      setConfirmandoCancelamento(false);
    }
  }

  async function trocarPlano(codigo: string) {
    setProcessando(codigo);
    try {
      const r = await alterar({ data: { ambiente, planoCodigo: codigo } });
      if (r.requerNovoCheckout) {
        toast.info("É necessário autorizar a nova assinatura", {
          description: "Você será levado ao checkout oficial do provedor.",
        });
        const contexto = await iniciarCheckout({
          data: { planoCodigo: codigo, ambiente, origem: window.location.origin },
        });
        window.location.href = contexto.url;
        return;
      }
      toast.success("Plano alterado", {
        description: "O provedor confirmou o novo valor da cobrança recorrente.",
      });
      recarregar();
    } catch (e) {
      toast.error("Não foi possível alterar o plano", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setProcessando(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/menu">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" asChild>
          <Link to="/faturas">
            <Receipt className="size-4" /> Faturas e recibos
          </Link>
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Minha assinatura</h1>
        <p className="text-sm text-muted-foreground">
          Todos os dados abaixo são confirmados diretamente no provedor de pagamento. Nenhum valor
          ou status é definido pelo aplicativo.
        </p>
      </header>

      {ambiente === "sandbox" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Ambiente de <strong>teste</strong>: nenhuma cobrança real é processada.
        </div>
      )}

      {isLoading ? (
        <SkeletonLista linhas={3} />
      ) : error ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Não foi possível carregar a assinatura."}
        </div>
      ) : !assinatura ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {data?.empresaId
                ? "Sua empresa ainda não possui assinatura neste ambiente."
                : "Cadastre a empresa para contratar um plano."}
            </p>
            <Button asChild>
              <Link to="/planos">
                <CreditCard className="size-4" /> Ver planos
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              <CardTitle className="flex-1 text-base">
                {assinatura.planoNome ?? assinatura.planoCodigo ?? "Plano contratado"}
              </CardTitle>
              <Badge className={corStatus(assinatura.status)}>
                {STATUS_ASSINATURA_LABEL[assinatura.status] ?? assinatura.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-2xl font-bold">
                  {moeda(assinatura.valorCentavos, assinatura.moeda)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {assinatura.periodicidade
                    ? (PERIODICIDADE[assinatura.periodicidade] ?? assinatura.periodicidade)
                    : "—"}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
                <div>
                  <dt>Contratação</dt>
                  <dd className="text-foreground">
                    {assinatura.dataInicio ? fmtDataHoraLocal(assinatura.dataInicio) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Período de teste até</dt>
                  <dd className="text-foreground">
                    {assinatura.trialFim ? fmtDataHoraLocal(assinatura.trialFim) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Próxima cobrança</dt>
                  <dd className="text-foreground">
                    {assinatura.proximaCobranca
                      ? fmtDataHoraLocal(assinatura.proximaCobranca)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Usuários do plano</dt>
                  <dd className="text-foreground">
                    {assinatura.maxUsuarios ? `${assinatura.maxUsuarios} usuários` : "Ilimitados"}
                  </dd>
                </div>
                <div>
                  <dt>Módulos do plano</dt>
                  <dd className="text-foreground">
                    {assinatura.maxModulos
                      ? `${assinatura.maxModulos} módulos ativos`
                      : "Sem limite"}
                  </dd>
                </div>
                <div>
                  <dt>Acesso garantido até</dt>
                  <dd className="text-foreground">
                    {assinatura.periodoAtualFim
                      ? fmtDataHoraLocal(assinatura.periodoAtualFim)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Cancelamento</dt>
                  <dd className="text-foreground">
                    {assinatura.canceladaEm ? fmtDataHoraLocal(assinatura.canceladaEm) : "—"}
                    {assinatura.cancelarNoFimPeriodo && assinatura.periodoAtualFim
                      ? ` — acesso até ${fmtDataHoraLocal(assinatura.periodoAtualFim)}`
                      : ""}
                  </dd>
                </div>

                <div>
                  <dt>Provedor</dt>
                  <dd className="text-foreground">
                    {assinatura.provider === "mercadopago" ? "Mercado Pago" : assinatura.provider}
                  </dd>
                </div>
              </dl>

              {assinatura.avisoSincronizacao && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  {assinatura.avisoSincronizacao}
                </p>
              )}

              {assinatura.status !== "cancelada" && assinatura.status !== "encerrada" && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmandoCancelamento(true)}
                  disabled={processando !== null || !assinatura.gerenciavel}
                >
                  {processando === "cancelar" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  Cancelar assinatura
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Repeat className="size-4 text-primary" /> Alterar plano
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                O novo valor é o valor cadastrado do plano e é confirmado pelo provedor antes de
                valer. Upgrades e downgrades mantêm a mesma assinatura sempre que possível.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {outrosPlanos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum outro plano disponível.</p>
              ) : (
                outrosPlanos.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{p.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {moeda(p.valor_centavos, p.moeda)}{" "}
                        {p.periodicidade
                          ? (PERIODICIDADE[p.periodicidade] ?? p.periodicidade)
                          : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void trocarPlano(p.codigo)}
                      disabled={processando !== null}
                    >
                      {processando === p.codigo ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CalendarClock className="size-4" />
                      )}
                      {(p.valor_centavos ?? 0) > (assinatura.valorCentavos ?? 0)
                        ? "Fazer upgrade"
                        : "Mudar para este"}
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={confirmandoCancelamento} onOpenChange={setConfirmandoCancelamento}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              A cobrança recorrente será encerrada no provedor. Você poderá contratar um plano
              novamente a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter assinatura</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmarCancelamento()}>
              Cancelar assinatura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
