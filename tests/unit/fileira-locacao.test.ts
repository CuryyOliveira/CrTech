/** Conferência única por fileira (letra da locação). */
import { describe, expect, it } from "vitest";
import { fileiraDaLocacao } from "@/lib/texto";

describe("fileiraDaLocacao", () => {
  it("lê a letra da segunda parte da locação", () => {
    expect(fileiraDaLocacao("P01 − A01")).toBe("A"); // sinal de menos (U+2212), como nas planilhas
    expect(fileiraDaLocacao("P28 - B05")).toBe("B");
    expect(fileiraDaLocacao("P23 – C07")).toBe("C"); // travessão
    expect(fileiraDaLocacao("P32-L21")).toBe("L");
    expect(fileiraDaLocacao("rec - a06")).toBe("A");
  });
  it("sem fileira", () => {
    for (const v of [
      "P28",
      "P50 - PAREDE",
      "PISO EXTERNO",
      "P06 - SUP",
      "LOCACAO",
      "REC -",
      "",
      null,
      undefined,
    ]) {
      expect(fileiraDaLocacao(v), String(v)).toBeNull();
    }
  });
});
