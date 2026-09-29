/**
 * Conferência V2 (mobile-first, funciona no desktop). Camada de interface sobre o motor V2:
 * toda ação vira um evento do motor; a tela só lê o estado local e reage aos avisos do motor.
 *
 * Celular: abas ITEM / LISTA, barra fixa ANTERIOR · CONFIRMAR · PRÓXIMO.
 * Desktop (lg+): lista à esquerda, item à direita.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ListChecks, PackagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PainelAtencao } from "@/components/sync-v2/PainelAtencao";
import {
  aplicarFiltro,
  buscar,
  codigoExato,
  contarPorFiltro,
  proximoAposSalvar,
  vizinho,
  type Filtro,
} from "@/lib/conferencia-v2/apresentacao";
import type { MotorSync } from "@/lib/sync-v2";
import { ocultarIndicadorGlobal, useResumoMotor } from "@/lib/sync-v2/react";
import { encerrada } from "@/lib/sync-v2/projecao";
import { cn } from "@/lib/utils";
import { ConferenceAdditionalMaterial } from "./ConferenceAdditionalMaterial";
import { ConferenceFilters } from "./ConferenceFilters";
import { ConferenceFinish } from "./ConferenceFinish";
import { ConferenceItem } from "./ConferenceItem";
import { ConferenceItemList } from "./ConferenceItemList";
import { ConferencePause, ConferenceTimer } from "./ConferencePause";
import { ConferenceProgress } from "./ConferenceProgress";
import { ConferenceSearch } from "./ConferenceSearch";
import { ConferenceSyncBadge, ConferenceSyncStatus } from "./ConferenceSyncStatus";
import { executar, useConferenciaV2 } from "./useConferenciaV2";

export type ConferenceScreenProps = {
  motor: MotorSync;
  conferenciaId: string;
  nomeLista: string;
  subtitulo?: string | null;
  /** Contagem cega (família "prateleira" na V1): esconde esperado e divergência. */
  ocultarEsperado?: boolean;
  /** Família "caixa": exige assinatura do gestor. */
  exigeGestor?: boolean;
  rotuloResponsavel?: string;
  /** Sair da tela. `forcado` = o usuário já confirmou a saída com pendências. */
  onSair: (forcado: boolean) => void;
};

