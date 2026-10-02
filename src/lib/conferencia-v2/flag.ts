/**
 * Feature flags da V2.
 *  - VITE_CONFERENCE_V2=1 → tela nova de conferência (usa o motor V2; liga o motor sozinha).
 *  - VITE_SYNC_V2=1       → só o motor/indicador V2 (sem trocar a tela).
 * Desligadas (padrão), a V1 continua exatamente como antes.
 */
const env = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as
  Record<string, string | undefined> | undefined;

export const CONFERENCIA_V2_ATIVA = env?.VITE_CONFERENCE_V2 === "1";
export const MOTOR_V2_ATIVO = CONFERENCIA_V2_ATIVA || env?.VITE_SYNC_V2 === "1";
