import { memo } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Circle,
  GitCompare,
  PlusCircle,
} from "lucide-react";
import { ROTULO_STATUS, type StatusVisual } from "@/lib/conferencia-v2/apresentacao";
import { cn } from "@/lib/utils";

const ESTILO: Record<StatusVisual, { icone: typeof Circle; classe: string }> = {
  pendente: { icone: Circle, classe: "border-muted-foreground/40 text-muted-foreground" },
  conferido: {
    icone: CheckCircle2,
    classe: "border-emerald-600/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  divergencia: {
    icone: AlertTriangle,
    classe: "border-amber-600/50 bg-amber-500/10 text-amber-900 dark:text-amber-300",
  },
  erro: { icone: AlertOctagon, classe: "border-destructive/60 bg-destructive/10 text-destructive" },
  conflito: {
    icone: GitCompare,
    classe: "border-violet-600/50 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  },
};

/** Status do item com texto + ícone (não depende só da cor). */
export const ConferenceStatusBadge = memo(function ConferenceStatusBadge({
  status,
  adicionado,
  compacto,
}: {
  status: StatusVisual;
  adicionado?: boolean;
  compacto?: boolean;
}) {
  const e = ESTILO[status];
  const Icone = e.icone;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold",
          compacto ? "text-[10px]" : "text-xs",
          e.classe,
        )}
        data-status={status}
      >
        <Icone className={compacto ? "size-3" : "size-3.5"} aria-hidden />
        {ROTULO_STATUS[status]}
      </span>
      {adicionado && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-sky-600/50 bg-sky-500/10 px-1.5 py-0.5 font-semibold text-sky-800 dark:text-sky-300",
            compacto ? "text-[10px]" : "text-xs",
          )}
        >
          <PlusCircle className={compacto ? "size-3" : "size-3.5"} aria-hidden />
          ADICIONADO
        </span>
      )}
    </span>
  );
});
