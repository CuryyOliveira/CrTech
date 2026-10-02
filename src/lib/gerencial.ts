/**
 * Inteligência Gerencial: agregações do Histórico Operacional e do Log de Auditoria
 * usadas no Painel Gerencial, nos gráficos, rankings e nas Metas/KPIs.
 */
import type { HistoricoRow } from "@/lib/audit";
import { MODULOS, PERFIS } from "@/lib/permissions";
import { dataLocalISO } from "@/lib/datas";

export type FaixaId = "hoje" | "7d" | "30d" | "personalizado";

export const FAIXAS: { valor: FaixaId; label: string }[] = [
  { valor: "hoje", label: "Hoje" },
  { valor: "7d", label: "Últimos 7 dias" },
  { valor: "30d", label: "Últimos 30 dias" },
  { valor: "personalizado", label: "Período personalizado" },
];

export const SETOR_LABEL: Record<string, string> = {
  agricola: "Agrícola",
  industria: "Indústria",
};

export function iso(d: Date) {
  return dataLocalISO(d);
}

export function hojeISO() {
  return iso(new Date());
}

/** Converte a faixa selecionada em intervalo de datas (YYYY-MM-DD). */
export function intervalo(faixa: FaixaId, de: string, ate: string) {
  const hoje = new Date();
  if (faixa === "personalizado") {
    return { de: de || iso(hoje), ate: ate || iso(hoje) };
  }
  if (faixa === "hoje") return { de: iso(hoje), ate: iso(hoje) };
  const dias = faixa === "7d" ? 6 : 29;
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  return { de: iso(inicio), ate: iso(hoje) };
}

export function faixaLabel(faixa: FaixaId, de: string, ate: string) {
  if (faixa !== "personalizado") return FAIXAS.find((f) => f.valor === faixa)!.label;
  return `${de || "—"} a ${ate || "—"}`;
}

export function moduloLabel(id?: string | null) {
  return MODULOS.find((m) => m.id === id)?.titulo ?? id ?? "—";
}

export function perfilLabel(p?: string | null) {
  return PERFIS.find((x) => x.valor === p)?.label ?? p ?? "—";
}

export function setorLabel(s?: string | null) {
  return SETOR_LABEL[s ?? ""] ?? s ?? "—";
}

