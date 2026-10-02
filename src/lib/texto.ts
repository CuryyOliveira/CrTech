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
 * Fileira (letra) de uma locação de prateleira: "P01 − A01" → "A", "P28 - B05" → "B".
 * Aceita hífen comum, "−", "–" ou "—". Locações sem fileira ("P28", "P50 - PAREDE",
 * "PISO EXTERNO") → null.
 */
export function fileiraDaLocacao(locacao?: string | null): string | null {
  const partes = String(locacao ?? "")
    .toUpperCase()
    .split(/\s*[-−–—]\s*/);
  if (partes.length < 2) return null;
  const m = /^([A-Z])\s*\d+$/.exec(partes[1].trim());
  return m ? m[1] : null;
}
