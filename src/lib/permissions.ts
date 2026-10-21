/** Camada central de permissões: perfis, níveis, módulos e regras de acesso. */

export type Perfil =
  | "proprietario"
  | "super_admin"
  | "administrador"
  | "gestor"
  | "agricola"
  | "industria"
  | "usuario";

/** Perfis atribuíveis pelo administrador (o Proprietário é único e exclusivo). */
export const PERFIS: { valor: Perfil; label: string }[] = [
  { valor: "super_admin", label: "Super Administrador" },
  { valor: "administrador", label: "Administrador" },
  { valor: "gestor", label: "Gestor" },
  { valor: "agricola", label: "Agrícola" },
  { valor: "industria", label: "Indústria" },
  { valor: "usuario", label: "Usuário" },
];

/** Rótulos de todos os perfis, inclusive o Proprietário do Sistema. */
export const PERFIL_LABEL: Record<Perfil, string> = {
  proprietario: "Proprietário do Sistema",
  super_admin: "Super Administrador",
  administrador: "Administrador",
  gestor: "Gestor",
  agricola: "Agrícola",
  industria: "Indústria",
  usuario: "Usuário",
};

/**
 * Hierarquia definitiva — cada nível herda as permissões do nível inferior:
 * Proprietário > Super Administrador > Administrador > Gestor > Conferente > Usuário.
 * Os perfis operacionais (Agrícola/Indústria) atuam no nível Conferente.
 */
export const NIVEL: Record<Perfil, number> = {
  proprietario: 6,
  super_admin: 5,
  administrador: 4,
  gestor: 3,
  agricola: 2,
  industria: 2,
  usuario: 1,
};

/** Nível mínimo para acessar a Central Administrativa e suas operações. */
export const NIVEL_ADMIN = NIVEL.administrador;
/** Nível mínimo de leitura gerencial (Gestor e acima). */
export const NIVEL_GESTOR = NIVEL.gestor;

export const NIVEIS = [
  { nivel: 6, label: "Proprietário do Sistema" },
  { nivel: 5, label: "Super Administrador" },
  { nivel: 4, label: "Administrador" },
  { nivel: 3, label: "Gestor" },
  { nivel: 2, label: "Conferente" },
  { nivel: 1, label: "Usuário" },
] as const;

export function nivelDe(perfil?: Perfil | null) {
  return perfil ? (NIVEL[perfil] ?? 0) : 0;
}

/** Verificação única de hierarquia usada em todo o app (frontend e servidor). */
export function temNivel(perfil: Perfil | null | undefined, minimo: number) {
  return nivelDe(perfil) >= minimo;
}

export function ehProprietario(perfil?: Perfil | null) {
  return perfil === "proprietario";
}

export function ehAdministrativo(perfil?: Perfil | null) {
  return temNivel(perfil, NIVEL_ADMIN);
}

export function ehGestor(perfil?: Perfil | null) {
  return temNivel(perfil, NIVEL_GESTOR);
}


/** Ações críticas que exigem confirmação de senha antes de executar. */
export const ACOES_CRITICAS = [
  "excluir_usuario",
  "alterar_permissoes",
  "limpar_historico",
  "restaurar_backup",
  "alterar_integracoes",
  "alterar_dominio",
  "alterar_configuracoes_globais",
  "transferir_propriedade",
] as const;

export type AcaoCritica = (typeof ACOES_CRITICAS)[number];


export type ModuloId =
  | "FROTA"
  | "FERRAMENTAS_AGRICOLA"
  | "ESTOQUE_AGRICOLA"
  | "FERRAMENTAS_INDUSTRIA"
  | "ESTOQUE_INDUSTRIA"
  | "ADMIN";

/** Tipo de unidade gravado no banco (cada módulo tem seu próprio conjunto de dados). */
export type Tipo = "caminhao" | "caixa" | "prateleira" | "caixa_industria" | "prateleira_industria";

