import { memo } from "react";
import { ROTULO_FILTRO, type Filtro } from "@/lib/conferencia-v2/apresentacao";
import { cn } from "@/lib/utils";

const ORDEM: Filtro[] = [
  "todos",
  "pendentes",
  "conferidos",
  "divergencias",
  "adicionados",
  "conflitos",
];

/** Filtros rápidos (locais), roláveis na horizontal no celular. */
export const ConferenceFilters = memo(function ConferenceFilters({
  filtro,
  contagem,
  onFiltro,
}: {
  filtro: Filtro;
  contagem: Record<Filtro, number>;
  onFiltro: (f: Filtro) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filtrar itens"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {ORDEM.map((f) => {
        const ativo = f === filtro;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onFiltro(f)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
              ativo
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:border-primary",
              f === "conflitos" &&
                contagem.conflitos > 0 &&
                !ativo &&
                "border-destructive text-destructive",
            )}
          >
            {ROTULO_FILTRO[f]}
            <span className="tabular-nums opacity-80">{contagem[f]}</span>
          </button>
        );
      })}
    </div>
  );
});
