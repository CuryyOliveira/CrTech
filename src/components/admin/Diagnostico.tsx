import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { diagnosticoAcesso } from "@/lib/diagnostico.functions";
import { usePermissoes } from "@/hooks/usePermissoes";
import { PERFIL_LABEL } from "@/lib/permissions";
import { fmtDataHoraLocal } from "@/lib/datas";

/** Relatório de autodiagnóstico: sessão, claims, perfil, RLS e acesso às tabelas. */
export function Diagnostico() {
  const rodar = useServerFn(diagnosticoAcesso);
  const { perfil, nivel } = usePermissoes();
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
          Executar diagnóstico
        </Button>
        {perfil && (
          <Badge variant="secondary">
            {PERFIL_LABEL[perfil]} · nível {nivel}
          </Badge>
        )}
        {r && (
          <Badge variant={r.ok ? "secondary" : "destructive"}>
            {r.ok ? "Nenhuma inconsistência" : "Inconsistências encontradas"}
          </Badge>
        )}
        {r && (
          <span className="text-xs text-muted-foreground">
            Gerado em {fmtDataHoraLocal(r.gerado_em)}
          </span>
        )}
      </div>

      {exec.error && (
        <p className="text-sm text-destructive">{(exec.error as Error).message}</p>
      )}

      <Card>
        <CardContent className="divide-y p-0">
          {(r?.itens ?? []).map((i) => (
            <div key={i.nome} className="flex items-start gap-3 p-3">
              {i.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">{i.nome}</p>
                <p className="break-words text-xs text-muted-foreground">{i.detalhe}</p>
              </div>
            </div>
          ))}
          {!r && !exec.isPending && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Execute o diagnóstico para gerar o relatório.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