/** Comportamento da tela: caminhão, caixa de ferramentas ou lista de prateleira. */
export type Familia = "caminhao" | "caixa" | "prateleira";

export type Modulo = {
  id: ModuloId;
  tipo: Tipo;
  familia: Familia;
  titulo: string;
  descricao: string;
  rota: "/frota" | "/ferramentas-agricola" | "/estoque-agricola" | "/ferramentas-industria" | "/estoque-industria";
  icone: "truck" | "boxes" | "package";
};

export const MODULOS: Modulo[] = [
  {
    id: "FROTA",
    tipo: "caminhao",
    familia: "caminhao",
    titulo: "Frota de Caminhões",
    descricao: "Conferência dos materiais de cada caminhão",
    rota: "/frota",
    icone: "truck",
  },
  {
    id: "FERRAMENTAS_AGRICOLA",
    tipo: "caixa",
    familia: "caixa",
    titulo: "Ferramentas Agrícola",
    descricao: "Conferência por funcionário e gestor",
    rota: "/ferramentas-agricola",
    icone: "boxes",
  },
  {
    id: "ESTOQUE_AGRICOLA",
    tipo: "prateleira",
    familia: "prateleira",
    titulo: "Estoque Agrícola",
    descricao: "Listas de prateleiras importadas",
    rota: "/estoque-agricola",
    icone: "package",
  },
  {
    id: "FERRAMENTAS_INDUSTRIA",
    tipo: "caixa_industria",
    familia: "caixa",
    titulo: "Ferramentas Indústria",
    descricao: "Conferência por funcionário e gestor",
    rota: "/ferramentas-industria",
    icone: "boxes",
  },
  {
    id: "ESTOQUE_INDUSTRIA",
    tipo: "prateleira_industria",
    familia: "prateleira",
    titulo: "Estoque Indústria",
    descricao: "Listas de prateleiras importadas",
    rota: "/estoque-industria",
    icone: "package",
  },
];

const TODOS_MODULOS: ModuloId[] = [
  "FROTA",
  "FERRAMENTAS_AGRICOLA",
  "ESTOQUE_AGRICOLA",
  "FERRAMENTAS_INDUSTRIA",
  "ESTOQUE_INDUSTRIA",
  "ADMIN",
];

export const PERMISSOES: Record<Perfil, ModuloId[]> = {
  proprietario: TODOS_MODULOS,
  super_admin: TODOS_MODULOS,
  administrador: TODOS_MODULOS,
  gestor: TODOS_MODULOS.filter((m) => m !== "ADMIN"),
  agricola: ["FROTA", "FERRAMENTAS_AGRICOLA", "ESTOQUE_AGRICOLA"],
  industria: ["FERRAMENTAS_INDUSTRIA", "ESTOQUE_INDUSTRIA"],
  usuario: [],
};


export function getModulo(id: ModuloId) {
  return MODULOS.find((m) => m.id === id)!;
}

export function moduloPorTipo(tipo?: string | null) {
  return MODULOS.find((m) => m.tipo === tipo);
}

export function modulosDoPerfil(perfil?: Perfil | null): Modulo[] {
  if (!perfil) return [];
  const permitidos = PERMISSOES[perfil] ?? [];
  return MODULOS.filter((m) => permitidos.includes(m.id));
}

export function podeAcessar(perfil: Perfil | null | undefined, modulo: ModuloId) {
  if (!perfil) return false;
  return (PERMISSOES[perfil] ?? []).includes(modulo);
}

export function podeAcessarTipo(perfil: Perfil | null | undefined, tipo?: string | null) {
  const m = moduloPorTipo(tipo);
  return !!m && podeAcessar(perfil, m.id);
}

/** Módulos que exigem reautenticação (somente a senha do usuário logado). */
export const MODULOS_SENSIVEIS: ModuloId[] = ["ADMIN"];

export function exigeReautenticacao(modulo: ModuloId) {
  return MODULOS_SENSIVEIS.includes(modulo);
}
