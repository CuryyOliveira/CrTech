/**
 * Rota da lista com VITE_CONFERENCE_V2=1: se o aparelho tem uma conferência aberta nesta lista
 * (motor V2), mostra a tela nova; senão, a página da V1 (cadastro, importação, histórico) com o
 * "Iniciar conferência" passando pelo motor V2.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAMILIA_POR_TIPO, type TipoModulo } from "@/lib/modulos";
import { moduloPorTipo } from "@/lib/permissions";
import { encerrada } from "@/lib/sync-v2/projecao";
import { useMotorSync } from "@/lib/sync-v2/react";
import type { MotorSync } from "@/lib/sync-v2";
import type { ConferenciaLocal } from "@/lib/sync-v2/tipos";
import { ConferenceScreen, ConfirmarSaida } from "./ConferenceScreen";

export type ModoV2 = {
  iniciar: (form: Record<string, string>) => Promise<void>;
  /** Mostrado no lugar da conferência da V1 quando o servidor tem uma aberta que o aparelho ainda não recebeu. */
  aguardando: ReactNode;
};

type Unidade = {
  id: string;
  nome?: string;
  tipo?: string;
  modulo_id?: string | null;
  gestor?: string | null;
  placa?: string | null;
  matricula?: string | null;
  setor?: string | null;
};

function familiaDa(u: Unidade | undefined) {
  if (!u) return undefined;
  return u.modulo_id
    ? (FAMILIA_POR_TIPO[u.tipo as TipoModulo] ?? "prateleira")
    : moduloPorTipo(u.tipo)?.familia;
}

function useConferenciasDaLista(motor: MotorSync | null, unidadeId: string) {
  const [estado, setEstado] = useState<{
    confs: ConferenciaLocal[];
    unidade?: Unidade;
    pronto: boolean;
    carregado: boolean;
  }>({
    confs: [],
    pronto: false,
    carregado: false,
  });
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const ler = async () => {
      const [confs, unidades, carregado] = await Promise.all([
        motor.conferencias(),
        motor.unidades(),
        motor.cargaInicialConcluida(),
      ]);
      if (!vivo) return;
      setEstado({
        confs: confs.filter((c) => c.unidade_id === unidadeId),
        unidade: unidades.find((u) => u.id === unidadeId) as Unidade | undefined,
        carregado,
        pronto: true,
      });
    };
    void ler();
    const parar = motor.aoAlterarDados(() => void ler());
    return () => {
      vivo = false;
      parar();
    };
  }, [motor, unidadeId]);
  return estado;
}

export function UnidadeV2({
  unidadeId,
  renderV1,
}: {
  unidadeId: string;
  renderV1: (modo: ModoV2) => ReactNode;
}) {
  const { motor, resumo } = useMotorSync();
  const { confs, unidade, pronto, carregado } = useConferenciasDaLista(motor, unidadeId);
  const navigate = useNavigate();
  // A conferência fica na tela até o usuário sair (inclusive depois de finalizar/cancelar,
  // para mostrar "finalizada neste aparelho — aguardando sincronização").
  const [fixada, setFixada] = useState<string | null>(null);
  const abertaAgora = confs.find((c) => !encerrada(c.status));
  useEffect(() => {
    if (abertaAgora && !fixada) setFixada(abertaAgora.id);
  }, [abertaAgora, fixada]);
  const aberta = confs.find((c) => c.id === fixada) ?? abertaAgora;
  const [pendentes, setPendentes] = useState(0);
  const liberado = useRef(false);
  const buscouLista = useRef(false);

  // Pendências desta conferência (para a proteção contra saída acidental).
  useEffect(() => {
    if (!motor || !aberta) {
      setPendentes(0);
      return;
    }
    const ler = () =>
      void motor
        .filaDaConferencia(aberta.id)
        .then((f) =>
          setPendentes(f.filter((x) => x.status !== "SYNCED" && x.status !== "RESOLVED").length),
        );
    ler();
    return motor.aoAlterarDados(ler);
  }, [motor, aberta]);

  // Botão voltar do Android / navegação para outra tela com alterações não enviadas.
  const bloqueio = useBlocker({
    shouldBlockFn: () =>
      Boolean(aberta) && !encerrada(aberta!.status) && pendentes > 0 && !liberado.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  function sairDaConferencia() {
    liberado.current = true;
    setFixada(null);
    const destino = unidade?.modulo_id
      ? { to: "/m/$modulo" as const, params: { modulo: String(unidade.modulo_id) } }
      : { to: (moduloPorTipo(unidade?.tipo)?.rota ?? "/menu") as "/menu" };
    const soltar = () => {
      liberado.current = false;
    };
    void navigate(destino as never).then(soltar, soltar);
  }

  // Lista ainda não baixada para o aparelho: busca antes de permitir iniciar (offline, fica o aviso).
  const online = resumo.estado !== "OFFLINE";
  if (motor && pronto && !unidade && online && !buscouLista.current) {
    buscouLista.current = true;
    void motor.sincronizar().catch(() => undefined);
  }

  // Primeira carga do aparelho ainda em andamento (listas chegam antes dos materiais): espera
  // terminar para não oferecer "Iniciar" com a lista pela metade. Sem internet ou com erro de
  // sincronização, segue com o que há (o motor avisa se faltar a lista).
  const esperandoCarga =
    !carregado && !aberta && (resumo.estado === "SYNCING" || resumo.estado === "ONLINE");
  if (!motor || !pronto || esperandoCarga) {
    return (
      <p className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" aria-hidden /> Preparando os dados deste
        aparelho…
      </p>
    );
  }

  if (aberta) {
    const familia = familiaDa(unidade);
    return (
      <>
        <ConferenceScreen
          motor={motor}
          conferenciaId={aberta.id}
          nomeLista={unidade?.nome ?? "Conferência"}
          subtitulo={unidade?.placa || unidade?.matricula || unidade?.setor || null}
          ocultarEsperado={familia === "prateleira"}
          exigeGestor={familia === "caixa"}
          rotuloResponsavel={familia === "caixa" ? "Gestor responsável" : "Responsável"}
          onSair={() => sairDaConferencia()}
        />
        <ConfirmarSaida
          aberto={bloqueio.status === "blocked"}
          onContinuar={() => bloqueio.reset?.()}
          onSair={() => bloqueio.proceed?.()}
        />
      </>
    );
  }

  return (
    <>
      {renderV1({
        iniciar: async (form) => {
          await motor.criarConferencia({
            unidade_id: unidadeId,
            conferente: form.conferente || form.almoxarife || null,
            responsavel: form.responsavel || unidade?.gestor || null,
            almoxarife: form.almoxarife || null,
            codigo_almoxarife: form.codigo || null,
            tipo: unidade?.tipo ?? null,
          });
        },
        aguardando: (
          <div className="mx-auto max-w-5xl space-y-3 p-4">
            <div className="rounded-lg border p-4 text-center">
              <p className="font-semibold">Existe uma conferência aberta nesta lista.</p>
              <p className="text-sm text-muted-foreground">
                Ela ainda não chegou a este aparelho. Sincronize para continuar a contagem.
              </p>
              <Button className="mt-3 h-12" onClick={() => void motor.sincronizarAgora()}>
                SINCRONIZAR AGORA
              </Button>
            </div>
          </div>
        ),
      })}
    </>
  );
}
