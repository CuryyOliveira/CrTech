/**
 * Fonte única de data/hora do aplicativo.
 * Regra: o instante é sempre gravado como timestamp completo (com fuso) e a
 * DATA do dia é sempre calculada no fuso local da operação (America/Sao_Paulo),
 * nunca em UTC — assim uma conferência iniciada às 21h não cai no dia seguinte
 * (nem no anterior) por causa da conversão.
 */
export const FUSO_OPERACAO = "America/Sao_Paulo";

/** Data do dia (YYYY-MM-DD) no fuso da operação. */
export function dataLocalISO(quando: Date | string | number = new Date()) {
  const d = quando instanceof Date ? quando : new Date(quando);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_OPERACAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Hora local (HH:mm) no fuso da operação. */
export function horaLocal(quando: Date | string | number = new Date()) {
  const d = quando instanceof Date ? quando : new Date(quando);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_OPERACAO,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Instante exato do dispositivo, preservando o deslocamento local
 * (ex.: 2026-08-04T21:18:05-03:00). Sincronização e servidor recebem o mesmo
 * instante sem recalcular o dia.
 */
export function agoraLocalISO(quando: Date = new Date()) {
  const off = -quando.getTimezoneOffset();
  const sinal = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return (
    `${quando.getFullYear()}-${p(quando.getMonth() + 1)}-${p(quando.getDate())}` +
    `T${p(quando.getHours())}:${p(quando.getMinutes())}:${p(quando.getSeconds())}` +
    `${sinal}${p(off / 60)}:${p(off % 60)}`
  );
}

/** Exibição padrão: dd/MM/yyyy HH:mm no fuso da operação. */
export function fmtDataHoraLocal(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return `${dataLocalISO(d).split("-").reverse().join("/")} ${horaLocal(d)}`;
}
