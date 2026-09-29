import { memo } from "react";
import { AlertTriangle } from "lucide-react";
import { diferenca, formatarQuantidade } from "@/lib/conferencia-v2/apresentacao";

/** ESPERADO · CONFERIDO · DIFERENÇA, na própria tela do item. */
export const ConferenceDivergence = memo(function ConferenceDivergence({
  esperado,
  conferido,
}: {
  esperado: number;
  conferido: number | null;
}) {
  const d = diferenca(esperado, conferido);
  if (d === null || d === 0) return null;
  return (
    <div
      role="status"
      className="rounded-lg border-2 border-amber-600/50 bg-amber-500/10 p-3"
      data-testid="divergencia"
    >
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-amber-900 dark:text-amber-300">
        <AlertTriangle className="size-4" aria-hidden /> DIVERGÊNCIA
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-muted-foreground">ESPERADO</dt>
          <dd className="text-xl font-bold tabular-nums">{formatarQuantidade(esperado)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CONFERIDO</dt>
          <dd className="text-xl font-bold tabular-nums">{formatarQuantidade(conferido)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">DIFERENÇA</dt>
          <dd className="text-xl font-bold tabular-nums" data-testid="diferenca">
            {d > 0 ? "+" : "−"}
            {formatarQuantidade(Math.abs(d))}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-center text-xs font-medium">
        {d > 0 ? "Sobra" : "Falta"} de {formatarQuantidade(Math.abs(d))}
      </p>
    </div>
  );
});
