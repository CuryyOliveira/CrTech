/**
 * Lista de itens com virtualização simples (altura fixa por linha): com milhares de itens,
 * só as linhas visíveis (+ margem) são desenhadas.
 */
import { memo, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import {
  foiAdicionado,
  formatarQuantidade,
  statusVisual,
  type ProblemaItem,
} from "@/lib/conferencia-v2/apresentacao";
import type { ItemLocal } from "@/lib/sync-v2/tipos";
import { cn } from "@/lib/utils";
import { ConferenceStatusBadge } from "./ConferenceStatusBadge";

export const ALTURA_LINHA = 76;
const MARGEM = 6;

export const ConferenceItemList = memo(function ConferenceItemList({
  itens,
  problemas,
  atual,
  ocultarEsperado,
  onSelecionar,
  className,
}: {
  itens: ItemLocal[];
  problemas: Map<string, ProblemaItem>;
  atual: string | null;
  ocultarEsperado: boolean;
  onSelecionar: (k: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [janela, setJanela] = useState({ topo: 0, altura: 600 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setJanela({ topo: el.scrollTop, altura: el.clientHeight || 600 });
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      ro?.disconnect();
    };
  }, []);

  // Mantém o item atual visível quando ele muda (ex.: próximo/anterior).
  useEffect(() => {
    const el = ref.current;
    if (!el || !atual) return;
    const i = itens.findIndex((x) => x.k === atual);
    if (i < 0) return;
    const topo = i * ALTURA_LINHA;
    if (topo < el.scrollTop || topo + ALTURA_LINHA > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, topo - el.clientHeight / 2 + ALTURA_LINHA / 2);
    }
  }, [atual, itens]);

  const inicio = Math.max(0, Math.floor(janela.topo / ALTURA_LINHA) - MARGEM);
  const fim = Math.min(
    itens.length,
    Math.ceil((janela.topo + janela.altura) / ALTURA_LINHA) + MARGEM,
  );

  return (
    <div
      ref={ref}
      className={cn("relative overflow-y-auto overscroll-contain", className)}
      role="listbox"
      aria-label="Itens da conferência"
      data-testid="lista-itens"
    >
      {itens.length === 0 && (
        <p className="p-4 text-center text-sm text-muted-foreground">Nenhum item encontrado.</p>
      )}
      <div style={{ height: itens.length * ALTURA_LINHA, position: "relative" }}>
        {itens.slice(inicio, fim).map((item, n) => {
          const i = inicio + n;
          return (
            <Linha
              key={item.k}
              item={item}
              problema={problemas.get(item.k)}
              selecionado={item.k === atual}
              ocultarEsperado={ocultarEsperado}
              topo={i * ALTURA_LINHA}
              onSelecionar={onSelecionar}
            />
          );
        })}
      </div>
    </div>
  );
});

const Linha = memo(function Linha({
  item,
  problema,
  selecionado,
  ocultarEsperado,
  topo,
  onSelecionar,
}: {
  item: ItemLocal;
  problema?: ProblemaItem;
  selecionado: boolean;
  ocultarEsperado: boolean;
  topo: number;
  onSelecionar: (k: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selecionado}
      data-codigo={item.codigo ?? ""}
      onClick={() => onSelecionar(item.k)}
      className={cn(
        "absolute inset-x-0 flex items-center gap-3 border-b px-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selecionado && "bg-primary/5 ring-2 ring-inset ring-primary",
      )}
      style={{ top: topo, height: ALTURA_LINHA }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          <span className="font-mono">{item.codigo}</span>
          {item.pendente && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">• não enviado</span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {item.descricao || "Sem descrição"}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <ConferenceStatusBadge
            status={statusVisual(item, problema)}
            adicionado={foiAdicionado(item)}
            compacto
          />
          {item.locacao && (
            <span className="inline-flex min-w-0 items-center gap-0.5 truncate text-xs font-medium">
              <MapPin className="size-3 shrink-0" aria-hidden />
              {item.locacao}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs tabular-nums">
        {!ocultarEsperado && (
          <p className="text-muted-foreground">
            Esp. {formatarQuantidade(item.quantidade_esperada)}
          </p>
        )}
        <p className="text-base font-bold">{formatarQuantidade(item.quantidade_contada)}</p>
      </div>
    </button>
  );
});