function media(valores: number[]) {
  if (!valores.length) return 0;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

export type Indicadores = {
  hoje: number;
  mes: number;
  emAndamento: number;
  pausadas: number;
  finalizadas: number;
  canceladas: number;
  itens: number;
  divergencias: number;
  tempoMedio: number;
  usuariosAtivos: number;
  total: number;
  percentualMedio: number;
};

export function indicadores(rows: HistoricoRow[]): Indicadores {
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const duracoes = rows
    .filter((r) => r.status === "finalizada" && duracaoRegistrada(r) != null)
    .map((r) => duracaoRegistrada(r) as number);

  return {
    hoje: rows.filter((r) => r.data === hoje).length,
    mes: rows.filter((r) => (r.data ?? "").startsWith(mes)).length,
    emAndamento: rows.filter((r) => r.status === "em_andamento").length,
    pausadas: rows.filter((r) => r.status === "pausada").length,
    finalizadas: rows.filter((r) => r.status === "finalizada").length,
    canceladas: rows.filter((r) => r.status === "cancelada").length,
    itens: rows.reduce((a, r) => a + Number(r.quantidade_conferida ?? 0), 0),
    divergencias: rows.reduce((a, r) => a + Number(r.divergencias ?? 0), 0),
    tempoMedio: media(duracoes),
    usuariosAtivos: new Set(rows.map((r) => r.user_id)).size,
    total: rows.length,
    percentualMedio: media(rows.map((r) => Number(r.percentual ?? 0))),
  };
}

export type Ponto = {
  chave: string;
  label: string;
  conferencias: number;
  divergencias: number;
  itens: number;
  tempoMedio: number;
};

function agrupar(rows: HistoricoRow[], chave: (r: HistoricoRow) => string, rotulo: (k: string) => string) {
  const mapa = new Map<string, HistoricoRow[]>();
  for (const r of rows) {
    const k = chave(r);
    if (!k) continue;
    const lista = mapa.get(k);
    if (lista) lista.push(r);
    else mapa.set(k, [r]);
  }
  const pontos: Ponto[] = [...mapa.entries()].map(([k, itens]) => ({
    chave: k,
    label: rotulo(k),
    conferencias: itens.length,
    divergencias: itens.reduce((a, r) => a + Number(r.divergencias ?? 0), 0),
    itens: itens.reduce((a, r) => a + Number(r.quantidade_conferida ?? 0), 0),
    tempoMedio: media(
      itens.map((r) => duracaoRegistrada(r)).filter((v): v is number => v != null),
    ),

  }));
  return pontos;
}

function diaCurto(k: string) {
  const [, m, d] = k.split("-");
  return `${d}/${m}`;
}

/** Semana ISO aproximada usada como chave de agrupamento (YYYY-Sxx). */
function semanaChave(data: string) {
  const d = new Date(`${data}T00:00:00`);
  const inicio = new Date(d.getFullYear(), 0, 1);
  const dias = Math.floor((d.getTime() - inicio.getTime()) / 86400000);
  const semana = Math.floor((dias + inicio.getDay()) / 7) + 1;
  return `${d.getFullYear()}-S${String(semana).padStart(2, "0")}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function porDia(rows: HistoricoRow[]) {
  return agrupar(rows, (r) => r.data, diaCurto).sort((a, b) => a.chave.localeCompare(b.chave));
}

export function porSemana(rows: HistoricoRow[]) {
  return agrupar(rows, (r) => semanaChave(r.data), (k) => `Sem ${k.split("-S")[1]}`).sort((a, b) =>
    a.chave.localeCompare(b.chave),
  );
}

export function porMes(rows: HistoricoRow[]) {
  return agrupar(
    rows,
    (r) => (r.data ?? "").slice(0, 7),
    (k) => `${MESES[Number(k.slice(5, 7)) - 1] ?? k}/${k.slice(2, 4)}`,
  ).sort((a, b) => a.chave.localeCompare(b.chave));
}

export function porModulo(rows: HistoricoRow[]) {
  return agrupar(rows, (r) => r.modulo || "—", moduloLabel).sort((a, b) => b.conferencias - a.conferencias);
}

export function porSetor(rows: HistoricoRow[]) {
  return agrupar(rows, (r) => r.setor || "—", setorLabel).sort((a, b) => b.conferencias - a.conferencias);
}

export function porUsuario(rows: HistoricoRow[]) {
  const nomes = new Map(rows.map((r) => [r.user_id, r.nome ?? r.usuario_email ?? r.user_id.slice(0, 8)]));
  return agrupar(rows, (r) => r.user_id, (k) => nomes.get(k) ?? k).sort(
    (a, b) => b.conferencias - a.conferencias,
  );
}

export type Ranking = Ponto & { produtividade: number; indiceDivergencia: number };

/** Ordena um agrupamento pelo critério de ranking escolhido. */
export function ranking(pontos: Ponto[], criterio: "conferencias" | "produtividade" | "tempo" | "divergencias") {
  const linhas: Ranking[] = pontos.map((p) => ({
    ...p,
    produtividade: p.conferencias ? Math.round(p.itens / p.conferencias) : 0,
    indiceDivergencia: p.itens ? Number(((p.divergencias / p.itens) * 100).toFixed(1)) : 0,
  }));
  const ordem: Record<string, (a: Ranking, b: Ranking) => number> = {
    conferencias: (a, b) => b.conferencias - a.conferencias,
    produtividade: (a, b) => b.produtividade - a.produtividade,
    tempo: (a, b) => (a.tempoMedio || Infinity) - (b.tempoMedio || Infinity),
    divergencias: (a, b) => a.indiceDivergencia - b.indiceDivergencia,
  };
  return [...linhas].sort(ordem[criterio]!);
}

export const CRITERIOS_RANKING = [
  { valor: "conferencias", label: "Quantidade de conferências" },
  { valor: "produtividade", label: "Produtividade (itens/conferência)" },
  { valor: "tempo", label: "Menor tempo médio" },
  { valor: "divergencias", label: "Menor índice de divergências" },
] as const;

/* ----------------------------- Metas e KPIs ----------------------------- */

export type MetaRow = {
  id: string;
  escopo: "usuario" | "setor" | "modulo" | string;
  alvo: string;
  alvo_nome: string | null;
  periodo: string;
  min_conferencias: number | null;
  tempo_max_segundos: number | null;
  percentual_min: number | null;
  max_divergencias: number | null;
  ativo: boolean;
  created_at: string;
};

export const ESCOPOS = [
  { valor: "usuario", label: "Usuário" },
  { valor: "setor", label: "Setor" },
  { valor: "modulo", label: "Módulo" },
];

export const PERIODOS = [
  { valor: "diario", label: "Diário" },
  { valor: "semanal", label: "Semanal" },
  { valor: "mensal", label: "Mensal" },
];

export function periodoLabel(p?: string | null) {
  return PERIODOS.find((x) => x.valor === p)?.label ?? p ?? "—";
}

export function escopoLabel(e?: string | null) {
  return ESCOPOS.find((x) => x.valor === e)?.label ?? e ?? "—";
}

/** Recorte de datas do período de apuração da meta. */
export function janelaMeta(periodo: string) {
  const hoje = new Date();
  if (periodo === "diario") return { de: iso(hoje), ate: iso(hoje) };
  if (periodo === "semanal") {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - inicio.getDay());
    return { de: iso(inicio), ate: iso(hoje) };
  }
  return { de: `${iso(hoje).slice(0, 7)}-01`, ate: iso(hoje) };
}

export type Avaliacao = {
  conferencias: number;
  tempoMedio: number;
  percentualMedio: number;
  divergencias: number;
  atingido: number;
  situacao: "atingida" | "atencao" | "abaixo" | "sem_dados";
  evolucao: number;
  anterior: number;
};

function pertence(meta: MetaRow, r: HistoricoRow) {
  if (meta.escopo === "usuario") return r.user_id === meta.alvo;
  if (meta.escopo === "setor") return (r.setor ?? "") === meta.alvo;
  return (r.modulo ?? "") === meta.alvo;
}

/** Avalia a meta contra o histórico (período atual x período anterior). */
export function avaliarMeta(meta: MetaRow, rows: HistoricoRow[]): Avaliacao {
  const { de, ate } = janelaMeta(meta.periodo);
  const dias = Math.max(1, Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 86400000) + 1);
  const inicioAnterior = new Date(new Date(de).getTime() - dias * 86400000);
  const fimAnterior = new Date(new Date(de).getTime() - 86400000);

  const doEscopo = rows.filter((r) => pertence(meta, r));
  const atual = doEscopo.filter((r) => r.data >= de && r.data <= ate);
  const anteriorRows = doEscopo.filter((r) => r.data >= iso(inicioAnterior) && r.data <= iso(fimAnterior));

  const conferencias = atual.length;
  const tempoMedio = media(
    atual.map((r) => duracaoRegistrada(r)).filter((v): v is number => v != null),
  );
  const percentualMedio = media(atual.map((r) => Number(r.percentual ?? 0)));
  const divergencias = atual.reduce((a, r) => a + Number(r.divergencias ?? 0), 0);

  const partes: number[] = [];
  if (meta.min_conferencias) partes.push(Math.min(200, (conferencias / meta.min_conferencias) * 100));
  if (meta.percentual_min) partes.push(Math.min(200, (percentualMedio / meta.percentual_min) * 100));
  if (meta.tempo_max_segundos) {
    partes.push(tempoMedio ? Math.min(200, (meta.tempo_max_segundos / tempoMedio) * 100) : 0);
  }
  if (meta.max_divergencias != null) {
    partes.push(divergencias <= meta.max_divergencias ? 100 : Math.max(0, 100 - (divergencias - meta.max_divergencias) * 10));
  }
  const atingido = partes.length ? Math.round(media(partes)) : 0;
  const situacao: Avaliacao["situacao"] = !conferencias
    ? "sem_dados"
    : atingido >= 100
      ? "atingida"
      : atingido >= 70
        ? "atencao"
        : "abaixo";

  return {
    conferencias,
    tempoMedio,
    percentualMedio,
    divergencias,
    atingido,
    situacao,
    anterior: anteriorRows.length,
    evolucao: anteriorRows.length
      ? Math.round(((conferencias - anteriorRows.length) / anteriorRows.length) * 100)
      : conferencias
        ? 100
        : 0,
  };
}

export const SITUACAO_LABEL: Record<Avaliacao["situacao"], string> = {
  atingida: "Meta atingida",
  atencao: "Em atenção",
  abaixo: "Abaixo da meta",
  sem_dados: "Sem dados no período",
};

/** Tempo decorrido em segundos desde o início da conferência (bruto, sem descontar pausas). */
export function decorrido(inicio: string, agora = Date.now()) {
  return Math.max(0, Math.round((agora - new Date(inicio).getTime()) / 1000));
}

export type TempoConferencia = {
  status: string;
  hora_inicio: string;
  hora_fim?: string | null;
  total_tempo_pausado?: number | null;
  ultima_pausa?: string | null;
  tempo_trabalhado?: number | null;
  duracao_segundos?: number | null;
};

/**
 * Tempo efetivamente trabalhado (em segundos): apenas os períodos em que a
 * conferência esteve "em andamento". Congela durante a pausa e suporta
 * qualquer quantidade de pausas.
 */
export function tempoTrabalhado(r: TempoConferencia, agora = Date.now()) {
  const inicio = new Date(r.hora_inicio).getTime();
  const pausado = Number(r.total_tempo_pausado ?? 0);
  if (r.status === "pausada") {
    // Congelado: nunca soma tempo enquanto pausada.
    if (r.ultima_pausa) {
      return Math.max(0, Math.round((new Date(r.ultima_pausa).getTime() - inicio) / 1000) - pausado);
    }
    if (r.tempo_trabalhado != null) return Math.max(0, Number(r.tempo_trabalhado));
    return Math.max(0, Math.round((agora - inicio) / 1000) - pausado);
  }
  if (r.status === "em_andamento") {
    return Math.max(0, Math.round((agora - inicio) / 1000) - pausado);
  }
  if (r.tempo_trabalhado != null) return Math.max(0, Number(r.tempo_trabalhado));
  if (r.duracao_segundos != null) return Math.max(0, Number(r.duracao_segundos));
  const fim = r.hora_fim ? new Date(r.hora_fim).getTime() : agora;
  return Math.max(0, Math.round((fim - inicio) / 1000) - pausado);
}


/** Tempo da pausa atual (0 quando não está pausada). */
export function tempoEmPausa(r: TempoConferencia, agora = Date.now()) {
  if (r.status !== "pausada" || !r.ultima_pausa) return 0;
  return Math.max(0, Math.round((agora - new Date(r.ultima_pausa).getTime()) / 1000));
}

/** Tempo trabalhado registrado de uma conferência encerrada (para médias e KPIs). */
export function duracaoRegistrada(r: TempoConferencia): number | null {
  if (r.tempo_trabalhado != null) return Number(r.tempo_trabalhado);
  if (r.duracao_segundos != null) return Number(r.duracao_segundos);
  return null;
}

