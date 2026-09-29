/**
 * Indicador global de sincronização (V2): ONLINE / OFFLINE / SINCRONIZANDO / ERRO, com
 * progresso, botão "SINCRONIZAR AGORA" e o painel de itens que precisam de atenção.
 * Some quando a tela aberta mostra o próprio estado (ex.: conferência V2).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MENSAGEM_CONCLUIDA } from "@/lib/sync-v2/motor";
import { useIndicadorGlobalVisivel, useMotorSync } from "@/lib/sync-v2/react";
import { ESTILO_ESTADO } from "./estilo";
import { PainelAtencao } from "./PainelAtencao";

export function IndicadorSync() {
  const { motor, resumo } = useMotorSync();
  const visivel = useIndicadorGlobalVisivel();
  const [aberto, setAberto] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  if (!motor || !visivel) return null;
  const e = ESTILO_ESTADO[resumo.estado];
  const Icone = e.icone;
  const atencao = resumo.atencao + resumo.conflitos;
  const pct =
    resumo.progresso && resumo.progresso.total > 0
      ? Math.min(100, Math.round((resumo.progresso.feitos / resumo.progresso.total) * 100))
      : null;

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
      <div
        className={`cr-alto-contraste fixed right-3 top-3 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${e.classe}`}
        aria-live="polite"
      >
        <Icone className={`size-3.5 ${resumo.estado === "SYNCING" ? "animate-spin" : ""}`} />
        <span>{e.texto}</span>
        {pct !== null && <span className="tabular-nums">{pct}%</span>}
        {resumo.pendentes > 0 && (
          <span className="tabular-nums">· {resumo.pendentes} pendente(s)</span>
        )}
        {atencao > 0 && (
          <button type="button" className="underline" onClick={() => setAberto(true)}>
            {atencao} com atenção
          </button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={sincronizando || resumo.estado === "SYNCING"}
          onClick={() => void sincronizarAgora()}
        >
          SINCRONIZAR AGORA
        </Button>
      </div>
      <PainelAtencao motor={motor} aberto={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}
