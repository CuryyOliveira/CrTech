/**
 * Estado de conexão/sincronização sempre visível na conferência (sem abrir menu), botão
 * SINCRONIZAR AGORA e o acesso às alterações que precisam de atenção. Toda a lógica
 * (retry, timeout, conflitos, idempotência) é do motor V2.
 */
import { memo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ESTILO_ESTADO } from "@/components/sync-v2/estilo";
import type { MotorSync, ResumoSync } from "@/lib/sync-v2";
import { MENSAGEM_CONCLUIDA } from "@/lib/sync-v2/motor";
import { plural } from "@/lib/conferencia-v2/apresentacao";
import { cn } from "@/lib/utils";

export const MENSAGEM_OFFLINE =
  "Trabalhando offline. As alterações serão sincronizadas quando a conexão voltar.";

export const ConferenceSyncBadge = memo(function ConferenceSyncBadge({
  resumo,
}: {
  resumo: ResumoSync;
}) {
  const e = ESTILO_ESTADO[resumo.estado];
  const Icone = e.icone;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold",
        e.classe,
      )}
      role="status"
      aria-live="polite"
      data-testid="estado-sync"
      data-estado={resumo.estado}
    >
      <Icone
        className={cn("size-3.5", resumo.estado === "SYNCING" && "animate-spin")}
        aria-hidden
      />
      {e.texto}
      {resumo.pendentes > 0 && <span className="tabular-nums">· {resumo.pendentes}</span>}
    </span>
  );
});

export const ConferenceSyncStatus = memo(function ConferenceSyncStatus({
  motor,
  resumo,
  aguardandoNestaConferencia,
  onAbrirAtencao,
}: {
  motor: MotorSync;
  resumo: ResumoSync;
  aguardandoNestaConferencia: number;
  onAbrirAtencao: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const atencao = resumo.atencao + resumo.conflitos;

  async function sincronizar() {
    setOcupado(true);
    try {
      const r = await motor.sincronizarAgora();
      if (r.mensagem === MENSAGEM_CONCLUIDA) toast.success(r.mensagem);
      else toast.warning(r.mensagem);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-2">
      {resumo.estado === "OFFLINE" && (
        <p
          className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-900 dark:text-amber-200"
          data-testid="aviso-offline"
        >
          {MENSAGEM_OFFLINE}
        </p>
      )}
      {atencao > 0 && (
        <button
          type="button"
          onClick={onAbrirAtencao}
          className="flex w-full items-center gap-2 rounded-md border-2 border-destructive/60 bg-destructive/10 px-3 py-2 text-left text-sm font-bold text-destructive"
          data-testid="aviso-atencao"
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          HÁ ALTERAÇÕES QUE PRECISAM DE ATENÇÃO ({atencao})
        </button>
      )}
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground" data-testid="aguardando-sync">
          {aguardandoNestaConferencia > 0
            ? `${plural(aguardandoNestaConferencia, "alteração", "alterações")} desta conferência aguardando envio`
            : "Tudo desta conferência foi enviado"}
        </p>
        <Button
          variant="secondary"
          className="h-10 text-xs font-bold"
          disabled={ocupado || resumo.estado === "SYNCING"}
          onClick={() => void sincronizar()}
        >
          SINCRONIZAR AGORA
        </Button>
      </div>
    </div>
  );
});
