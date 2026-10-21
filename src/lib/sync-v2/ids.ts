/**
 * UUID v4 gerado no aparelho. Usa crypto.randomUUID quando existe; em WebViews antigos
 * (sem randomUUID) monta o v4 com crypto.getRandomValues — mesmo formato e aleatoriedade.
 */
export function novoId(): string {
  const c = (typeof crypto !== "undefined" ? crypto : undefined) as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c!.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
