/**
 * Indicador global de sincronização (V2): botão flutuante redondo, só com o ícone do estado
 * (ONLINE / OFFLINE / SINCRONIZANDO / ERRO), no canto inferior direito — estilo "chat".
 * Um ponto sinaliza pendências ou itens que precisam de atenção. Ao tocar, abre um cartão com
 * o estado, o progresso, as pendências, "SINCRONIZAR AGORA" e o painel de atenção.
 * Some quando a tela aberta mostra o próprio estado (ex.: conferência V2).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MENSAGEM_CONCLUIDA } from "@/lib/sync-v2/motor";
import { useIndicadorGlobalVisivel, useMotorSync } from "@/lib/sync-v2/react";
import { ESTILO_ESTADO } from "./estilo";
import { PainelAtencao } from "./PainelAtencao";

export function IndicadorSync() {
  const { motor, resumo } = useMotorSync();
  const visivel = useIndicadorGlobalVisivel();
  const [detalhes, setDetalhes] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  if (!motor || !visivel) return null;
  const e = ESTILO_ESTADO[resumo.estado];
  const Icone = e.icone;
  const atencao = resumo.atencao + resumo.conflitos;
  const alerta = atencao > 0 || resumo.estado === "ERROR";
  const pct =
    resumo.progresso && resumo.progresso.total > 0
      ? Math.min(100, Math.round((resumo.progresso.feitos / resumo.progresso.total) * 100))
      : null;
  const rotulo =
    `Sincronização: ${e.texto}` +
    (resumo.pendentes > 0 ? `, ${resumo.pendentes} pendente(s)` : "") +
    (atencao > 0 ? `, ${atencao} com atenção` : "");

  async function sincronizarAgora() {
    if (!motor) return;
    setSincronizando(true);
    try {
      const r = await motor.sincronizarAgora();
      if (r.mensagem === MENSAGEM_CONCLUIDA) toast.success(r.mensagem);
      else toast.warning(r.mensagem);
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <>
      <Popover open={detalhes} onOpenChange={setDetalhes}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={rotulo}
            title={rotulo}
            data-testid="indicador-sync"
            className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 size-12 rounded-full bg-card shadow-lg outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={`cr-alto-contraste flex size-full items-center justify-center rounded-full border ${e.classe}`}
            >
              <Icone className={`size-5 ${resumo.estado === "SYNCING" ? "animate-spin" : ""}`} />
            </span>
            {(resumo.pendentes > 0 || alerta) && (
              <span
                aria-hidden
                className={`absolute -top-0.5 -right-0.5 min-w-5 rounded-full border-2 border-card px-1 text-[10px] leading-4 font-bold tabular-nums text-white ${
                  alerta ? "bg-destructive" : "bg-primary"
                }`}
              >
                {alerta ? "!" : resumo.pendentes > 99 ? "99+" : resumo.pendentes}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="cr-alto-contraste w-64 space-y-3 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold" aria-live="polite">
            <span
              className={`flex size-7 items-center justify-center rounded-full border ${e.classe}`}
            >
              <Icone className={`size-4 ${resumo.estado === "SYNCING" ? "animate-spin" : ""}`} />
            </span>
            <span>{e.texto}</span>
            {pct !== null && <span className="ml-auto tabular-nums">{pct}%</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {resumo.pendentes > 0
              ? `${resumo.pendentes} alteração(ões) aguardando envio.`
              : "Tudo sincronizado neste aparelho."}
          </p>
          {atencao > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                setDetalhes(false);
                setAberto(true);
              }}
            >
              {atencao} com atenção — ver
            </Button>
          )}
          <Button
            size="sm"
            className="w-full"
            disabled={sincronizando || resumo.estado === "SYNCING"}
            onClick={() => void sincronizarAgora()}
          >
            SINCRONIZAR AGORA
          </Button>
        </PopoverContent>
      </Popover>
      <PainelAtencao motor={motor} aberto={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}
