import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CreditCard, Receipt, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { painelAssinaturas } from "@/lib/assinaturas.functions";
import { ambienteCobranca, STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { fmtDataHoraLocal } from "@/lib/datas";

function moeda(centavos: number | null, m: string | null) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: m || "BRL",
  });
}

function corStatus(status: string) {
  if (status === "ativa" || status === "trial") return "bg-emerald-600 text-white";
  if (status === "pagamento_pendente" || status === "suspensa") return "bg-amber-500 text-black";
  if (status === "cancelada" || status === "encerrada") return "bg-destructive text-white";
  return "bg-muted text-foreground";
}

/** Painel de empresas, planos, assinaturas e pagamentos. */
export function Assinaturas() {
  const ambiente = ambienteCobranca();
  const carregar = useServerFn(painelAssinaturas);
  const { data, isLoading, error } = useQuery({
    queryKey: ["painel-assinaturas", ambiente],
    queryFn: () => carregar({ data: { ambiente } }),
  });

  if (isLoading) return <SkeletonLista linhas={4} />;
  if (error) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Não foi possível carregar as assinaturas."}
      </div>
    );
  }

  const proprietario = data?.proprietario ?? false;
  const empresas = data?.empresas ?? [];
  const assinaturas = data?.assinaturas ?? [];
  const pagamentos = data?.pagamentos ?? [];
  const planos = data?.planos ?? [];

  return (
    <div className="space-y-4">
      {ambiente === "sandbox" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Ambiente de <strong>teste</strong>: nenhuma cobrança real é processada.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ...(proprietario
            ? [{ icone: Building2, rotulo: "Empresas", valor: empresas.length }]
            : []),
          { icone: Layers, rotulo: "Planos", valor: planos.length },
          { icone: CreditCard, rotulo: "Assinaturas", valor: assinaturas.length },
          { icone: Receipt, rotulo: "Pagamentos", valor: pagamentos.length },
        ].map((c) => (
          <Card key={c.rotulo}>
            <CardContent className="flex items-center gap-3 p-4">
              <c.icone className="size-5 text-primary" />
              <div>
                <p className="text-xl font-bold leading-none">{c.valor}</p>
                <p className="text-xs text-muted-foreground">{c.rotulo}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {proprietario && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas cadastradas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {empresas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
            ) : (
              empresas.map((e: any) => (
                <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className="flex-1 font-semibold">{e.nome}</span>
                  {e.cnpj && <span className="text-xs text-muted-foreground">{e.cnpj}</span>}
                  <Badge className={e.ativo ? "bg-emerald-600 text-white" : "bg-muted"}>
                    {e.ativo ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {proprietario ? "Assinaturas por empresa" : "Assinatura da sua empresa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {assinaturas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma assinatura registrada neste ambiente. A estrutura está pronta para receber
              os planos comerciais.
            </p>
          ) : (
            assinaturas.map((a: any) => (
              <div key={a.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 font-semibold">{a.empresas?.nome ?? "Empresa"}</p>
                  <Badge className={corStatus(a.status)}>
                    {STATUS_ASSINATURA_LABEL[a.status] ?? a.status}
                  </Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <div>
                    <dt>Plano</dt>
                    <dd className="text-foreground">{a.plano_codigo ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Valor</dt>
                    <dd className="text-foreground">{moeda(a.valor_centavos, a.moeda)}</dd>
                  </div>
                  <div>
                    <dt>Periodicidade</dt>
                    <dd className="text-foreground">{a.periodicidade ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Próxima cobrança</dt>
                    <dd className="text-foreground">
                      {a.proxima_cobranca ? fmtDataHoraLocal(a.proxima_cobranca) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Contratação</dt>
                    <dd className="text-foreground">
                      {a.data_inicio ? fmtDataHoraLocal(a.data_inicio) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Período atual até</dt>
                    <dd className="text-foreground">
                      {a.periodo_atual_fim ? fmtDataHoraLocal(a.periodo_atual_fim) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Teste até</dt>
                    <dd className="text-foreground">
                      {a.trial_fim ? fmtDataHoraLocal(a.trial_fim) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Cancelamento</dt>
                    <dd className="text-foreground">
                      {a.cancelada_em
                        ? fmtDataHoraLocal(a.cancelada_em)
                        : a.cancelar_no_fim_periodo
                          ? "Agendado para o fim do período"
                          : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planos disponíveis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {planos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum plano cadastrado neste ambiente.
            </p>
          ) : (
            planos.map((p: any) => (
              <div key={p.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 font-semibold">{p.nome}</p>
                  <Badge className={p.ativo ? "bg-emerald-600 text-white" : "bg-muted"}>
                    {p.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                  <span className="text-sm font-semibold">
                    {moeda(p.valor_centavos, p.moeda)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Código {p.codigo} · {p.periodicidade ?? "—"} ·{" "}
                  {p.max_usuarios ? `${p.max_usuarios} usuários` : "usuários ilimitados"}
                  {p.dias_trial > 0 && ` · ${p.dias_trial} dias de teste`}
                </p>
                {(p.modulos ?? []).length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Módulos: {(p.modulos as string[]).join(", ")}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de pagamentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pagamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pagamento registrado ainda.</p>
          ) : (
            pagamentos.map((p: any) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="flex-1">{fmtDataHoraLocal(p.ocorrido_em)}</span>
                <span className="font-semibold">{moeda(p.valor_centavos, p.moeda)}</span>
                <Badge
                  className={
                    p.status === "aprovado"
                      ? "bg-emerald-600 text-white"
                      : "bg-destructive text-white"
                  }
                >
                  {p.status}
                </Badge>
                {p.motivo_falha && (
                  <span className="text-xs text-muted-foreground">{p.motivo_falha}</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
