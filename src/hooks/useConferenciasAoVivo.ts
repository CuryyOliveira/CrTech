/**
 * Fonte única de verdade das conferências ativas (em andamento e pausadas).
 *
 * Os indicadores são calculados EXATAMENTE como na tela da conferência:
 * a partir dos registros de `conferencia_itens` (status conferido /
 * divergencia / pendente) da conferência oficial — nunca a partir dos
 * agregados de `historico_conferencias`, que só são consolidados no
 * encerramento. Assim Painel Gerencial, Monitoramento e tela da conferência
 * compartilham a mesma fonte e permanecem sincronizados em tempo real.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db, ordenarPorLocacao } from "@/lib/app";
import type { HistoricoRow } from "@/lib/audit";
import { tempoEmPausa, tempoTrabalhado } from "@/lib/gerencial";

export type ConferenciaAoVivo = {
  id: string;
  unidade_id: string;
  unidade_nome: string | null;
  tipo: string;
  status: string;
  data: string;
  hora_inicio: string;
  hora_fim: string | null;
  conferente: string | null;
  total_tempo_pausado: number | null;
  ultima_pausa: string | null;
  ultima_retomada: string | null;
  tempo_trabalhado: number | null;
  quantidade_pausas: number | null;
  /** Métricas oficiais (mesma regra da tela da conferência). */
  total: number;
  corretos: number;
  divergencias: number;
  pendentes: number;
  pct: number;
  /** Materiais incluídos durante a conferência. */
  adicionados: number;
  /** Localização do último item contado ou da primeira posição pendente. */
  posicao_atual: string | null;
  /** Histórico correspondente (usado apenas para rótulos e validação). */
  historico: HistoricoRow | null;
};

type ItemStatus = {
  conferencia_id: string;
  status: string;
  origem: string | null;
  locacao: string | null;
  codigo: string | null;
  quantidade_contada: number | null;
  updated_at: string | null;
};

export type DivergenciaSincronia = {
  conferenciaId: string;
  indicador: string;
  conferencia: number;
  painel: number;
};

/**
 * Compara os valores oficiais da conferência com os agregados do histórico.
 * Retorna as divergências encontradas (o painel sempre usa o valor oficial).
 */
export function validarSincronia(ativas: ConferenciaAoVivo[]): DivergenciaSincronia[] {
  const out: DivergenciaSincronia[] = [];
  for (const c of ativas) {
    const h = c.historico;
    if (!h) continue;
    const pares: [string, number, number][] = [
      ["Total", c.total, Number(h.quantidade_prevista ?? 0)],
      ["Corretos", c.corretos, Number(h.quantidade_conferida ?? 0)],
      ["Divergências", c.divergencias, Number(h.divergencias ?? 0)],
      ["Percentual concluído", c.pct, Math.round(Number(h.percentual ?? 0))],
      ["Status", statusPeso(c.status), statusPeso(h.status)],
    ];
    for (const [indicador, conferencia, painel] of pares) {
      if (conferencia !== painel) {
        out.push({ conferenciaId: c.id, indicador, conferencia, painel });
      }
    }
  }
  return out;
}

function statusPeso(s?: string | null) {
  return ["em_andamento", "pausada", "finalizada", "cancelada"].indexOf(s ?? "");
}

/** Sincroniza o histórico com os valores oficiais da conferência. */
async function corrigirHistorico(c: ConferenciaAoVivo) {
  if (!c.historico) return;
  await db
    .from("historico_conferencias")
    .update({
      status: c.status,
      quantidade_prevista: c.total,
      quantidade_conferida: c.corretos,
      divergencias: c.divergencias,
      percentual: c.pct,
    })
    .eq("id", c.historico.id);
}