export function ConferenceScreen(props: ConferenceScreenProps) {
  const { motor, conferenciaId, onSair } = props;
  const dados = useConferenciaV2(motor, conferenciaId);
  const resumoSync = useResumoMotor(motor);
  const { conferencia, itens, problemas, resumo, fotos, aguardandoSync } = dados;

  const [termo, setTermo] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [atual, setAtual] = useState<string | null>(null);
  const [aba, setAba] = useState<"item" | "lista">("item");
  const [adicionar, setAdicionar] = useState(false);
  const [finalizar, setFinalizar] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [atencao, setAtencao] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // Esta tela mostra o próprio estado de sincronização.
  useEffect(() => ocultarIndicadorGlobal(), []);

  // Fechar/recarregar a aba com alterações não enviadas: o navegador pede confirmação.
  // (Os dados já estão no aparelho; é só um aviso.)
  useEffect(() => {
    if (aguardandoSync === 0) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [aguardandoSync]);

  const contagem = useMemo(() => contarPorFiltro(itens, problemas), [itens, problemas]);
  const visiveis = useMemo(() => {
    const filtrados = aplicarFiltro(itens, filtro, problemas);
    return termo ? buscar(filtrados, termo) : filtrados;
  }, [itens, filtro, problemas, termo]);

  // Item atual: o escolhido; se sumiu, o primeiro pendente visível (ou o primeiro).
  const itemAtual = useMemo(() => {
    const porChave = atual ? itens.find((i) => i.k === atual) : undefined;
    if (porChave) return porChave;
    return visiveis.find((i) => i.status === "pendente") ?? visiveis[0] ?? itens[0] ?? null;
  }, [atual, itens, visiveis]);
  const k = itemAtual?.k ?? null;
  const indice = k ? visiveis.findIndex((i) => i.k === k) : -1;

  const selecionar = useCallback((chave: string) => {
    setAtual(chave);
    setAba("item");
  }, []);

  const lerCodigo = useCallback(
    (texto: string) => {
      const achado = codigoExato(itens, texto);
      if (!achado) {
        if (texto.trim()) toast.info("Código não encontrado nesta conferência.");
        return false;
      }
      setFiltro("todos");
      selecionar(achado.k);
      setTimeout(() => document.getElementById("qtd-conferida")?.focus(), 50);
      return true;
    },
    [itens, selecionar],
  );

  const pausada = conferencia?.status === "pausada";
  const fechada = conferencia ? encerrada(conferencia.status) : false;

  const confirmar = useCallback(
    async (quantidade: number | null, observacoes: string | null, mudou: boolean) => {
      if (!itemAtual) return;
      const salvo = itemAtual.k;
      // Avança JÁ (antes de gravar): quem digita rápido nunca registra no item errado.
      const proximo = proximoAposSalvar(visiveis, salvo);
      if (proximo) setAtual(proximo);
      if (mudou) {
        const ok = await executar(() =>
          motor.contarItem(conferenciaId, salvo, quantidade, observacoes),
        );
        if (ok === null) {
          setAtual(salvo); // não gravou: volta para o item e mostra o erro
          return;
        }
        if (!proximo) toast.success("Salvo. Este era o último item da lista.");
      }
    },
    [itemAtual, visiveis, motor, conferenciaId],
  );

  async function pausarOuRetomar(pausar: boolean) {
    setOcupado(true);
    await executar(
      () => (pausar ? motor.pausar(conferenciaId) : motor.retomar(conferenciaId)),
      pausar ? "Conferência pausada" : "Conferência retomada",
    );
    setOcupado(false);
  }

  async function confirmarCancelamento() {
    setOcupado(true);
    const ok = await executar(
      () => motor.cancelar(conferenciaId, motivoCancelamento),
      "Conferência cancelada",
    );
    setOcupado(false);
    if (ok !== null) {
      setCancelar(false);
      onSair(true);
    }
  }

  function voltar() {
    if (aguardandoSync > 0 && !fechada) setConfirmarSaida(true);
    else onSair(false);
  }

  const nomeDoItem = useCallback(
    (chave: string) => {
      const i = itens.find((x) => x.k === chave);
      return i ? `${i.codigo ?? ""} ${i.descricao ?? ""}`.trim() : null;
    },
    [itens],
  );

  if (!dados.carregado) {
    return <p className="p-6 text-center text-muted-foreground">Abrindo conferência…</p>;
  }
  if (!conferencia) {
    return (
      <div className="space-y-4 p-6 text-center">
        <p>Esta conferência não está mais disponível neste aparelho.</p>
        <Button onClick={() => onSair(true)}>Voltar</Button>
      </div>
    );
  }

  const ocultarEsperado = Boolean(props.ocultarEsperado);
  const bloqueio = fechada
    ? "Esta conferência já foi encerrada."
    : pausada
      ? "Conferência pausada. Retome para continuar contando."
      : undefined;

  return (
    <div className="cr-alto-contraste flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Voltar para a lista"
            onClick={voltar}
          >
            <ArrowLeft className="size-6" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight">{props.nomeLista}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <ConferenceTimer conferencia={conferencia} />
              <ConferenceSyncBadge resumo={resumoSync} />
            </div>
          </div>
          <Button
            variant={aba === "lista" ? "default" : "secondary"}
            className="h-11 gap-1.5 px-3 lg:hidden"
            aria-pressed={aba === "lista"}
            aria-label={
              aba === "lista" ? "Voltar ao item" : `Ver lista de itens (${visiveis.length})`
            }
            onClick={() => setAba(aba === "lista" ? "item" : "lista")}
          >
            <ListChecks className="size-5" aria-hidden /> {aba === "lista" ? "ITEM" : "LISTA"}
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 content-start gap-x-6 px-4 lg:grid-cols-[minmax(320px,420px)_1fr] lg:grid-rows-[auto_1fr]">
        {/* Progresso e busca: um só, no topo (celular) ou no alto da coluna esquerda (desktop) */}
        <section className="space-y-3 pt-3 lg:col-start-1 lg:row-start-1">
          <ConferenceProgress resumo={resumo} />
          <ConferenceSearch onBusca={setTermo} onCodigoLido={lerCodigo} />
        </section>

        {/* Filtros + lista: no celular aparecem na aba LISTA */}
        <aside
          className={cn(
            "space-y-3 py-3 lg:col-start-1 lg:row-start-2 lg:block",
            aba === "item" && "hidden",
          )}
        >
          <ConferenceFilters filtro={filtro} contagem={contagem} onFiltro={setFiltro} />
          <ConferenceItemList
            itens={visiveis}
            problemas={problemas}
            atual={k}
            ocultarEsperado={ocultarEsperado}
            onSelecionar={selecionar}
            className="h-[calc(100dvh-19rem)] min-h-64 rounded-lg border lg:h-[calc(100dvh-17rem)]"
          />
        </aside>

        {/* Item atual */}
        <main
          className={cn(
            "flex flex-col py-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex",
            aba === "lista" && "hidden",
          )}
        >
          <div className="space-y-2">
            <ConferenceSyncStatus
              motor={motor}
              resumo={resumoSync}
              aguardandoNestaConferencia={aguardandoSync}
              onAbrirAtencao={() => setAtencao(true)}
            />
          </div>
          <div className="mt-3 flex-1">
            {itemAtual ? (
              <ConferenceItem
                motor={motor}
                conferenciaId={conferenciaId}
                item={itemAtual}
                problema={problemas.get(itemAtual.k)}
                fotos={fotos}
                posicao={indice >= 0 ? indice + 1 : 0}
                total={visiveis.length}
                bloqueado={Boolean(bloqueio)}
                motivoBloqueio={bloqueio}
                ocultarEsperado={ocultarEsperado}
                temAnterior={vizinho(visiveis, k, -1) !== null && indice > 0}
                temProximo={indice >= 0 && indice < visiveis.length - 1}
                onAnterior={() => {
                  const v = vizinho(visiveis, k, -1);
                  if (v) setAtual(v);
                }}
                onProximo={() => {
                  const v = vizinho(visiveis, k, 1);
                  if (v) setAtual(v);
                }}
                onConfirmar={(q, o, m) => void confirmar(q, o, m)}
                onVerConflito={() => setAtencao(true)}
              />
            ) : (
              <p className="p-6 text-center text-muted-foreground">
                Nenhum item nesta conferência.
              </p>
            )}
          </div>

          {!fechada && (
            <section
              aria-label="Ações da conferência"
              className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2"
            >
              <ConferencePause
                pausada={pausada}
                ocupado={ocupado}
                onPausar={() => void pausarOuRetomar(true)}
                onRetomar={() => void pausarOuRetomar(false)}
              />
              <Button
                variant="outline"
                className="h-12 gap-2 text-base"
                disabled={pausada}
                onClick={() => setAdicionar(true)}
              >
                <PackagePlus className="size-5" aria-hidden /> ADICIONAR MATERIAL
              </Button>
              <Button
                className="h-12 text-base font-bold sm:col-span-2"
                disabled={pausada}
                onClick={() => setFinalizar(true)}
              >
                FINALIZAR CONFERÊNCIA
              </Button>
              {pausada && (
                <p className="text-center text-xs text-muted-foreground sm:col-span-2">
                  Retome a conferência para adicionar material ou finalizar.
                </p>
              )}
              <Button
                variant="ghost"
                className="h-11 gap-2 text-destructive sm:col-span-2"
                onClick={() => setCancelar(true)}
              >
                <X className="size-4" aria-hidden /> Cancelar conferência
              </Button>
            </section>
          )}
          {fechada && (
            <div
              className="mt-4 space-y-2 rounded-lg border p-4 text-center"
              data-testid="conferencia-encerrada"
            >
              <p className="font-semibold">
                Conferência {conferencia.status === "cancelada" ? "cancelada" : "finalizada"}
                {conferencia.pendente ? " neste aparelho — aguardando sincronização." : "."}
              </p>
              <Button className="h-12 w-full" onClick={() => onSair(true)}>
                Voltar para a lista
              </Button>
            </div>
          )}
        </main>
      </div>

      {/* Abas do celular */}
      <nav
        className="sticky bottom-0 z-10 grid grid-cols-2 border-t bg-card lg:hidden"
        aria-label="Alternar entre item e lista"
        style={{ display: aba === "item" ? "none" : undefined }}
      >
        <button type="button" className="h-12 text-sm font-semibold" onClick={() => setAba("item")}>
          VOLTAR AO ITEM
        </button>
        <span className="flex items-center justify-center text-sm text-muted-foreground">
          {visiveis.length} itens
        </span>
      </nav>

      <ConferenceAdditionalMaterial
        motor={motor}
        conferenciaId={conferenciaId}
        itens={itens}
        aberto={adicionar}
        onFechar={() => setAdicionar(false)}
        onIrParaItem={selecionar}
      />
      <ConferenceFinish
        motor={motor}
        conferencia={conferencia}
        resumo={resumo}
        aguardandoSync={aguardandoSync}
        exigeGestor={Boolean(props.exigeGestor)}
        rotuloResponsavel={props.rotuloResponsavel ?? "Responsável"}
        aberto={finalizar}
        onFechar={() => setFinalizar(false)}
        onFinalizada={() => {
          setFinalizar(false);
          toast.success("Conferência finalizada.");
          void motor.sincronizar().catch(() => undefined);
        }}
      />
      <PainelAtencao
        motor={motor}
        aberto={atencao}
        onFechar={() => setAtencao(false)}
        conferenciaId={conferenciaId}
        nomeDoItem={nomeDoItem}
      />

      <Dialog open={cancelar} onOpenChange={setCancelar}>
        <DialogContent className="cr-alto-contraste">
          <DialogHeader>
            <DialogTitle>Cancelar conferência?</DialogTitle>
            <DialogDescription>
              A conferência será encerrada como cancelada e ficará no histórico. Informe o motivo.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Motivo do cancelamento"
            rows={3}
            value={motivoCancelamento}
            onChange={(e) => setMotivoCancelamento(e.target.value)}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-12" onClick={() => setCancelar(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              className="h-12"
              disabled={ocupado || motivoCancelamento.trim().length < 3}
              onClick={() => void confirmarCancelamento()}
            >
              CANCELAR CONFERÊNCIA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmarSaida
        aberto={confirmarSaida}
        onContinuar={() => setConfirmarSaida(false)}
        onSair={() => {
          setConfirmarSaida(false);
          onSair(true);
        }}
      />
    </div>
  );
}

/** "Existem alterações ainda não sincronizadas." — CONTINUAR / SAIR (nada é apagado). */
export function ConfirmarSaida({
  aberto,
  onContinuar,
  onSair,
}: {
  aberto: boolean;
  onContinuar: () => void;
  onSair: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onContinuar()}>
      <DialogContent className="cr-alto-contraste">
        <DialogHeader>
          <DialogTitle>Existem alterações ainda não sincronizadas.</DialogTitle>
          <DialogDescription>
            Elas continuam guardadas neste aparelho e serão enviadas quando houver conexão. Nada
            será apagado se você sair.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button className="h-12" onClick={onContinuar}>
            CONTINUAR
          </Button>
          <Button variant="outline" className="h-12" onClick={onSair}>
            SAIR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
