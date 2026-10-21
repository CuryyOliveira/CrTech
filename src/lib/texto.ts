/** Normalização de texto e ordenação natural (sem dependências: usável em qualquer camada). */

export function normalize(s: unknown) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Natural (alphanumeric) comparison: A1 < A2 < A10. */
export function natCompare(a?: string | null, b?: string | null) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x) return y ? 1 : 0;
  if (!y) return -1;
  return x.localeCompare(y, "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Sort items by locação (menor para maior), falling back to código. */
export function ordenarPorLocacao<T extends { locacao?: string | null; codigo?: string | null }>(
  arr: T[],
) {
  return [...arr].sort(
    (a, b) => natCompare(a.locacao, b.locacao) || natCompare(a.codigo, b.codigo),
  );
}

/**
 * Partes de uma locação de prateleira, lidas de uma só vez:
 *  - prateleira: o que vem antes do hífen ("P01 − A01" → "P01", "REC - C05" → "REC"); sem hífen,
 *    só quando começa por P + número ("P28" → "P28", "P25 SUP 12" → "P25");
 *  - fileira: a letra da segunda parte ("P01 − A01" → "A", "P16 − F8" → "F").
 * Aceita hífen comum, "−", "–" ou "—". O que não se encaixa fica null (ex.: "P50 - PAREDE" →
 * prateleira P50, sem fileira; "PISO EXTERNO" → sem prateleira e sem fileira).
 */
export function partesDaLocacao(locacao?: string | null): {
  prateleira: string | null;
  fileira: string | null;
} {
  const texto = String(locacao ?? "")
    .toUpperCase()
    .trim();
  const partes = texto.split(/\s*[-−–—]\s*/);
  if (partes.length < 2) {
    const m = /^(P\d+)\b/.exec(texto);
    return { prateleira: m ? m[1] : null, fileira: null };
  }
  const m = /^([A-Z])\s*\d+$/.exec(partes[1].trim());
  return { prateleira: partes[0].trim() || null, fileira: m ? m[1] : null };
}

/**
 * Fileira (letra) de uma locação de prateleira: "P01 − A01" → "A", "P28 - B05" → "B".
 * Locações sem fileira ("P28", "P50 - PAREDE", "PISO EXTERNO") → null.
 */
export function fileiraDaLocacao(locacao?: string | null): string | null {
  return partesDaLocacao(locacao).fileira;
}
