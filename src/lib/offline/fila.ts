/**
 * Armazenamento local das operações offline (IndexedDB via ./idb): cache dos registros já
 * sincronizados e fila de alterações pendentes (fila FIFO; nada é descartado automaticamente).
 *
 * Cada operação carrega o escopo (empresa, módulo, usuário) e uma chave de
 * idempotência opcional (chave explícita). Os ids das linhas são gerados no aparelho,
 * então reenvios (upsert por chave primária) não duplicam registros no servidor.
 */

import { gravarLocal, lerLocal } from "./idb";
import { agoraLocalISO } from "@/lib/datas";

const CACHE = "cr:cache:";
const FILA = "cr:fila";

/** Chave primária usada por tabela (padrão: id). */
const CHAVE: Record<string, string> = { configuracoes_sistema: "chave" };

export type Filtro = { coluna: string; valor: unknown };

export type Escopo = {
  empresa_id?: string | null;
  modulo_id?: string | null;
  usuario_id?: string | null;
};

export type Operacao = {
  id: string;
  tabela: string;
  tipo: "insert" | "update" | "delete" | "upsert";
  payload: Record<string, unknown> | Record<string, unknown>[] | null;
  filtros: Filtro[];
  criado_em: string;
  tentativas: number;
  /** Chave de idempotência: identifica a mesma operação repetida. */
  chave?: string;
  /** Registro alvo (quando conhecido) — usado no relatório de conflitos. */
  entidade_id?: string | null;
  /** "atencao": falhou repetidas vezes; continua na fila (nunca é descartada). */
  status?: "pendente" | "erro" | "atencao";
  ultimo_erro?: string | null;
  proxima_tentativa?: string | null;
} & Escopo;

export type Linha = Record<string, unknown>;

export function chavePrimaria(tabela: string) {
  return CHAVE[tabela] ?? "id";
}

const ler = lerLocal;
const gravar = gravarLocal;

/* ---------------------------------- cache --------------------------------- */

export function lerLinhas(tabela: string): Linha[] {
  return ler<Linha[]>(CACHE + tabela, []);
}

export function gravarLinhas(tabela: string, linhas: Linha[]) {
  gravar(CACHE + tabela, linhas);
}

/** Mescla registros vindos do servidor no cache local (sem perder pendências). */
export function guardarLinhas(tabela: string, novas: Linha[]) {
  if (!novas.length) return;
  const pk = chavePrimaria(tabela);
  if (novas.some((l) => l[pk] === undefined)) return; // projeção parcial: não cacheia
  const atual = lerLinhas(tabela);
  const mapa = new Map(atual.map((l) => [String(l[pk]), l]));
  for (const l of novas) mapa.set(String(l[pk]), { ...mapa.get(String(l[pk])), ...l });
  gravarLinhas(tabela, [...mapa.values()]);
}

export function aplicarInsercao(tabela: string, linhas: Linha[]) {
  const pk = chavePrimaria(tabela);
  const atual = lerLinhas(tabela);
  const mapa = new Map(atual.map((l) => [String(l[pk]), l]));
  for (const l of linhas) mapa.set(String(l[pk]), { ...mapa.get(String(l[pk])), ...l });
  gravarLinhas(tabela, [...mapa.values()]);
}

export function aplicarAtualizacao(tabela: string, patch: Linha, alvo: (l: Linha) => boolean) {
  const linhas = lerLinhas(tabela).map((l) => (alvo(l) ? { ...l, ...patch } : l));
  gravarLinhas(tabela, linhas);
  return linhas.filter(alvo);
}

export function aplicarRemocao(tabela: string, alvo: (l: Linha) => boolean) {
  const linhas = lerLinhas(tabela);
  gravarLinhas(
    tabela,
    linhas.filter((l) => !alvo(l)),
  );
  return linhas.filter(alvo);
}

/* ----------------------------------- fila --------------------------------- */

export function lerFila(): Operacao[] {
  return ler<Operacao[]>(FILA, []);
}

export function gravarFila(fila: Operacao[]) {
  gravar(FILA, fila);
}

