import { memo, useEffect, useRef, useState } from "react";
import { ScanLine, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Busca local por código (parcial), descrição e localização. Pronta para leitor de código de
 * barras/QR (que "digita" o código e envia Enter): Enter chama `onCodigoLido`.
 * O filtro é aplicado depois de uma pequena pausa na digitação (não a cada tecla).
 */
export const ConferenceSearch = memo(function ConferenceSearch({
  onBusca,
  onCodigoLido,
  valorExterno,
}: {
  onBusca: (termo: string) => void;
  /** Enter: devolve true se encontrou o item (o campo é limpo para a próxima leitura). */
  onCodigoLido: (termo: string) => boolean;
  /** Troca de valor vinda de fora (ex.: limpar). */
  valorExterno?: string;
}) {
  const [texto, setTexto] = useState(valorExterno ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (valorExterno !== undefined) setTexto(valorExterno);
  }, [valorExterno]);

  useEffect(() => {
    const t = setTimeout(() => onBusca(texto), 150);
    return () => clearTimeout(t);
  }, [texto, onBusca]);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Buscar por código, descrição ou localização"
        placeholder="Código, descrição ou localização"
        className="h-12 pl-10 pr-20 text-base"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (onCodigoLido(texto)) {
            setTexto("");
            onBusca("");
          }
        }}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
        {texto && (
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="Limpar busca"
            onClick={() => {
              setTexto("");
              onBusca("");
              ref.current?.focus();
            }}
          >
            <X className="size-5" />
          </button>
        )}
        <span
          className="flex size-10 items-center justify-center text-muted-foreground"
          title="Compatível com leitor de código de barras"
        >
          <ScanLine className="size-5" aria-hidden />
        </span>
      </div>
    </div>
  );
});
