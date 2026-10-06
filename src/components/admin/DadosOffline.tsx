import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, CloudOff, Download } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtDataHoraLocal } from "@/lib/datas";
import { hidratarOffline } from "@/lib/offline/idb";
import { lerLinhas } from "@/lib/offline/fila";
import {
  assinarProgresso,
  precarregarDadosOffline,
  progressoOffline,
  resumoLocal,
  ultimaPrecarga,
  type ProgressoOffline,
} from "@/lib/offline/precarregar";
import { useOffline } from "@/hooks/useOffline";

/** Cadastros que o usuário acompanha de perto no uso offline. */
const DESTAQUES = [
  { tabela: "empresas", titulo: "Empresas" },
  { tabela: "empresa_modulos", titulo: "Módulos" },
  { tabela: "empresa_setores", titulo: "Setores" },
  { tabela: "planos", titulo: "Planos" },
] as const;

/**
 * Dados offline: mostra o que já está guardado no aparelho (empresas, módulos,
 * setores, planos e demais cadastros) e o que ainda falta baixar.
 */
export function DadosOffline() {
  const offline = useOffline();
  const [resumo, setResumo] = useState<{ tabela: string; rotulo: string; linhas: number }[]>([]);
  const [ultima, setUltima] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<ProgressoOffline>(progressoOffline());
  const [baixando, setBaixando] = useState(false);

  const recarregar = useCallback(() => {
    setResumo(resumoLocal());
    setUltima(ultimaPrecarga());
  }, []);

  useEffect(() => {
    void hidratarOffline().then(recarregar);
    const sair = assinarProgresso(setProgresso);
    const timer = setInterval(recarregar, 5000);
    return () => {
      sair();
      clearInterval(timer);
    };
  }, [recarregar]);

  async function baixarAgora() {
    if (offline) {
      toast.error("Sem internet agora. Conecte-se para atualizar os dados offline.");
      return;
    }
    setBaixando(true);
    try {
      const tabelas = await precarregarDadosOffline();
      recarregar();
      toast.success(
        tabelas ? `${tabelas} conjunto(s) de dados atualizado(s).` : "Atualização já em andamento.",
      );
    } catch {
      toast.error("Não foi possível atualizar os dados offline.");
    } finally {
      setBaixando(false);
    }
  }

  const pct = Math.min(100, Math.round((progresso.atual / Math.max(1, progresso.total)) * 100));
  const faltando = resumo.filter((r) => r.linhas === 0).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="text-sm">
            <p className="font-semibold">
              Última atualização: {ultima ? fmtDataHoraLocal(ultima) : "nunca"}
            </p>
            <p className="text-xs text-muted-foreground">
              {faltando > 0
                ? `${faltando} conjunto(s) de dados ainda não foram baixados`
                : "Todos os conjuntos de dados estão disponíveis no aparelho"}
            </p>
          </div>
          <Button className="ml-auto" onClick={baixarAgora} disabled={baixando || offline}>
            {offline ? (
              <CloudOff className="mr-2 size-4" />
            ) : (
              <Download className={`mr-2 size-4 ${baixando ? "animate-pulse" : ""}`} />
            )}
            {baixando ? "Baixando…" : "Baixar dados agora"}
          </Button>
          {progresso.ativo && (
            <div className="w-full space-y-1">
              <p className="text-xs text-muted-foreground">{progresso.etapa}</p>
              <Progress value={pct} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DESTAQUES.map((d) => {
          const linhas = lerLinhas(d.tabela).length;
          return (
            <Card key={d.tabela}>
              <CardContent className="space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{d.titulo}</p>
                <p className="text-2xl font-bold tabular-nums">{linhas}</p>
                <Badge variant={linhas > 0 ? "secondary" : "outline"} className="text-[10px]">
                  {linhas > 0 ? "Sincronizado" : "Falta baixar"}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Todos os dados guardados no aparelho</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {resumo.map((r) => (
            <div
              key={r.tabela}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              {r.linhas > 0 ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{r.rotulo}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.linhas > 0 ? `${r.linhas} registro(s)` : "falta baixar"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
