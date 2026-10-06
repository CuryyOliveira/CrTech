/**
 * Item atual: localização em destaque, código, descrição, esperado, quantidade conferida,
 * divergência, observação e fotos, com barra fixa ANTERIOR · CONFIRMAR · PRÓXIMO.
 */
import { memo, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, GitCompare, MapPin, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  foiAdicionado,
  formatarQuantidade,
  lerQuantidade,
  partesLocalizacao,
  statusVisual,
  type ProblemaItem,
} from "@/lib/conferencia-v2/apresentacao";
import type { MotorSync } from "@/lib/sync-v2";
import type { FotoLocal, ItemLocal } from "@/lib/sync-v2/tipos";
import { ConferenceDivergence } from "./ConferenceDivergence";
import { ConferencePhotos } from "./ConferencePhotos";
import { ConferenceQuantityInput } from "./ConferenceQuantityInput";
import { ConferenceStatusBadge } from "./ConferenceStatusBadge";

const paraTexto = (n: number | null) => (n === null ? "" : formatarQuantidade(n));

export const ConferenceItem = memo(function ConferenceItem({
  motor,
  conferenciaId,
  item,
  problema,
  fotos,
  posicao,
  total,
  bloqueado,
  motivoBloqueio,
  ocultarEsperado,
  temAnterior,
  temProximo,
  onAnterior,
  onProximo,
  onConfirmar,
  onVerConflito,
}: {
  motor: MotorSync;
  conferenciaId: string;
  item: ItemLocal;
  problema?: ProblemaItem;
  fotos: FotoLocal[];
  posicao: number;
  total: number;
  bloqueado: boolean;
  motivoBloqueio?: string;
  ocultarEsperado: boolean;
  temAnterior: boolean;
  temProximo: boolean;
  onAnterior: () => void;
  onProximo: () => void;
  /** Salva (se mudou) e segue. */
  onConfirmar: (quantidade: number | null, observacoes: string | null, mudou: boolean) => void;
  onVerConflito: () => void;
}) {
  const [qtd, setQtd] = useState(() => paraTexto(item.quantidade_contada));
  const [obs, setObs] = useState(item.observacoes ?? "");
  const [verObs, setVerObs] = useState(Boolean(item.observacoes));
  const sujo = useRef(false);
  const campo = useRef<HTMLInputElement>(null);

  // Troca de item: recarrega o rascunho. Mesma chave com valor novo (ex.: servidor): só se o
  // usuário não estiver editando.
  const chaveAnterior = useRef(item.k);
  useEffect(() => {
    if (chaveAnterior.current !== item.k || !sujo.current) {
      setQtd(paraTexto(item.quantidade_contada));
      setObs(item.observacoes ?? "");
      setVerObs(Boolean(item.observacoes));
      sujo.current = false;
    }
    chaveAnterior.current = item.k;
  }, [item.k, item.quantidade_contada, item.observacoes]);

  // Troca de item: mostra o topo do item (localização primeiro). Com o teclado aberto, garante
  // que o campo de quantidade continue visível.
  const artigo = useRef<HTMLElement>(null);
  const primeiraVez = useRef(true);
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    const art = artigo.current;
    if (!art) return;
    const focado = document.activeElement === campo.current;
    art.scrollIntoView({ block: "start" });
    if (focado && campo.current) {
      const r = campo.current.getBoundingClientRect();
      const altura = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      if (r.bottom > altura - 8) campo.current.scrollIntoView({ block: "center" });
    }
  }, [item.k]);

  const n = lerQuantidade(qtd);
  const invalido = n !== null && Number.isNaN(n);
  const mudouQtd = n !== item.quantidade_contada && !invalido;
  const mudouObs = (obs.trim() || null) !== (item.observacoes?.trim() || null);
  const status = statusVisual(item, problema);
  const partes = partesLocalizacao(item.locacao);

  function confirmar() {
    if (invalido) {
      campo.current?.focus();
      return;
    }
    sujo.current = false;
    onConfirmar(n, obs.trim() || null, mudouQtd || mudouObs);
  }

  return (
    <article
      ref={artigo}
      aria-label={`Item ${item.codigo ?? ""}`}
      className="flex min-h-full scroll-mt-20 flex-col"
      data-testid="item-atual"
    >
      <div className="flex-1 space-y-3 pb-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums" data-testid="posicao">
            Item {posicao} de {total}
          </span>
          {item.pendente && <span>Alteração ainda não enviada</span>}
        </div>

        <section
          aria-label="Localização"
          className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3"
        >
          <p className="mb-1 flex items-center gap-1 text-xs font-bold uppercase text-primary">
            <MapPin className="size-4" aria-hidden /> Localização
          </p>
          {partes.length ? (
            <p className="flex flex-wrap gap-1.5" data-testid="localizacao">
              {partes.map((p, i) => (
                <span
                  key={i}
                  className="rounded-md bg-background px-2 py-1 text-xl font-extrabold tracking-wide"
                >
                  {p}
                </span>
              ))}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sem localização cadastrada</p>
          )}
        </section>

        <div>
          <p className="font-mono text-2xl font-bold" data-testid="codigo-atual">
            {item.codigo}
          </p>
          <h2 className="text-lg font-semibold leading-snug">
            {item.descricao || "Sem descrição"}
          </h2>
          <div className="mt-1">
            <ConferenceStatusBadge status={status} adicionado={foiAdicionado(item)} />
          </div>
          {item.motivo_inclusao && (
            <p className="mt-1 text-xs text-muted-foreground">
              Motivo da inclusão: {item.motivo_inclusao}
            </p>
          )}
        </div>

        {problema?.status === "CONFLICT" && (
          <div
            role="alert"
            className="rounded-lg border-2 border-violet-600/50 bg-violet-500/10 p-3 text-sm"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <GitCompare className="size-4" aria-hidden /> Este item também foi alterado em outro
              dispositivo.
            </p>
            <Button className="mt-2 h-11 w-full" variant="secondary" onClick={onVerConflito}>
              RESOLVER CONFLITO
            </Button>
          </div>
        )}
        {problema?.status === "NEEDS_ATTENTION" && (
          <div
            role="alert"
            className="rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            <p className="font-semibold">Esta alteração não foi aceita pelo servidor.</p>
            <p className="text-muted-foreground">{problema.evento.error_message}</p>
            <Button className="mt-2 h-11 w-full" variant="secondary" onClick={onVerConflito}>
              VER DETALHES
            </Button>
          </div>
        )}

        {!ocultarEsperado && (
          <p className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
            <span className="text-sm font-semibold">QUANTIDADE ESPERADA</span>
            <span className="text-2xl font-bold tabular-nums" data-testid="esperado">
              {formatarQuantidade(item.quantidade_esperada)}
            </span>
          </p>
        )}

        {bloqueado && motivoBloqueio && (
          <p
            role="status"
            className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-3 text-sm font-medium"
          >
            {motivoBloqueio}
          </p>
        )}

        <ConferenceQuantityInput
          ref={campo}
          valor={qtd}
          desabilitado={bloqueado}
          onValor={(v) => {
            sujo.current = true;
            setQtd(v);
          }}
          onConfirmar={confirmar}
        />

        {!ocultarEsperado && !invalido && (
          <ConferenceDivergence esperado={item.quantidade_esperada} conferido={n} />
        )}

        {verObs ? (
          <div className="space-y-1">
            <label htmlFor="obs-item" className="text-sm font-semibold">
              Observação
            </label>
            <Textarea
              id="obs-item"
              rows={2}
              disabled={bloqueado}
              value={obs}
              onChange={(e) => {
                sujo.current = true;
                setObs(e.target.value);
              }}
              placeholder="Ex.: embalagem danificada, material em outro local…"
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full gap-2"
            disabled={bloqueado}
            onClick={() => setVerObs(true)}
          >
            <MessageSquarePlus className="size-5" aria-hidden /> Adicionar observação
          </Button>
        )}

        <ConferencePhotos
          motor={motor}
          conferenciaId={conferenciaId}
          itemK={item.k}
          fotos={fotos}
          desabilitado={bloqueado}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          className="h-14 min-w-0 gap-0.5 px-1 text-sm"
          disabled={!temAnterior}
          onClick={onAnterior}
          aria-label="Item anterior"
        >
          <ChevronLeft className="size-5 shrink-0" aria-hidden />
          <span className="truncate max-[359px]:sr-only">ANTERIOR</span>
        </Button>
        <Button
          type="button"
          className="h-14 min-w-0 px-2 text-base font-bold"
          disabled={bloqueado || invalido}
          onClick={confirmar}
        >
          <span className="truncate">CONFIRMAR</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-14 min-w-0 gap-0.5 px-1 text-sm"
          disabled={!temProximo}
          onClick={onProximo}
          aria-label="Próximo item"
        >
          <span className="truncate max-[359px]:sr-only">PRÓXIMO</span>
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        </Button>
      </div>
    </article>
  );
});