/** Conferências ativas com métricas oficiais e atualização em tempo real. */
export function useConferenciasAoVivo() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["conferencias-ao-vivo"],
    // Realtime é a fonte primária; o intervalo é apenas rede de segurança.
    refetchInterval: 20000,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<ConferenciaAoVivo[]> => {
      const { data: confs, error } = await db
        .from("conferencias")
        .select("*")
        .in("status", ["em_andamento", "pausada"])
        .order("hora_inicio", { ascending: false });
      if (error) throw new Error(error.message);
      const lista = (confs ?? []) as Record<string, unknown>[];
      if (!lista.length) return [];

      const ids = lista.map((c) => c.id as string);
      const unidadeIds = [...new Set(lista.map((c) => c.unidade_id as string))];

      const [itens, unidades, historicos] = await Promise.all([
        db
          .from("conferencia_itens")
          .select("conferencia_id,status,origem,locacao,codigo,quantidade_contada,updated_at")
          .in("conferencia_id", ids),
        db.from("unidades").select("id,nome").in("id", unidadeIds),
        db.from("historico_conferencias").select("*").in("conferencia_id", ids),
      ]);
      if (itens.error) throw new Error(itens.error.message);

      const nomes = new Map(
        ((unidades.data ?? []) as { id: string; nome: string }[]).map((u) => [u.id, u.nome]),
      );
      const hist = new Map(
        ((historicos.data ?? []) as HistoricoRow[]).map((h) => [h.conferencia_id as string, h]),
      );

      const contagem = new Map<
        string,
        { total: number; corretos: number; diverg: number; adicionados: number }
      >();
      for (const id of ids) contagem.set(id, { total: 0, corretos: 0, diverg: 0, adicionados: 0 });
      for (const i of (itens.data ?? []) as ItemStatus[]) {
        const c = contagem.get(i.conferencia_id);
        if (!c) continue;
        c.total++;
        if (i.status === "conferido") c.corretos++;
        if (i.status === "divergencia") c.diverg++;
        if (i.origem === "adicionado") c.adicionados++;
      }

      const posicoes = new Map<string, string | null>();
      for (const id of ids) {
        const itensDaConferencia = ((itens.data ?? []) as ItemStatus[]).filter(
          (item) => item.conferencia_id === id,
        );
        const contados = itensDaConferencia
          .filter((item) => item.quantidade_contada !== null)
          .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
        const primeiroPendente = ordenarPorLocacao(
          itensDaConferencia.filter((item) => item.quantidade_contada === null),
        )[0];
        posicoes.set(id, contados[0]?.locacao ?? primeiroPendente?.locacao ?? null);
      }

      return lista.map((c) => {
        const conferenciaId = c.id as string;
        const n = contagem.get(conferenciaId) ?? {
          total: 0,
          corretos: 0,
          diverg: 0,
          adicionados: 0,
        };
        const feitos = n.corretos + n.diverg;
        return {
          id: conferenciaId,
          unidade_id: c.unidade_id as string,
          unidade_nome: nomes.get(c.unidade_id as string) ?? null,
          tipo: c.tipo as string,
          status: c.status as string,
          data: c.data as string,
          hora_inicio: c.hora_inicio as string,
          hora_fim: (c.hora_fim ?? null) as string | null,
          conferente: (c.conferente ?? null) as string | null,
          total_tempo_pausado: (c.total_tempo_pausado ?? 0) as number,
          ultima_pausa: (c.ultima_pausa ?? null) as string | null,
          ultima_retomada: (c.ultima_retomada ?? null) as string | null,
          tempo_trabalhado: (c.tempo_trabalhado ?? null) as number | null,
          quantidade_pausas: (c.quantidade_pausas ?? 0) as number,
          total: n.total,
          corretos: n.corretos,
          divergencias: n.diverg,
          pendentes: Math.max(0, n.total - feitos),
          pct: n.total ? Math.round((feitos / n.total) * 100) : 0,
          adicionados: n.adicionados,
          posicao_atual: posicoes.get(conferenciaId) ?? null,
          historico: hist.get(conferenciaId) ?? null,
        };
      });
    },
  });

  // Realtime: qualquer alteração em itens, conferências ou histórico recarrega.
  useEffect(() => {
    // Nome único por instância: dois componentes podem usar o hook ao mesmo
    // tempo e reaproveitar o mesmo tópico causaria erro após `subscribe()`.
    const canal = supabase
      .channel(`conferencias-ao-vivo-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conferencia_itens" }, () => {
        void qc.invalidateQueries({ queryKey: ["conferencias-ao-vivo"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conferencias" }, () => {
        void qc.invalidateQueries({ queryKey: ["conferencias-ao-vivo"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "historico_conferencias" },
        () => {
          void qc.invalidateQueries({ queryKey: ["conferencias-ao-vivo"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);

  // Rotina automática de validação: registra e corrige divergências.
  const ativas = query.data ?? [];
  useEffect(() => {
    if (!ativas.length) return;
    const divs = validarSincronia(ativas);
    if (!divs.length) return;
    for (const d of divs) {
      console.warn(
        `[sincronia] Conferência ${d.conferenciaId} — ${d.indicador}: conferência=${d.conferencia} × painel=${d.painel}. Corrigindo pelo valor da conferência.`,
      );
    }
    const alvos = new Set(divs.map((d) => d.conferenciaId));
    void Promise.all(
      ativas.filter((c) => alvos.has(c.id)).map((c) => corrigirHistorico(c).catch(() => undefined)),
    );
  }, [ativas]);

  return { ativas, isLoading: query.isLoading, refetch: query.refetch };
}

/** Agregados ao vivo das conferências ativas, para os cards do painel. */
export function agregadosAoVivo(ativas: ConferenciaAoVivo[], agora = Date.now()) {
  const emAndamento = ativas.filter((c) => c.status === "em_andamento").length;
  const pausadas = ativas.filter((c) => c.status === "pausada").length;
  const total = ativas.reduce((a, c) => a + c.total, 0);
  const feitos = ativas.reduce((a, c) => a + c.corretos + c.divergencias, 0);
  return {
    emAndamento,
    pausadas,
    total,
    corretos: ativas.reduce((a, c) => a + c.corretos, 0),
    divergencias: ativas.reduce((a, c) => a + c.divergencias, 0),
    pendentes: ativas.reduce((a, c) => a + c.pendentes, 0),
    adicionados: ativas.reduce((a, c) => a + c.adicionados, 0),
    pct: total ? Math.round((feitos / total) * 100) : 0,
    tempoTrabalhado: ativas.reduce((a, c) => a + tempoTrabalhado(c, agora), 0),
    tempoEmPausa: ativas.reduce((a, c) => a + tempoEmPausa(c, agora), 0),
    usuarios: new Set(ativas.map((c) => c.historico?.user_id ?? c.conferente ?? c.id)).size,
  };
}
