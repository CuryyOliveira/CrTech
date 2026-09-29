/**
 * Acesso ao banco com suporte offline.
 *
 * Online: delega 100% para o Supabase (mesmo comportamento de antes) e guarda
 * os registros lidos no cache local. Offline: lê do cache e grava as alterações
 * na fila local, que é sincronizada automaticamente quando a conexão retorna.
 * Os identificadores são gerados no cliente, o que torna a sincronização
 * idempotente (upsert por chave primária) e evita conferências duplicadas.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  aplicarAtualizacao,
  aplicarInsercao,
  aplicarRemocao,
  chavePrimaria,
  enfileirar,
  guardarLinhas,
  lerLinhas,
  type Filtro,
  type Linha,
} from "./fila";
import { erroDeRede, estaOffline, marcarQueda } from "./estado";
import { hidratarOffline, offlinePronto } from "./idb";
import { acessoMemorizado } from "./contexto";
import { sessaoOffline } from "./cofre";
import { avisarSalvoOffline } from "./aviso";
import { agoraLocalISO } from "@/lib/datas";

/**
 * Escopo gravado em cada operação da fila: garante que a pendência pertence a
 * uma empresa/usuário conhecidos e permite auditoria da sincronização.
 */
function escopo(linhas: Linha[] = []) {
  const ctx = acessoMemorizado();
  const local = sessaoOffline();
  const primeira = linhas[0] ?? {};
  return {
    empresa_id: (primeira['empresa_id'] as string | undefined) ?? ctx?.empresaId ?? null,
    modulo_id: (primeira['modulo_id'] as string | undefined) ?? null,
    usuario_id: ctx?.userId ?? local?.userId ?? null,
  };
}

type Etapa = { m: string; args: unknown[] };

const sb = supabase as unknown as { from: (t: string) => any };

const ESCRITAS = ["insert", "update", "upsert", "delete"];

function texto(v: unknown) {
  return String(v ?? "").toLowerCase();
}

