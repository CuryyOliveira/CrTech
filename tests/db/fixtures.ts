/** Identificadores fixos dos dados de teste (espelham tests/db/fixtures.sql). */
const id = (sufixo: string) => `00000000-0000-4000-8000-${sufixo.padStart(12, "0")}`;

export const EMPRESA_A = id("e0a");
export const EMPRESA_B = id("e0b");
export const MODULO_A = id("f0a");
export const MODULO_B = id("f0b");

/** Usuários. Papéis pedidos na Fase 0: ADMIN, ESTOQUISTA, VISUALIZADOR, Empresa A e Empresa B. */
export const U = {
  DONO: id("d0e0"), // proprietário do sistema (nível 6, global) — membro da empresa A
  ADMIN_A: id("a001"), // administrador da empresa A (nível 4) — criado antes de 10/08/2026
  ESTQ_A: id("a002"), // estoquista/conferente da empresa A (agrícola, nível 2)
  GESTOR_A: id("a003"), // gestor da empresa A (nível 3)
  VISU_A: id("a004"), // visualizador da empresa A (perfil "usuario", nível 1)
  BLOQ_A: id("a005"), // conferente da empresa A BLOQUEADO
  ADMIN_B: id("b001"), // administrador da empresa B
  ESTQ_B: id("b002"), // estoquista/conferente da empresa B
  LEGADO: id("c001"), // usuário legado sem empresa (como a conta "aprendiz" da produção)
} as const;

export const LISTA = {
  A: id("1a1"), // lista legada (caminhão) da empresa A
  A2: id("1a2"), // lista legada da empresa A com conferência aberta
  A_MOD: id("1a3"), // lista de módulo da empresa A
  A_IND: id("1a4"), // lista do tipo indústria na empresa A (agrícola não vê)
  A_VAZIA: id("1a5"), // lista sem materiais
  B: id("1b1"), // lista legada da empresa B
  SEM_EMPRESA: id("1c1"), // lista sem empresa (só acesso global)
} as const;

export const MATERIAL = {
  A1: id("2a1"), // esperada 10
  A2: id("2a2"), // esperada 5
  A3: id("2a3"), // esperada 0
  A2_1: id("2a4"),
  A_MOD: id("2a5"),
  A_IND: id("2a6"),
  B1: id("2b1"),
  SEM: id("2c1"),
} as const;

export const CONF = {
  A_FIN: id("3a1"), // finalizada (lista A)
  A_CANC: id("3a2"), // cancelada (lista A)
  A2_ABERTA: id("3a3"), // em andamento (lista A2)
  B_FIN: id("3b1"), // finalizada (lista B)
} as const;

export const ITEM = {
  A_FIN_1: id("4a1"),
  A_FIN_2: id("4a2"),
  A2_1: id("4a3"),
  B_FIN_1: id("4b1"),
} as const;

export const novoId = () => crypto.randomUUID();
