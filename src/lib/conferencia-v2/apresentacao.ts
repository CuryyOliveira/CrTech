/**
 * Regras de APRESENTAÇÃO da conferência V2 (busca, filtros, progresso, status visual,
 * navegação). Funções puras, sem regra de negócio: contagem, pausa, conflito e sincronização
 * continuam exclusivamente no motor V2 (src/lib/sync-v2).
 */
import type { ItemFila, ItemLocal } from "@/lib/sync-v2/tipos";
import { normalize, ordenarPorLocacao } from "@/lib/texto";

export type StatusVisual = "pendente" | "conferido" | "divergencia" | "erro" | "conflito";
export type Filtro =
  "todos" | "pendentes" | "conferidos" | "divergencias" | "adicionados" | "conflitos";

/** Problema de sincronização de um item (vindo da fila do motor). */
export type ProblemaItem = { status: "CONFLICT" | "NEEDS_ATTENTION"; evento: ItemFila };

export const ROTULO_STATUS: Record<StatusVisual, string> = {
  pendente: "PENDENTE",
  conferido: "CONFERIDO",
  divergencia: "DIVERGÊNCIA",
  erro: "COM ERRO",
  conflito: "CONFLITO",
};

export const ROTULO_FILTRO: Record<Filtro, string> = {
  todos: "Todos",
  pendentes: "Pendentes",
  conferidos: "Conferidos",
  divergencias: "Divergências",
  adicionados: "Adicionados",
  conflitos: "Conflitos",
};

export function statusVisual(item: ItemLocal, problema?: ProblemaItem): StatusVisual {
  if (problema?.status === "CONFLICT") return "conflito";
  if (problema?.status === "NEEDS_ATTENTION") return "erro";
  return item.status;
}

export const foiAdicionado = (item: Pick<ItemLocal, "origem">) => item.origem === "adicionado";

/** Mapa item (chave k) → problema mais grave na fila (conflito vence erro). */
export function problemasPorItem(fila: ItemFila[]) {
  const mapa = new Map<string, ProblemaItem>();
  for (const f of fila) {
    if (!f.alvo_k || (f.status !== "CONFLICT" && f.status !== "NEEDS_ATTENTION")) continue;
    const atual = mapa.get(f.alvo_k);
    if (!atual || (atual.status === "NEEDS_ATTENTION" && f.status === "CONFLICT")) {
      mapa.set(f.alvo_k, { status: f.status, evento: f });
    }
  }
  return mapa;
}

export type Resumo = {
  total: number;
  conferidos: number;
  divergencias: number;
  pendentes: number;
  adicionados: number;
  comProblema: number;
  /** Itens com contagem (conferidos + divergências). */
  feitos: number;
  pct: number;
};

export function resumir(itens: ItemLocal[], problemas: Map<string, ProblemaItem>): Resumo {
  let conferidos = 0;
  let divergencias = 0;
  let adicionados = 0;
  let comProblema = 0;
  for (const i of itens) {
    if (i.status === "conferido") conferidos++;
    else if (i.status === "divergencia") divergencias++;
    if (foiAdicionado(i)) adicionados++;
    if (problemas.has(i.k)) comProblema++;
  }
  const feitos = conferidos + divergencias;
  const total = itens.length;
  return {
    total,
    conferidos,
    divergencias,
    pendentes: total - feitos,
    adicionados,
    comProblema,
    feitos,
    pct: total ? Math.round((feitos / total) * 100) : 0,
  };
}

/** Normaliza para busca de código: sem acento, minúsculo, sem espaços/separadores. */
export function chaveBusca(s: unknown) {
  return normalize(s).replace(/[\s\-_./]+/g, "");
}

/**
 * Busca local por código (inclusive parcial), descrição e localização. Ordem de relevância:
 * código exato → código que começa com o termo → código contém → descrição/localização.
 */
export function buscar(itens: ItemLocal[], termo: string) {
  const t = normalize(termo);
  if (!t) return itens;
  const tc = chaveBusca(termo);
  const palavras = t.split(/\s+/).filter(Boolean);
  const pontuados: { item: ItemLocal; p: number; ordem: number }[] = [];
  itens.forEach((item, ordem) => {
    const codigo = chaveBusca(item.codigo);
    let p = 0;
    if (tc && codigo === tc) p = 4;
    else if (tc && codigo.startsWith(tc)) p = 3;
    else if (tc && codigo.includes(tc)) p = 2;
    else {
      const texto = `${normalize(item.descricao)} ${normalize(item.locacao)} ${normalize(item.codigo)}`;
      if (palavras.every((w) => texto.includes(w))) p = 1;
    }
    if (p > 0) pontuados.push({ item, p, ordem });
  });
  return pontuados.sort((a, b) => b.p - a.p || a.ordem - b.ordem).map((x) => x.item);
}

