import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, MapPin, Pause, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fmtTime } from "@/lib/app";
import { fmtDuracao } from "@/lib/audit";
import { moduloLabel, setorLabel, tempoEmPausa, tempoTrabalhado } from "@/lib/gerencial";
import { Carregando, Vazio } from "@/components/admin/consulta";
import { useConferenciasAoVivo } from "@/hooks/useConferenciasAoVivo";

/**
 * Monitoramento em tempo real: exibe exatamente os mesmos valores da tela da
 * conferência (fonte única: `useConferenciasAoVivo`).
 */
export function MonitorTempoReal() {
  const [agora, setAgora] = useState(() => Date.now());
  const { ativas, isLoading } = useConferenciasAoVivo();

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-primary" />
          Monitoramento em tempo real
        </CardTitle>
        <Badge variant="secondary">{ativas.length} ativa(s)</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Carregando />
        ) : !ativas.length ? (
          <Vazio texto="Nenhuma conferência em andamento neste momento." />
        ) : (
          ativas.map((c) => {
            const h = c.historico;
            const pausada = c.status === "pausada";
            return (
              <Link
                key={c.id}
                to="/unidade/$id"
                params={{ id: c.unidade_id }}
                className="block rounded-xl border p-3 transition-colors hover:border-primary hover:bg-primary/5 cursor-pointer"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {h?.nome ?? h?.usuario_email ?? c.conferente ?? "—"}
                  </span>
                  <Badge variant="outline">{setorLabel(h?.setor)}</Badge>
                  <Badge variant="outline">{h?.modulo_titulo ?? moduloLabel(h?.modulo)}</Badge>
                  <Badge variant="outline">{h?.lista ?? c.unidade_nome ?? "—"}</Badge>
                  <Badge
                    className={
                      pausada
                        ? "bg-amber-500 text-white hover:bg-amber-500"
                        : "bg-emerald-600 text-white hover:bg-emerald-600"
                    }
                  >
                    {pausada ? <Pause className="mr-1 size-3" /> : <Play className="mr-1 size-3" />}
                    {pausada ? "Pausada" : "Em andamento"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-semibold text-foreground">
                  <MapPin className="size-4 shrink-0 text-primary" />
                  <span>Posição atual: {c.posicao_atual ?? "Sem localização informada"}</span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>Início: {fmtTime(c.hora_inicio)}</span>
                  <span>
                    Tempo trabalhado: {fmtDuracao(tempoTrabalhado(c, agora))}
                    {pausada && " (congelado)"}
                  </span>
                  <span>Concluído: {c.pct}%</span>
                  {pausada && <span>Em pausa há: {fmtDuracao(tempoEmPausa(c, agora))}</span>}
                  <span>Pausas: {Number(c.quantidade_pausas ?? 0)}</span>
                  <span>📦 Total: {c.total}</span>
                  <span>✅ Corretos: {c.corretos}</span>
                  <span>⚠️ Divergências: {c.divergencias}</span>
                  <span>⏳ Pendentes: {c.pendentes}</span>
                </div>

                <Progress className="mt-2 h-2" value={c.pct} />
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
