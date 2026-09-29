/**
 * Tempo decorrido + PAUSAR/RETOMAR. O tempo vem do motor (tempoTrabalhado sobre o estado
 * projetado pelos eventos); a tela só atualiza o relógio a cada segundo.
 */
import { memo, useEffect, useState } from "react";
import { Pause, Play, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatarDuracao } from "@/lib/conferencia-v2/apresentacao";
import { tempoTrabalhado } from "@/lib/sync-v2/projecao";
import type { ConferenciaLocal } from "@/lib/sync-v2/tipos";

export const ConferenceTimer = memo(function ConferenceTimer({
  conferencia,
}: {
  conferencia: ConferenciaLocal;
}) {
  const [agora, setAgora] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (conferencia.status !== "em_andamento") return;
    const t = setInterval(() => setAgora(new Date().toISOString()), 1000);
    return () => clearInterval(t);
  }, [conferencia.status]);
  const pausada = conferencia.status === "pausada";
  return (
    <p
      className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold tabular-nums"
      data-testid="tempo"
    >
      <Timer className="size-4" aria-hidden />
      <span className="sr-only">Tempo trabalhado:</span>
      {formatarDuracao(tempoTrabalhado(conferencia, agora))}
      {pausada && (
        <span className="text-xs font-bold text-amber-700 dark:text-amber-300"> · PAUSADA</span>
      )}
    </p>
  );
});

export const ConferencePause = memo(function ConferencePause({
  pausada,
  ocupado,
  onPausar,
  onRetomar,
}: {
  pausada: boolean;
  ocupado: boolean;
  onPausar: () => void;
  onRetomar: () => void;
}) {
  return pausada ? (
    <Button className="h-12 w-full gap-2 text-base" disabled={ocupado} onClick={onRetomar}>
      <Play className="size-5" aria-hidden /> RETOMAR CONFERÊNCIA
    </Button>
  ) : (
    <Button
      variant="outline"
      className="h-12 w-full gap-2 text-base"
      disabled={ocupado}
      onClick={onPausar}
    >
      <Pause className="size-5" aria-hidden /> PAUSAR CONFERÊNCIA
    </Button>
  );
});
