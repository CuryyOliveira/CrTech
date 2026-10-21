/** Conferência única: filtro hierárquico prateleira → fileira. */
import { describe, expect, it } from "vitest";
import {
  ajustarFiltro,
  descreverFiltro,
  fileirasDasPrateleiras,
  itemNoFiltro,
  resumirLocacoes,
  selecionarItens,
  type FiltroLocacao,
} from "@/lib/conferencia-unica-filtro";
import { partesDaLocacao } from "@/lib/texto";

const item = (codigo: string, locacao: string | null) => ({
  codigo,
  descricao: `Item ${codigo}`,
  locacao,
});

// Lista "ABRASIVOS" do exemplo: P01/P02 com A e B, P03 só B, e itens sem letra/sem prateleira.
const ABRASIVOS = [
  item("P01A01", "P01 - A01"),
  item("P01A02", "P01 − A02"),
  item("P01B01", "P01 - B01"),
  item("P01B07", "P01 - B07"),
  item("P02A01", "P02 - A01"),
  item("P02A02", "P02 – A02"),
  item("P02B01", "P02 - B01"),
  item("P02B02", "P02 - B02"),
  item("P03A01", "P03 - A01"),
  item("P03B01", "P03 - B01"),
  item("P02PAR", "P02 - PAREDE"),
  item("PISO", "PISO EXTERNO"),
];
const codigos = (f: FiltroLocacao) => selecionarItens(ABRASIVOS, f).map((i) => i.codigo);

describe("partesDaLocacao (mesmo parser da fileira)", () => {
  it("P01 - A01, P01 - B07, P02 - B01 e formatos reais", () => {
    expect(partesDaLocacao("P01 - A01")).toEqual({ prateleira: "P01", fileira: "A" });
    expect(partesDaLocacao("P01 - B07")).toEqual({ prateleira: "P01", fileira: "B" });
    expect(partesDaLocacao("P02 - B01")).toEqual({ prateleira: "P02", fileira: "B" });
    expect(partesDaLocacao("P01 − D19")).toEqual({ prateleira: "P01", fileira: "D" });
    expect(partesDaLocacao("P48− B07")).toEqual({ prateleira: "P48", fileira: "B" });
    expect(partesDaLocacao("REC - C05")).toEqual({ prateleira: "REC", fileira: "C" });
    expect(partesDaLocacao("P16 − F8")).toEqual({ prateleira: "P16", fileira: "F" });
  });
  it("sem letra e sem prateleira não ganham valores artificiais", () => {
    expect(partesDaLocacao("P05 - PAREDE")).toEqual({ prateleira: "P05", fileira: null });
    expect(partesDaLocacao("P28")).toEqual({ prateleira: "P28", fileira: null });
    expect(partesDaLocacao("P25 SUP 12")).toEqual({ prateleira: "P25", fileira: null });
    for (const v of ["PISO EXTERNO", "LOCACAO", "", null, undefined]) {
      expect(partesDaLocacao(v), String(v)).toEqual({ prateleira: null, fileira: null });
    }
  });
});

describe("resumo: prateleiras dinâmicas e fileiras dentro de cada uma", () => {
  it("só as prateleiras existentes, em ordem natural (P2 < P10)", () => {
    const r = resumirLocacoes([
      item("1", "P10 - A01"),
      item("2", "P02 - A01"),
      item("3", "P05 - B01"),
      item("4", "P01 - C01"),
      item("5", "P2 - A01"),
    ]);
    expect(r.prateleiras.map((p) => p.prateleira)).toEqual(["P01", "P02", "P2", "P05", "P10"]);
  });
  it("contadores por prateleira e, depois, por fileira só da prateleira escolhida", () => {
    const r = resumirLocacoes(ABRASIVOS);
    expect(r.prateleiras.map((p) => [p.prateleira, p.total])).toEqual([
      ["P01", 4],
      ["P02", 5],
      ["P03", 2],
    ]);
    expect(r.semPrateleira).toBe(1);
    expect(fileirasDasPrateleiras(r, ["P02"])).toEqual({
      fileiras: [
        ["A", 2],
        ["B", 2],
      ],
      semFileira: 1,
    });
    // P03 tem B e A; com P01+P03 somam por letra.
    expect(fileirasDasPrateleiras(r, ["P01", "P03"]).fileiras).toEqual([
      ["A", 3],
      ["B", 3],
    ]);
    // Letras de outras prateleiras não aparecem.
    const outro = resumirLocacoes([item("1", "P01 - C01"), item("2", "P02 - A01")]);
    expect(fileirasDasPrateleiras(outro, ["P02"]).fileiras).toEqual([["A", 1]]);
  });
});