/** Item cujo código é exatamente o lido (leitor de código de barras / QR: Enter). */
export function codigoExato(itens: ItemLocal[], termo: string) {
  const tc = chaveBusca(termo);
  if (!tc) return null;
  return itens.find((i) => chaveBusca(i.codigo) === tc) ?? null;
}

export function aplicarFiltro(
  itens: ItemLocal[],
  filtro: Filtro,
  problemas: Map<string, ProblemaItem>,
) {
  switch (filtro) {
    case "todos":
      return itens;
    case "pendentes":
      return itens.filter((i) => i.status === "pendente");
    case "conferidos":
      return itens.filter((i) => i.status === "conferido");
    case "divergencias":
      return itens.filter((i) => i.status === "divergencia");
    case "adicionados":
      return itens.filter(foiAdicionado);
    case "conflitos":
      return itens.filter((i) => problemas.has(i.k));
  }
}

export function contarPorFiltro(itens: ItemLocal[], problemas: Map<string, ProblemaItem>) {
  const r = resumir(itens, problemas);
  return {
    todos: r.total,
    pendentes: r.pendentes,
    conferidos: r.conferidos,
    divergencias: r.divergencias,
    adicionados: r.adicionados,
    conflitos: r.comProblema,
  } satisfies Record<Filtro, number>;
}

/** Ordem de trabalho: pela localização (caminho físico), depois código. */
export function ordenarItens(itens: ItemLocal[]) {
  return ordenarPorLocacao(itens);
}

/** Chave do item vizinho na lista visível (anterior = -1, próximo = +1). */
export function vizinho(lista: { k: string }[], k: string | null, passo: 1 | -1) {
  if (!lista.length) return null;
  const i = k ? lista.findIndex((x) => x.k === k) : -1;
  if (i === -1) return passo === 1 ? lista[0].k : lista[lista.length - 1].k;
  return lista[i + passo]?.k ?? null;
}

/**
 * Depois de confirmar um item, para onde ir: o próximo da lista COMO ELA ESTAVA antes de
 * salvar (no filtro "pendentes" o item salvo some da lista, e não queremos pular ninguém).
 */
export function proximoAposSalvar(listaAntes: { k: string }[], k: string) {
  const i = listaAntes.findIndex((x) => x.k === k);
  if (i === -1) return null;
  return listaAntes[i + 1]?.k ?? null;
}

/** "1,5" → 1.5 · "" → null · inválido → NaN. */
export function lerQuantidade(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

export function formatarQuantidade(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/** Diferença conferido − esperado (positivo = sobra, negativo = falta). */
export function diferenca(esperado: number, conferido: number | null) {
  if (conferido === null || Number.isNaN(conferido)) return null;
  return Math.round((conferido - esperado) * 1000) / 1000;
}

/**
 * Quebra a localização em partes para exibição grande ("A-03-B-12" → ["A", "03", "B", "12"];
 * "CORREDOR 03 PRATELEIRA B" → ["CORREDOR 03", "PRATELEIRA B"]).
 */
export function partesLocalizacao(locacao: string | null | undefined): string[] {
  const t = String(locacao ?? "").trim();
  if (!t) return [];
  if (/[-/|;>]/.test(t)) {
    return t
      .split(/\s*[-/|;>]\s*/)
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
  }
  const rotulada = t.toUpperCase().match(/[A-ZÀ-Ú]+\.?\s*[0-9A-Z]+/g);
  if (rotulada && rotulada.join(" ").replace(/\s+/g, "") === t.toUpperCase().replace(/\s+/g, "")) {
    return rotulada;
  }
  return [t.toUpperCase()];
}

/** Tempo em segundos → "1h 05min" / "12min 30s" / "45s". */
export function formatarDuracao(segundos: number) {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m) return `${m}min ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

/** "1 alteração" / "3 alterações". */
export function plural(n: number, singular: string, pluralTexto: string) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}