export function pendencias() {
  return lerFila().length;
}

export function enfileirar(op: Omit<Operacao, "id" | "criado_em" | "tentativas">) {
  const fila = lerFila();
  // Idempotência só por chave EXPLÍCITA (ex.: id da operação de finalizar). Não há mais
  // deduplicação por conteúdo: duas ações iguais em momentos diferentes (pausar → retomar →
  // pausar, ou contar 5 → 3 → 5) são operações distintas e nenhuma pode ser descartada.
  if (op.chave && fila.some((o) => o.chave === op.chave)) return;
  fila.push({
    ...op,
    status: "pendente",
    ultimo_erro: null,
    id: crypto.randomUUID(),
    criado_em: agoraLocalISO(),
    tentativas: 0,
  });
  gravarFila(fila);
}

export function removerDaFila(id: string) {
  gravarFila(lerFila().filter((o) => o.id !== id));
}

export function marcarTentativa(id: string, erro?: string | null) {
  gravarFila(
    lerFila().map((o) =>
      o.id === id
        ? {
            ...o,
            tentativas: o.tentativas + 1,
            status: "erro",
            ultimo_erro: erro ?? o.ultimo_erro ?? null,
            // Espera progressiva (30s, 60s, 120s…) para não entrar em laço.
            proxima_tentativa: new Date(
              Date.now() + Math.min(15, 2 ** o.tentativas) * 30_000,
            ).toISOString(),
          }
        : o,
    ),
  );
}

/** true quando a operação já pode ser tentada novamente. */
export function podeTentar(op: Operacao) {
  if (!op.proxima_tentativa) return true;
  return new Date(op.proxima_tentativa).getTime() <= Date.now();
}

/** Resumo das pendências para diagnóstico/feedback ao usuário. */
export function resumoFila() {
  const fila = lerFila();
  return {
    total: fila.length,
    comErro: fila.filter((o) => o.status === "erro").length,
    tabelas: [...new Set(fila.map((o) => o.tabela))],
  };
}

/* --------------------------------- conflitos ------------------------------- */

const CONFLITOS = "cr:conflitos";

export type Conflito = {
  id: string;
  tabela: string;
  tipo: Operacao["tipo"];
  entidade_id: string | null;
  /** Momento em que a alteração foi feita no aparelho (offline). */
  alterado_offline_em: string;
  /** Momento da última alteração já registrada no servidor. */
  alterado_servidor_em: string | null;
  /** Decisão aplicada: o servidor foi preservado ou o offline prevaleceu. */
  decisao: "servidor_preservado" | "offline_aplicado" | "recusado_pelo_servidor";
  detalhe: string;
  registrado_em: string;
  /** Operação offline completa, preservada para auditoria/reenvio (nada é descartado em silêncio). */
  operacao?: Operacao;
};

export function lerConflitos(): Conflito[] {
  return ler<Conflito[]>(CONFLITOS, []);
}

export function registrarConflito(c: Omit<Conflito, "id" | "registrado_em">) {
  const lista = lerConflitos();
  lista.unshift({ ...c, id: crypto.randomUUID(), registrado_em: agoraLocalISO() });
  // Conflitos com a operação preservada não são cortados pelo limite.
  const comOperacao = lista.filter((x) => x.operacao);
  const semOperacao = lista.filter((x) => !x.operacao).slice(0, 200);
  gravar(CONFLITOS, [...comOperacao, ...semOperacao]);
}

/** Devolve à fila a operação preservada num conflito (decisão explícita do usuário). */
export function reenfileirarConflito(id: string) {
  const c = lerConflitos().find((x) => x.id === id);
  if (!c?.operacao) return false;
  const fila = lerFila();
  fila.push({
    ...c.operacao,
    status: "pendente",
    tentativas: 0,
    proxima_tentativa: null,
    ultimo_erro: null,
  });
  gravarFila(fila);
  gravar(
    CONFLITOS,
    lerConflitos().filter((x) => x.id !== id),
  );
  return true;
}

export function limparConflitos() {
  gravar(CONFLITOS, []);
}

