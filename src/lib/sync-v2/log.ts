/**
 * Registro de operações de sincronização (observabilidade) SEM dados sensíveis:
 * nunca grava senha, token, segredo, assinatura ou imagem.
 */

const CHAVES_PROIBIDAS =
  /senha|password|passwd|token|secret|segredo|authorization|apikey|api_key|cookie|assinatura|imagem|arquivo|blob/i;
const PARECE_JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const PARECE_DATA_URL = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

export function sanitizar(valor: unknown, profundidade = 0): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") {
    const limpo = valor
      .replace(PARECE_JWT, "[token removido]")
      .replace(PARECE_DATA_URL, "[imagem removida]");
    return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
  }
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (profundidade > 4) return "[…]";
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => sanitizar(v, profundidade + 1));
  if (typeof Blob !== "undefined" && valor instanceof Blob) return `[arquivo ${valor.size} bytes]`;
  if (valor instanceof Error)
    return { nome: valor.name, mensagem: sanitizar(valor.message, profundidade + 1) };
  if (typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CHAVES_PROIBIDAS.test(k) ? "[removido]" : sanitizar(v, profundidade + 1);
    }
    return saida;
  }
  return String(valor);
}

export type RegistroLog = {
  n?: number;
  em: string;
  nivel: "info" | "aviso" | "erro";
  acao: string;
  dados: unknown;
};

export const LIMITE_LOGS = 1000;