describe("selecionarItens: prateleira + fileira", () => {
  it("1. uma prateleira + uma fileira: P02 + B só traz P02/B (nunca P01/B ou P03/B)", () => {
    const r = codigos({ prateleiras: ["P02"], fileiras: ["B"] });
    expect(r).toEqual(["P02B01", "P02B02"]);
    expect(r.some((c) => c.startsWith("P01") || c.startsWith("P03"))).toBe(false);
  });
  it("2. uma prateleira + várias fileiras", () => {
    expect(codigos({ prateleiras: ["P02"], fileiras: ["A", "B"] })).toEqual([
      "P02A01",
      "P02A02",
      "P02B01",
      "P02B02",
    ]);
  });
  it("3/13. várias prateleiras + uma fileira (mesma letra em duas prateleiras)", () => {
    expect(codigos({ prateleiras: ["P01", "P02"], fileiras: ["B"] })).toEqual([
      "P01B01",
      "P01B07",
      "P02B01",
      "P02B02",
    ]);
  });
  it("4. várias prateleiras + várias fileiras", () => {
    expect(codigos({ prateleiras: ["P01", "P02"], fileiras: ["A", "B"] })).toEqual([
      "P01A01",
      "P01A02",
      "P01B01",
      "P01B07",
      "P02A01",
      "P02A02",
      "P02B01",
      "P02B02",
    ]);
  });
  it("5. somente prateleira: toda a prateleira, inclusive item sem letra", () => {
    expect(codigos({ prateleiras: ["P02"], fileiras: [] })).toEqual([
      "P02A01",
      "P02A02",
      "P02B01",
      "P02B02",
      "P02PAR",
    ]);
  });
  it("6. nenhum filtro: todos os itens (comportamento anterior)", () => {
    expect(codigos({ prateleiras: [], fileiras: [] })).toHaveLength(ABRASIVOS.length);
  });
  it("7. prateleira inexistente: nada", () => {
    expect(codigos({ prateleiras: ["P99"], fileiras: [] })).toEqual([]);
  });
  it("8. fileira inexistente dentro da prateleira: nada (B de outra prateleira não vale)", () => {
    expect(codigos({ prateleiras: ["P02"], fileiras: ["C"] })).toEqual([]);
    const soP03comB = [item("x", "P01 - C01"), item("y", "P03 - B01")];
    expect(selecionarItens(soP03comB, { prateleiras: ["P01"], fileiras: ["B"] })).toEqual([]);
  });
  it("9. item sem letra nunca entra numa combinação prateleira + fileira", () => {
    expect(itemNoFiltro("P02 - PAREDE", { prateleiras: ["P02"], fileiras: ["B"] })).toBe(false);
    expect(itemNoFiltro("P02 - PAREDE", { prateleiras: ["P02"], fileiras: [] })).toBe(true);
    expect(itemNoFiltro("PISO EXTERNO", { prateleiras: ["P02"], fileiras: [] })).toBe(false);
    expect(itemNoFiltro("PISO EXTERNO", { prateleiras: [], fileiras: [] })).toBe(true);
  });
  it("fileira sem prateleira não filtra globalmente (letra só vale dentro da prateleira)", () => {
    expect(codigos({ prateleiras: [], fileiras: ["B"] })).toHaveLength(ABRASIVOS.length);
  });
  it("código repetido entre listas entra uma vez (como antes)", () => {
    const dup = [item("X1", "P02 - B01"), { ...item("x1 ", "P02 - B05") }];
    expect(selecionarItens(dup, { prateleiras: ["P02"], fileiras: ["B"] })).toHaveLength(1);
  });
  it("15. listas com mais de 1.000 itens: o filtro vale para todos", () => {
    const muitos = Array.from({ length: 2600 }, (_, i) =>
      item(`C${i}`, `P0${(i % 3) + 1} - ${i % 2 ? "B" : "A"}${(i % 40) + 1}`),
    );
    const r = selecionarItens(muitos, { prateleiras: ["P02"], fileiras: ["B"] });
    expect(r.length).toBe(muitos.filter((_, i) => i % 3 === 1 && i % 2 === 1).length);
    expect(r.length).toBeGreaterThan(400);
    expect(r.every((m) => m.locacao!.startsWith("P02 - B"))).toBe(true);
  });
});

describe("ajustarFiltro: seleção sempre válida", () => {
  const r = resumirLocacoes(ABRASIVOS);
  it("remove prateleiras que não existem e letras fora das prateleiras marcadas", () => {
    expect(ajustarFiltro(r, { prateleiras: ["P99", "P02"], fileiras: ["B", "Z"] })).toEqual({
      prateleiras: ["P02"],
      fileiras: ["B"],
    });
  });
  it("sem prateleira, nenhuma fileira vale; ordena naturalmente", () => {
    expect(ajustarFiltro(r, { prateleiras: [], fileiras: ["B"] })).toEqual({
      prateleiras: [],
      fileiras: [],
    });
    expect(ajustarFiltro(r, { prateleiras: ["P03", "P01"], fileiras: ["B", "A"] })).toEqual({
      prateleiras: ["P01", "P03"],
      fileiras: ["A", "B"],
    });
  });
});

describe("18. texto das observações/auditoria", () => {
  it("prateleira + fileira, múltiplas, só prateleira e sem filtro", () => {
    expect(descreverFiltro({ prateleiras: ["P02"], fileiras: ["B"] })).toBe(
      "Prateleiras: P02 | Fileiras: B",
    );
    expect(descreverFiltro({ prateleiras: ["P01", "P02"], fileiras: ["B"] })).toBe(
      "Prateleiras: P01, P02 | Fileiras: B",
    );
    expect(descreverFiltro({ prateleiras: ["P02"], fileiras: [] })).toBe("Prateleiras: P02");
    expect(descreverFiltro({ prateleiras: [], fileiras: [] })).toBeNull();
  });
});
