import { CheckCircle2, CloudOff, Download, RefreshCw, Wifi } from "lucide-react";
import { useConexao } from "@/hooks/useConexao";

/** Indicador flutuante da conexão e da preparação dos dados offline. */
export function StatusConexao() {
  const { estado, pendentes, progresso, resumo, sincronizar } = useConexao();

  const config = {
    online: {
      icone: Wifi,
      texto: "Online",
      classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    },
    offline: {
      icone: CloudOff,
      texto: "Offline",
      classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    },
    sincronizando: {
      icone: RefreshCw,
      texto: "Sincronizando",
      classe: "bg-primary/15 text-primary border-primary/30",
    },
  }[estado];

  if (progresso.ativo) {
    const pct = Math.min(100, Math.round((progresso.atual / Math.max(1, progresso.total)) * 100));
    const Icone = progresso.pronto ? CheckCircle2 : Download;
    return (
      <div
        className="fixed bottom-3 left-1/2 z-50 w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border border-primary/30 bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Icone
            className={`size-3.5 shrink-0 ${progresso.pronto ? "text-emerald-500" : "animate-pulse text-primary"}`}
          />
          <span className="truncate">{progresso.etapa}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${progresso.pronto ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  const Icone = config.icone;
  if (estado === "online" && !pendentes) return null;

  return (
    <button
      type="button"
      onClick={() => void sincronizar()}
      className={`fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${config.classe}`}
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5">
        <Icone className={`size-3.5 ${estado === "sincronizando" ? "animate-spin" : ""}`} />
        {config.texto}
        {pendentes > 0 && <span>· {pendentes} aguardando sincronização</span>}
        {resumo.comErro > 0 && <span>· {resumo.comErro} com erro</span>}
      </span>
    </button>
  );
}