function combina(padrao: string, valor: unknown) {
  const re = new RegExp(`^${padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
  return re.test(String(valor ?? ""));
}

function filtroOr(expr: string) {
  const partes = expr.split(",");
  return (l: Linha) =>
    partes.some((p) => {
      const [coluna, op, ...resto] = p.split(".");
      const alvo = resto.join(".");
      if (!coluna || !op) return false;
      if (op === "ilike" || op === "like") return combina(alvo, l[coluna]);
      if (op === "eq") return texto(l[coluna]) === texto(alvo);
      if (op === "is") return alvo === "null" ? l[coluna] == null : l[coluna] === (alvo === "true");
      return false;
    });
}

function predicado(etapas: Etapa[]) {
  const testes: ((l: Linha) => boolean)[] = [];
  for (const { m, args } of etapas) {
    const [a, b] = args as [string, unknown];
    if (m === "eq") testes.push((l) => String(l[a] ?? "") === String(b ?? ""));
    else if (m === "neq") testes.push((l) => String(l[a] ?? "") !== String(b ?? ""));
    else if (m === "is") testes.push((l) => (b === null ? l[a] == null : l[a] === b));
    else if (m === "in") testes.push((l) => (b as unknown[]).map(String).includes(String(l[a])));
    else if (m === "ilike" || m === "like") testes.push((l) => combina(String(b), l[a]));
    else if (m === "gte") testes.push((l) => String(l[a] ?? "") >= String(b ?? ""));
    else if (m === "lte") testes.push((l) => String(l[a] ?? "") <= String(b ?? ""));
    else if (m === "gt") testes.push((l) => String(l[a] ?? "") > String(b ?? ""));
    else if (m === "lt") testes.push((l) => String(l[a] ?? "") < String(b ?? ""));
    else if (m === "or") testes.push(filtroOr(String(a)));
    else if (m === "match")
      testes.push((l) =>
        Object.entries(a as unknown as Linha).every(([c, v]) => String(l[c] ?? "") === String(v ?? "")),
      );
  }
  return (l: Linha) => testes.every((t) => t(l));
}

function filtrosSimples(etapas: Etapa[]): Filtro[] {
  return etapas
    .filter((e) => e.m === "eq")
    .map((e) => ({ coluna: String(e.args[0]), valor: e.args[1] }));
}

/**
 * Valores que o banco preenche sozinho quando há internet. Offline eles são
 * aplicados aqui para a tela reagir igual (ex.: conferência já em andamento).
 */
const PADROES: Record<string, Linha> = {
  conferencias: {
    status: "em_andamento",
    total_tempo_pausado: 0,
    quantidade_pausas: 0,
    tipo: "caminhao",
  },
  conferencia_itens: { status: "pendente", fotos: [], origem: "lista", quantidade_esperada: 0 },
  historico_conferencias: {
    status: "em_andamento",
    detalhes: {},
    divergencias: 0,
    percentual: 0,
    quantidade_conferida: 0,
    quantidade_prevista: 0,
    quantidade_pausas: 0,
    total_tempo_pausado: 0,
  },
  materiais: { descricao: "", quantidade_esperada: 0 },
  unidades: { ativo: true, tipo: "caminhao" },
};

/** Colunas realmente existentes na tabela, deduzidas dos dados já baixados. */
function colunasConhecidas(tabela: string): Set<string> | null {
  const amostra = lerLinhas(tabela).slice(0, 20);
  if (!amostra.length) return null;
  const cols = new Set<string>();
  for (const l of amostra) for (const c of Object.keys(l)) cols.add(c);
  return cols;
}

function normalizarInsercao(tabela: string, payload: unknown): Linha[] {
  const pk = chavePrimaria(tabela);
  const agora = agoraLocalISO();
  const padrao = PADROES[tabela] ?? {};
  const cols = colunasConhecidas(tabela);
  const tem = (c: string) => !cols || cols.has(c);
  const lista = Array.isArray(payload) ? payload : [payload];
  return (lista as Linha[]).map((l) => {
    const linha: Linha = {
      ...(pk === "id" && !l['id'] ? { id: crypto.randomUUID() } : {}),
      ...l,
    };
    // Preenche apenas colunas que existem na tabela, evitando erro ao sincronizar.
    for (const [c, v] of Object.entries(padrao)) {
      if (tem(c) && linha[c] == null) linha[c] = v;
    }
    for (const c of ["created_at", "updated_at"]) {
      if (tem(c) && linha[c] == null) linha[c] = agora;
    }
    return linha;
  });
}

class Consulta implements PromiseLike<{ data: unknown; error: unknown }> {
  private etapas: Etapa[] = [];

  constructor(private tabela: string) {}

  private add(m: string, args: unknown[]) {
    this.etapas.push({ m, args });
    return this;
  }

  select(...a: unknown[]) { return this.add("select", a); }
  insert(...a: unknown[]) { return this.add("insert", a); }
  upsert(...a: unknown[]) { return this.add("upsert", a); }
  update(...a: unknown[]) { return this.add("update", a); }
  delete(...a: unknown[]) { return this.add("delete", a); }
  eq(...a: unknown[]) { return this.add("eq", a); }
  neq(...a: unknown[]) { return this.add("neq", a); }
  is(...a: unknown[]) { return this.add("is", a); }
  in(...a: unknown[]) { return this.add("in", a); }
  or(...a: unknown[]) { return this.add("or", a); }
  ilike(...a: unknown[]) { return this.add("ilike", a); }
  like(...a: unknown[]) { return this.add("like", a); }
  match(...a: unknown[]) { return this.add("match", a); }
  gte(...a: unknown[]) { return this.add("gte", a); }
  lte(...a: unknown[]) { return this.add("lte", a); }
  gt(...a: unknown[]) { return this.add("gt", a); }
  lt(...a: unknown[]) { return this.add("lt", a); }
  not(...a: unknown[]) { return this.add("not", a); }
  order(...a: unknown[]) { return this.add("order", a); }
  limit(...a: unknown[]) { return this.add("limit", a); }
  range(...a: unknown[]) { return this.add("range", a); }
  single() { return this.add("single", []); }
  maybeSingle() { return this.add("maybeSingle", []); }

  private tipoEscrita() {
    return this.etapas.find((e) => ESCRITAS.includes(e.m));
  }

  private async remoto() {
    let q: any = sb.from(this.tabela);
    for (const { m, args } of this.etapas) q = q[m](...args);
    const res = await q;
    // O cliente do banco devolve falhas de rede como erro (não lança exceção):
    // nesse caso a operação segue pelo caminho local/fila, sem perder o dado.
    if (res.error && erroDeRede(res.error)) {
      marcarQueda();
      return this.local();
    }
    if (!res.error && !this.tipoEscrita()) {
      const dados = res.data;
      if (Array.isArray(dados)) guardarLinhas(this.tabela, dados as Linha[]);
      else if (dados) guardarLinhas(this.tabela, [dados as Linha]);
    }
    return res as { data: unknown; error: unknown };
  }

  private local() {
    const escrita = this.tipoEscrita();
    const querSelect = this.etapas.some((e) => e.m === "select");
    const unico = this.etapas.some((e) => e.m === "single" || e.m === "maybeSingle");
    const pk = chavePrimaria(this.tabela);
    const filtros = filtrosSimples(this.etapas);
    const alvo = predicado(this.etapas);

    if (!escrita) {
      let linhas = lerLinhas(this.tabela).filter(alvo);
      for (const { m, args } of this.etapas) {
        if (m === "order") {
          const col = String(args[0]);
          const asc = ((args[1] as { ascending?: boolean } | undefined)?.ascending ?? true) !== false;
          linhas = [...linhas].sort((x, y) =>
            String(x[col] ?? "").localeCompare(String(y[col] ?? ""), "pt-BR", { numeric: true }) *
            (asc ? 1 : -1),
          );
        }
        if (m === "limit") linhas = linhas.slice(0, Number(args[0]));
        if (m === "range") linhas = linhas.slice(Number(args[0]), Number(args[1]) + 1);
      }
      if (unico) return { data: linhas[0] ?? null, error: null, count: linhas.length };
      return { data: linhas, error: null, count: linhas.length };
    }

    if (escrita.m === "insert" || escrita.m === "upsert") {
      const linhas = normalizarInsercao(this.tabela, escrita.args[0]);
      aplicarInsercao(this.tabela, linhas);
      enfileirar({
        tabela: this.tabela,
        tipo: "upsert",
        payload: linhas,
        filtros: [],
        entidade_id: (linhas[0]?.[pk] as string | undefined) ?? null,
        ...escopo(linhas),
      });
      avisarSalvoOffline();
      const data = querSelect ? (unico ? (linhas[0] ?? null) : linhas) : null;
      return { data, error: null, count: linhas.length };
    }

    if (escrita.m === "update") {
      const patch = escrita.args[0] as Linha;
      const afetadas = aplicarAtualizacao(this.tabela, patch, alvo);
      // Sincroniza por chave primária quando possível: evita conflito de filtros.
      for (const l of afetadas)
        enfileirar({
          tabela: this.tabela,
          tipo: "update",
          payload: patch,
          filtros: l[pk] !== undefined ? [{ coluna: pk, valor: l[pk] }] : filtros,
          entidade_id: (l[pk] as string | undefined) ?? null,
          ...escopo([l, patch]),
        });
      if (!afetadas.length && filtros.length)
        enfileirar({
          tabela: this.tabela,
          tipo: "update",
          payload: patch,
          filtros,
          ...escopo([patch]),
        });
      avisarSalvoOffline();
      const data = querSelect ? (unico ? (afetadas[0] ?? null) : afetadas) : null;
      return { data, error: null, count: afetadas.length };
    }

    const removidas = aplicarRemocao(this.tabela, alvo);
    for (const l of removidas)
      enfileirar({
        tabela: this.tabela,
        tipo: "delete",
        payload: null,
        filtros: l[pk] !== undefined ? [{ coluna: pk, valor: l[pk] }] : filtros,
        entidade_id: (l[pk] as string | undefined) ?? null,
        ...escopo([l]),
      });
    if (!removidas.length && filtros.length)
      enfileirar({ tabela: this.tabela, tipo: "delete", payload: null, filtros, ...escopo() });
    avisarSalvoOffline();
    return { data: querSelect ? removidas : null, error: null, count: removidas.length };
  }

  /**
   * Gera no aparelho o id das linhas inseridas ANTES de tentar o servidor. Se o servidor
   * demorar (timeout de 10s) e a gravação seguir pela fila local, a fila reenvia a MESMA
   * linha (upsert pelo mesmo id) em vez de criar uma segunda.
   */
  private prepararIds() {
    const pk = chavePrimaria(this.tabela);
    if (pk !== "id") return;
    for (const e of this.etapas) {
      if (e.m !== "insert") continue; // upsert pode ter outra chave de conflito: não mexer
      const comId = (l: unknown) =>
        l && typeof l === "object" && !(l as Linha).id
          ? { id: crypto.randomUUID(), ...(l as Linha) }
          : l;
      const dados = e.args[0];
      e.args = [Array.isArray(dados) ? dados.map(comId) : comId(dados), ...e.args.slice(1)];
    }
  }

  private async executar() {
    this.prepararIds();
    // Garante que o cache local (IndexedDB) esteja carregado antes de ler/gravar.
    if (!offlinePronto()) await hidratarOffline();
    if (estaOffline()) return this.local();
    try {
      // Conexão instável: se o servidor não responder em 10s, o aplicativo
      // assume o modo offline em vez de deixar a tela travada.
      const espera = new Promise<null>((r) => setTimeout(() => r(null), 10_000));
      const res = await Promise.race([this.remoto(), espera]);
      if (res) return res;
      marcarQueda();
      return this.local();
    } catch (e) {
      if (!erroDeRede(e)) throw e;
      marcarQueda();
      return this.local();
    }
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    ok?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    erro?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executar().then(ok as never, erro as never);
  }
}

/** Ponto único de acesso às tabelas, com suporte offline transparente. */
export const dbOffline = {
  from: (tabela: string) => new Consulta(tabela) as any,
};
