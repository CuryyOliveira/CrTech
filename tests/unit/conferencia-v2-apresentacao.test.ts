/** V2.1 — regras de apresentação da conferência (busca, filtros, progresso, navegação). */
import { describe, expect, it } from "vitest";
import {
  aplicarFiltro,
  buscar,
  codigoExato,
  contarPorFiltro,
  diferenca,
  formatarDuracao,
  formatarQuantidade,
  lerQuantidade,
  ordenarItens,
  partesLocalizacao,
  problemasPorItem,
  proximoAposSalvar,
  resumir,
  statusVisual,
  vizinho,
} from "@/lib/conferencia-v2/apresentacao";
import type { ItemFila, ItemLocal } from "@/lib/sync-v2/tipos";

function item(k: string, dados: Partial<ItemLocal> = {}): ItemLocal {
  return {
    k,
    id: null,
    conferencia_id: "c",
    material_id: k,
    codigo: k.toUpperCase(),
    descricao: `Material ${k}`,
    locacao: null,
    quantidade_esperada: 5,
    quantidade_contada: null,
    status: "pendente",
    observacoes: null,
    origem: "lista",
    motivo_inclusao: null,
    versao: 0,
    servidor: null,
    inicial: null,
    removido_no_servidor: false,
    pendente: false,
    ...dados,
  };
}

function fila(alvo: string, status: ItemFila["status"]): ItemFila {
  return {
    event_id: `${alvo}-${status}`,
    seq: 1,
    conference_id: "c",
    event_type: "ITEM_COUNTED",
    status,
    tentativas: 0,
    falhas_rede: 0,
    created_at: "2026-09-29T10:00:00Z",
    last_attempt_at: null,
    next_attempt_at: null,
    error_code: null,
    error_message: null,
    payload: {},
    alvo_k: alvo,
    resposta: null,
    txid: null,
    refletido: false,
    aguarda_foto: null,
    resolucao: null,
  };
}

const itens = [
  item("p-001", {
    codigo: "P-001",
    descricao: "Parafuso sextavado",
    locacao: "A-01",
    status: "conferido",
  }),
  item("p-002", { codigo: "P-002", descricao: "Porca", locacao: "A-02", status: "divergencia" }),
  item("p-010", { codigo: "P-010", descricao: "Arruela lisa", locacao: "B-01" }),
  item("x-1", {
    codigo: "7891234567890",
    descricao: "Luva",
    locacao: "C-03",
    origem: "adicionado",
    status: "divergencia",
  }),
];

describe("busca local", () => {
  it("código exato vem primeiro, depois parcial; ignora separadores e acentos", () => {
    expect(buscar(itens, "p001").map((i) => i.k)).toEqual(["p-001"]);
    expect(buscar(itens, "P-0").map((i) => i.k)).toEqual(["p-001", "p-002", "p-010"]);
    expect(buscar(itens, "4567").map((i) => i.k)).toEqual(["x-1"]);
    expect(buscar(itens, "arruéla").map((i) => i.k)).toEqual(["p-010"]);
    expect(buscar(itens, "b-01").map((i) => i.k)).toEqual(["p-010"]);
    expect(buscar(itens, "")).toBe(itens);
  });

  it("leitor de código (Enter) encontra o item exato", () => {
    expect(codigoExato(itens, "7891234567890")?.k).toBe("x-1");
    expect(codigoExato(itens, " p 001 ")?.k).toBe("p-001");
    expect(codigoExato(itens, "P-0")).toBeNull();
  });
});

describe("filtros, progresso e status", () => {
  const problemas = problemasPorItem([
    fila("p-010", "NEEDS_ATTENTION"),
    fila("p-010", "CONFLICT"),
    fila("p-001", "SYNCED"),
  ]);

  it("conflito vence erro; eventos confirmados não são problema", () => {
    expect(problemas.get("p-010")?.status).toBe("CONFLICT");
    expect(problemas.has("p-001")).toBe(false);
    expect(statusVisual(itens[2], problemas.get("p-010"))).toBe("conflito");
    expect(statusVisual(itens[1])).toBe("divergencia");
  });

  it("filtros locais", () => {
    expect(aplicarFiltro(itens, "pendentes", problemas).map((i) => i.k)).toEqual(["p-010"]);
    expect(aplicarFiltro(itens, "divergencias", problemas).map((i) => i.k)).toEqual([
      "p-002",
      "x-1",
    ]);
    expect(aplicarFiltro(itens, "adicionados", problemas).map((i) => i.k)).toEqual(["x-1"]);
    expect(aplicarFiltro(itens, "conflitos", problemas).map((i) => i.k)).toEqual(["p-010"]);
    expect(contarPorFiltro(itens, problemas)).toEqual({
      todos: 4,
      pendentes: 1,
      conferidos: 1,
      divergencias: 2,
      adicionados: 1,
      conflitos: 1,
    });
  });

  it("progresso", () => {
    expect(resumir(itens, problemas)).toMatchObject({ total: 4, feitos: 3, pendentes: 1, pct: 75 });
  });
});

describe("navegação", () => {
  const lista = ordenarItens([...itens].reverse());
  it("ordena pela localização", () => {
    expect(lista.map((i) => i.locacao)).toEqual(["A-01", "A-02", "B-01", "C-03"]);
  });
  it("anterior/próximo", () => {
    expect(vizinho(lista, "p-002", 1)).toBe("p-010");
    expect(vizinho(lista, "p-002", -1)).toBe("p-001");
    expect(vizinho(lista, "p-001", -1)).toBeNull();
    expect(vizinho(lista, null, 1)).toBe("p-001");
  });
  it("após salvar vai para o próximo da lista como estava antes (não pula ninguém)", () => {
    const pendentes = [item("a"), item("b"), item("c")];
    expect(proximoAposSalvar(pendentes, "a")).toBe("b");
    expect(proximoAposSalvar(pendentes, "c")).toBeNull();
  });
});

describe("quantidade e localização", () => {
  it("lê quantidades com vírgula; recusa texto", () => {
    expect(lerQuantidade("12")).toBe(12);
    expect(lerQuantidade("1,5")).toBe(1.5);
    expect(lerQuantidade(" ")).toBeNull();
    expect(lerQuantidade("abc")).toBeNaN();
    expect(lerQuantidade("-1")).toBeNaN();
    expect(formatarQuantidade(1.5)).toBe("1,5");
  });
  it("diferença", () => {
    expect(diferenca(10, 7)).toBe(-3);
    expect(diferenca(10, 12.5)).toBe(2.5);
    expect(diferenca(10, null)).toBeNull();
  });
  it("partes da localização", () => {
    expect(partesLocalizacao("A-03-B-12")).toEqual(["A", "03", "B", "12"]);
    expect(partesLocalizacao("Corredor 03 Prateleira B Posição 12")).toEqual([
      "CORREDOR 03",
      "PRATELEIRA B",
      "POSIÇÃO 12",
    ]);
    expect(partesLocalizacao("Depósito")).toEqual(["DEPÓSITO"]);
    expect(partesLocalizacao(null)).toEqual([]);
  });
  it("duração", () => {
    expect(formatarDuracao(3900)).toBe("1h 05min");
    expect(formatarDuracao(750)).toBe("12min 30s");
  });
});
