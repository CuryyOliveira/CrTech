/**
 * Ponto de entrada do motor V2 no app: uma instância por usuário logado.
 *
 * Ligado apenas quando VITE_SYNC_V2=1 (até a V2.1 trocar as telas de conferência, a V1
 * continua usando o motor antigo em src/lib/offline). Nenhum token é guardado pelo motor:
 * a autenticação das chamadas é a do cliente do Supabase.
 */
import { supabase } from "@/integrations/supabase/client";
import { MotorSync, type Resumo } from "./motor";
import { novoId } from "./ids";
import { TransporteSupabase } from "./transporte";

export { MotorSync } from "./motor";
export type { Resumo, ResultadoSync } from "./motor";

export const SYNC_V2_ATIVO =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.VITE_SYNC_V2 as string | undefined) === "1";

const CHAVE_APARELHO = "cr:aparelho-id";

/** Identificador do aparelho (não é segredo): gerado uma vez e mantido. */
export function idDoAparelho() {
  try {
    let id = localStorage.getItem(CHAVE_APARELHO);
    if (!id) {
      id = novoId();
      localStorage.setItem(CHAVE_APARELHO, id);
    }
    return id;
  } catch {
    return "sem-armazenamento";
  }
}

let atual: Promise<MotorSync> | null = null;
let usuarioAtual: string | null = null;
const ouvintesMotor = new Set<(m: MotorSync | null) => void>();

/** Abre (ou reaproveita) o motor do usuário. Trocar de usuário fecha o motor anterior. */
export async function motorDoUsuario(userId: string, empresaId: string | null) {
  if (atual && usuarioAtual === userId) return atual;
  if (atual) await encerrarMotor({ apagarDados: false });
  usuarioAtual = userId;
  atual = MotorSync.abrir(
    { userId, empresaId, deviceId: idDoAparelho() },
    new TransporteSupabase(supabase as never),
    { automatico: true },
  );
  const m = await atual;
  for (const fn of ouvintesMotor) fn(m);
  return m;
}

export function aoTrocarMotor(fn: (m: MotorSync | null) => void) {
  ouvintesMotor.add(fn);
  if (atual) void atual.then(fn);
  return () => {
    ouvintesMotor.delete(fn);
  };
}

/**
 * Logout: fecha o motor. Com `apagarDados`, apaga o banco local do usuário SE não houver
 * nada pendente (alteração não enviada nunca é descartada). Outro usuário nunca abre este banco.
 */
export async function encerrarMotor(opcoes: { apagarDados?: boolean } = {}) {
  const m = atual;
  atual = null;
  usuarioAtual = null;
  for (const fn of ouvintesMotor) fn(null);
  if (!m) return { apagado: false, pendentes: 0 };
  return (await m).encerrar(opcoes);
}

export type { Resumo as ResumoSync };
export const RESUMO_VAZIO: Resumo = {
  estado: "ONLINE",
  pendentes: 0,
  atencao: 0,
  conflitos: 0,
  progresso: null,
  ultimaSincronizacao: null,
  ultimoErro: null,
};
