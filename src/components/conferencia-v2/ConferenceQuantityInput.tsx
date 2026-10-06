import { forwardRef, memo } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lerQuantidade } from "@/lib/conferencia-v2/apresentacao";

/**
 * Quantidade conferida: digitação (teclado numérico), aumentar, diminuir e zerar. O rascunho
 * fica no componente do item (nada re-renderiza a lista a cada tecla).
 */
export const ConferenceQuantityInput = memo(
  forwardRef<
    HTMLInputElement,
    {
      valor: string;
      onValor: (v: string) => void;
      onConfirmar: () => void;
      desabilitado?: boolean;
    }
  >(function ConferenceQuantityInput({ valor, onValor, onConfirmar, desabilitado }, ref) {
    const n = lerQuantidade(valor);
    const base = n === null || Number.isNaN(n) ? 0 : n;
    const invalido = n !== null && Number.isNaN(n);
    const passo = (d: number) =>
      onValor(String(Math.max(0, Math.round((base + d) * 1000) / 1000)).replace(".", ","));
    return (
      <div className="space-y-2">
        <label htmlFor="qtd-conferida" className="text-sm font-semibold">
          QUANTIDADE CONFERIDA
        </label>
        <div className="flex items-stretch gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-16 w-16 shrink-0"
            aria-label="Diminuir 1"
            disabled={desabilitado || base <= 0}
            onClick={() => passo(-1)}
          >
            <Minus className="size-7" />
          </Button>
          <input
            ref={ref}
            id="qtd-conferida"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            aria-invalid={invalido}
            aria-describedby={invalido ? "qtd-erro" : undefined}
            disabled={desabilitado}
            className="h-16 min-w-0 flex-1 rounded-md border-2 border-input bg-background text-center text-4xl font-bold tabular-nums focus-visible:border-primary focus-visible:outline-none disabled:opacity-60"
            placeholder="—"
            value={valor}
            onChange={(e) => onValor(e.target.value.replace(/[^\d.,]/g, ""))}
            onFocus={(e) => {
              const el = e.currentTarget;
              el.select();
              // Espera o teclado virtual abrir; só rola se o campo ficou escondido por ele.
              setTimeout(() => {
                if (document.activeElement !== el) return;
                const r = el.getBoundingClientRect();
                const altura = window.visualViewport
                  ? window.visualViewport.height
                  : window.innerHeight;
                if (r.top < 64 || r.bottom > altura - 8) el.scrollIntoView({ block: "center" });
              }, 350);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirmar();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-16 w-16 shrink-0"
            aria-label="Aumentar 1"
            disabled={desabilitado}
            onClick={() => passo(1)}
          >
            <Plus className="size-7" />
          </Button>
        </div>
        {invalido && (
          <p id="qtd-erro" role="alert" className="text-sm font-medium text-destructive">
            Quantidade inválida. Use apenas números (ex.: 12 ou 1,5).
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={desabilitado}
            onClick={() => onValor("0")}
          >
            ZERAR
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={desabilitado || valor === ""}
            onClick={() => onValor("")}
          >
            LIMPAR
          </Button>
        </div>
      </div>
    );
  }),
);
