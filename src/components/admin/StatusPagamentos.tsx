import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { statusPagamentos } from "@/lib/pagamentos-status.functions";
import { fmtDataHoraLocal } from "@/lib/datas";

/** Situação das credenciais do Mercado Pago e do webhook de pagamentos. */
export function StatusPagamentos() {
  const rodar = useServerFn(statusPagamentos);
  const exec = useMutation({ mutationFn: async () => rodar({ data: undefined as never }) });

  useEffect(() => {
    exec.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = exec.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => exec.mutate()} disabled={exec.isPending}>
          <RefreshCw className={`mr-2 size-4 ${exec.isPending ? "animate-spin" : ""}`} />
          Atualizar status
        </Button>
        {r && (
          <>
            <Badge variant={r.ambiente_app === "live" ? "default" : "secondary"}>
              Ambiente: {r.ambiente_app === "live" ? "Produção" : "Teste (Sandbox)"}
            </Badge>
            <Badge variant={r.pronto ? "secondary" : "destructive"}>
              {r.pronto ? "Configuração completa" : "Configuração incompleta"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Verificado em {fmtDataHoraLocal(r.gerado_em)}
            </span>
          </>
        )}
      </div>

      {exec.error && <p className="text-sm text-destructive">{(exec.error as Error).message}</p>}

      <Card>
        <CardContent className="divide-y p-0">
          {(r?.secrets ?? []).map((s) => (
            <div key={s.chave} className="flex items-start gap-3 p-3">
              {s.configurado ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : s.obrigatorio ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {s.titulo}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{s.chave}</span>
                </p>
                <p className="break-words text-xs text-muted-foreground">{s.descricao}</p>
              </div>
              <Badge variant={s.configurado ? "secondary" : s.obrigatorio ? "destructive" : "outline"}>
                {s.configurado ? "Configurado" : s.obrigatorio ? "Ausente" : "Opcional"}
              </Badge>
            </div>
          ))}
          {!r && !exec.isPending && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Atualize para verificar as credenciais.
            </p>
          )}
        </CardContent>
      </Card>

      {r && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              {r.webhook.ativo ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <XCircle className="size-4 text-destructive" />
              )}
              <p className="text-sm font-medium">
                Webhook {r.webhook.ativo ? "ativo" : "inativo"}
              </p>
            </div>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="break-all font-mono">{r.webhook.endpoint}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Validação HMAC</dt>
                <dd>{r.webhook.hmac_ativo ? "Obrigatória e ativa" : "Sem segredo configurado"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Notificações recebidas</dt>
                <dd>{r.webhook.eventos_total}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Última notificação</dt>
                <dd>
                  {r.webhook.ultimo_evento_em
                    ? `${fmtDataHoraLocal(r.webhook.ultimo_evento_em)}${
                        r.webhook.ultimo_evento_tipo ? ` · ${r.webhook.ultimo_evento_tipo}` : ""
                      }`
                    : "Nenhuma até agora"}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              O endereço do webhook também precisa estar cadastrado no painel do Mercado Pago com os
              tópicos de assinatura.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
