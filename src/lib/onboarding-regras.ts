/**
 * Regras puras do onboarding SaaS (sem dependências de browser ou servidor).
 * Compartilhado entre o frontend e os server functions.
 */

/** Momento em que o onboarding SaaS passou a valer. Contas anteriores são legadas. */
export const CORTE_LEGADO = "2026-08-10T00:00:00.000Z";

export type SituacaoOnboarding =
  /** Usuário anterior ao SaaS: mantém acesso, módulos e permissões atuais. */
  | "legado"
  /** Convidado/vinculado a uma empresa existente: herda assinatura e permissões. */
  | "empresa"
  /** Novo usuário sem empresa: deve iniciar uma nova empresa. */
  | "nova_empresa"
  /** Sem sessão identificada. */
  | "desconhecido";

/** Motivos pelos quais o acesso operacional pode estar bloqueado. */
export type MotivoBloqueio =
  | "usuario_bloqueado"
  | "sem_empresa"
  | "sem_assinatura"
  /** Bloqueio administrativo aplicado pelo proprietário do sistema. */
  | "empresa_bloqueada"
  /** Empresa desativada pelo proprietário do sistema (dados preservados). */
  | "empresa_desativada";

/** Situações de assinatura que liberam o uso dos módulos. */
export const STATUS_LIBERADOS = ["ativa", "trial"] as const;

/** Uma data anterior ao corte indica estrutura existente antes do SaaS. */
export function anteriorAoCorte(data?: string | null) {
  if (!data) return false;
  const t = new Date(data).getTime();
  return Number.isFinite(t) && t < new Date(CORTE_LEGADO).getTime();
}
