/**
 * Projeção: o que a tela mostra = estado do servidor + eventos locais ainda não refletidos,
 * reaplicados em ordem. As regras espelham as do servidor (aplicar_evento), inclusive o
 * cálculo de pausas pelo horário de cada evento.
 */
import type { EstadoConferencia, EstadoItem, ItemFila } from "./tipos";

const seg = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));
const maior = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;

export function chaveItem(conferenciaId: string, materialId: string | null, itemId: string | null) {
  if (materialId) return `${conferenciaId}|m|${materialId}`;
  if (itemId) return `${conferenciaId}|i|${itemId}`;
  throw new Error("Item sem material_id e sem id");
}

export function encerrada(status: string) {
  return status === "finalizada" || status === "cancelada" || status === "concluida";
}

export function statusItem(qtd: number | null, esperada: number): EstadoItem["status"] {
  if (qtd === null) return "pendente";
  return qtd === esperada ? "conferido" : "divergencia";
}

const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function conferenciaDoServidor(r: Record<string, unknown>): EstadoConferencia {
  return {
    unidade_id: String(r.unidade_id),
    status: (r.status as EstadoConferencia["status"]) ?? "em_andamento",
    hora_inicio: String(r.hora_inicio),
    hora_fim: txt(r.hora_fim),
    total_tempo_pausado: Number(r.total_tempo_pausado ?? 0),
    quantidade_pausas: Number(r.quantidade_pausas ?? 0),
    ultima_pausa: txt(r.ultima_pausa),
    ultima_retomada: txt(r.ultima_retomada),
    tempo_trabalhado: num(r.tempo_trabalhado),
    conferente: txt(r.conferente),
    responsavel: txt(r.responsavel),
    observacoes: txt(r.observacoes),
    motivo_cancelamento: txt(r.motivo_cancelamento),
    tem_assinatura: Boolean(r.tem_assinatura),
    tem_assinatura_gestor: Boolean(r.tem_assinatura_gestor),
  };
}

export function itemDoServidor(r: Record<string, unknown>): EstadoItem {
  return {
    id: String(r.id),
    material_id: txt(r.material_id),
    codigo: txt(r.codigo),
    descricao: txt(r.descricao),
    locacao: txt(r.locacao),
    quantidade_esperada: Number(r.quantidade_esperada ?? 0),
    quantidade_contada: num(r.quantidade_contada),
    status: (r.status as EstadoItem["status"]) ?? "pendente",
    observacoes: txt(r.observacoes),
    origem: r.origem === "adicionado" ? "adicionado" : "lista",
    motivo_inclusao: txt(r.motivo_inclusao),
    versao: Number(r.versao ?? 0),
  };
}

const quando = (e: ItemFila) => e.created_at;

/** Aplica um evento de nível de conferência. Eventos que não se aplicam não mudam nada (como no servidor). */
export function aplicarNaConferencia(c: EstadoConferencia, e: ItemFila): EstadoConferencia {
  const t = quando(e);
  switch (e.event_type) {
    case "CONFERENCE_PAUSED": {
      if (c.status !== "em_andamento") return c;
      const inicio = maior(t, maior(c.ultima_retomada, c.hora_inicio))!;
      return {
        ...c,
        status: "pausada",
        ultima_pausa: inicio,
        quantidade_pausas: c.quantidade_pausas + 1,
      };
    }
    case "CONFERENCE_RESUMED": {
      if (c.status !== "pausada") return c;
      const fim = maior(t, c.ultima_pausa)!;
      return {
        ...c,
        status: "em_andamento",
        ultima_retomada: fim,
        total_tempo_pausado:
          c.total_tempo_pausado + (c.ultima_pausa ? seg(c.ultima_pausa, fim) : 0),
      };
    }
    case "SIGNATURE_ADDED": {
      if (encerrada(c.status)) return c;
      return e.payload.tipo === "gestor"
        ? { ...c, tem_assinatura_gestor: true }
        : { ...c, tem_assinatura: true };
    }
    case "CONFERENCE_FINALIZED": {
      if (c.status === "finalizada" || c.status === "concluida") return c;
      if (c.status === "cancelada") return c;
      let total = c.total_tempo_pausado;
      const fim = maior(t, c.status === "pausada" ? c.ultima_pausa : c.ultima_retomada)!;
      if (c.status === "pausada" && c.ultima_pausa) total += seg(c.ultima_pausa, fim);
      return {
        ...c,
        status: "finalizada",
        hora_fim: fim,
        total_tempo_pausado: total,
        tempo_trabalhado: Math.max(0, seg(c.hora_inicio, fim) - total),
        conferente: txt(e.payload.conferente) ?? c.conferente,
        responsavel: txt(e.payload.responsavel) ?? c.responsavel,
        observacoes:
          e.payload.observacoes !== undefined ? txt(e.payload.observacoes) : c.observacoes,
      };
    }
    case "CONFERENCE_CANCELLED": {
      if (encerrada(c.status)) return c;
      return { ...c, status: "cancelada", hora_fim: t, motivo_cancelamento: txt(e.payload.motivo) };
    }
    default:
      return c;
  }
}

export function aplicarNoItem(i: EstadoItem, e: ItemFila): EstadoItem {
  if (e.event_type !== "ITEM_COUNTED") return i;
  const qtd = num(e.payload.quantidade);
  return {
    ...i,
    quantidade_contada: qtd,
    status: statusItem(qtd, i.quantidade_esperada),
    observacoes: "observacoes" in e.payload ? txt(e.payload.observacoes) : i.observacoes,
  };
}

/** Evento ainda precisa ser reaplicado sobre o estado do servidor? */
export function reaplicavel(e: ItemFila) {
  if (e.status === "RESOLVED") return false;
  if (e.status === "SYNCED") return !e.refletido;
  return true;
}

/** Tempo trabalhado até agora (para exibir o cronômetro), descontando pausas. */
export function tempoTrabalhado(c: EstadoConferencia, agora = new Date().toISOString()) {
  if (c.tempo_trabalhado !== null && encerrada(c.status)) return c.tempo_trabalhado;
  const fim = c.status === "pausada" && c.ultima_pausa ? c.ultima_pausa : agora;
  return Math.max(0, seg(c.hora_inicio, fim) - c.total_tempo_pausado);
}
