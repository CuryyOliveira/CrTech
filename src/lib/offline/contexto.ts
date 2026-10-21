/**
 * Memória local do contexto de acesso (empresa, plano, módulos liberados).
 *
 * Sem internet o servidor não pode ser consultado, mas a operação offline
 * precisa saber a QUAL empresa o usuário pertence — é isso que garante o
 * isolamento por `empresa_id`/`modulo_id` no cache local. Guardamos apenas a
 * última resposta autorizada pelo servidor; nada é decidido pelo cliente.
 */
import type { ContextoAcesso } from "@/lib/acesso.functions";

const CHAVE = "cr:acesso";

export function memorizarAcesso(ctx: ContextoAcesso) {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(ctx));
  } catch {
    /* armazenamento indisponível */
  }
}

export function acessoMemorizado(): ContextoAcesso | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as ContextoAcesso) : null;
  } catch {
    return null;
  }
}

/** Empresa do usuário conhecida localmente (isolamento do cache offline). */
export function empresaMemorizada(): string | null {
  return acessoMemorizado()?.empresaId ?? null;
}

export function esquecerAcesso() {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* ignora */
  }
}
