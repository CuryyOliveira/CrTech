/**
 * FASE 13 — Motor Universal de Módulos.
 *
 * Um módulo é apenas uma configuração: nome, tipo de operação e recursos.
 * O motor de conferência (listas → materiais → conferência → histórico) é
 * sempre o mesmo, independente do segmento da empresa.
 *
 * Módulos legados (Frota, Agrícola, Indústria) continuam existindo como
 * módulos "virtuais" resolvidos por `unidades.tipo`; módulos novos são
 * registros em `empresa_modulos` e usam `unidades.modulo_id`.
 */
import { MODULOS, type Familia, type ModuloId } from "@/lib/permissions";

/** Tipo de operação do módulo — define o comportamento da tela. */
export type TipoModulo = "lista" | "caixa" | "frota";

export const TIPOS_MODULO: { valor: TipoModulo; label: string; descricao: string }[] = [
  {
    valor: "lista",
    label: "Lista / Prateleira",
    descricao: "Listas importadas de planilha, com locação e quantidade do sistema",
  },
  {
    valor: "caixa",
    label: "Caixa por responsável",
    descricao: "Conjunto de itens sob responsabilidade de um funcionário, com assinatura do gestor",
  },
  {
    valor: "frota",
    label: "Veículo / Frota",
    descricao: "Cadastro com placa, modelo e frota, e conferência dos materiais embarcados",
  },
];

export const FAMILIA_POR_TIPO: Record<TipoModulo, Familia> = {
  lista: "prateleira",
  caixa: "caixa",
  frota: "caminhao",
};

/** Ícones disponíveis para módulos (nomes estáveis, resolvidos na UI). */
export const ICONES_MODULO = [
  "package",
  "boxes",
  "truck",
  "wrench",
  "pill",
  "stethoscope",
  "car",
  "shirt",
  "utensils",
  "warehouse",
  "cart",
  "book",
  "hardhat",
  "flask",
  "monitor",
] as const;

export type IconeModulo = (typeof ICONES_MODULO)[number];

/** Linha da tabela `empresa_modulos`. */
export type ModuloEmpresa = {
  id: string;
  empresa_id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  icone: string;
  cor: string | null;
  tipo: TipoModulo;
  recursos: Record<string, unknown> | null;
  ordem: number;
  ativo: boolean;
  excluido: boolean;
  origem: "sugerido" | "personalizado" | "legado";
};

/** Módulo pronto para uso na interface e no motor, legado ou dinâmico. */
export type ModuloResolvido = {
  /** Identificador usado na autorização: código legado ou UUID do módulo. */
  chave: string;
  titulo: string;
  descricao: string;
  icone: string;
  rota: string;
  familia: Familia;
  tipoUnidade: string;
  legado: boolean;
  moduloId: string | null;
  recursos: Record<string, unknown>;
};

export function resolverLegado(id: ModuloId): ModuloResolvido | null {
  const m = MODULOS.find((x) => x.id === id);
  if (!m) return null;
  return {
    chave: m.id,
    titulo: m.titulo,
    descricao: m.descricao,
    icone: m.icone,
    rota: m.rota,
    familia: m.familia,
    tipoUnidade: m.tipo,
    legado: true,
    moduloId: null,
    recursos: {},
  };
}

export function resolverEmpresa(m: ModuloEmpresa): ModuloResolvido {
  return {
    chave: m.id,
    titulo: m.nome,
    descricao: m.descricao ?? TIPOS_MODULO.find((t) => t.valor === m.tipo)?.descricao ?? "",
    icone: m.icone || "package",
    rota: `/m/${m.id}`,
    familia: FAMILIA_POR_TIPO[m.tipo] ?? "prateleira",
    tipoUnidade: m.tipo,
    legado: false,
    moduloId: m.id,
    recursos: (m.recursos ?? {}) as Record<string, unknown>,
  };
}

/** Gera um código estável a partir do nome informado pelo administrador. */
export function codigoDoNome(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 40);
}

export type ModuloSugerido = {
  nome: string;
  descricao: string;
  tipo: TipoModulo;
  icone: IconeModulo;
};

export type Segmento = {
  valor: string;
  nome: string;
  descricao: string;
  modulos: ModuloSugerido[];
};

/**
 * Catálogo de segmentos: serve apenas como sugestão inicial no onboarding.
 * O administrador pode aceitar, remover ou criar módulos livremente.
 */
export const SEGMENTOS: Segmento[] = [
  {
    valor: "farmacia",
    nome: "Farmácia / Drogaria",
    descricao: "Medicamentos, perfumaria e estoque de loja",
    modulos: [
      { nome: "Medicamentos", descricao: "Conferência das prateleiras de medicamentos", tipo: "lista", icone: "pill" },
      { nome: "Perfumaria", descricao: "Conferência das gôndolas de perfumaria", tipo: "lista", icone: "cart" },
      { nome: "Estoque / Depósito", descricao: "Conferência do estoque interno", tipo: "lista", icone: "warehouse" },
    ],
  },
  {
    valor: "hospital",
    nome: "Hospital / Clínica",
    descricao: "Almoxarifado, farmácia interna e carrinhos de emergência",
    modulos: [
      { nome: "Almoxarifado", descricao: "Materiais hospitalares por prateleira", tipo: "lista", icone: "warehouse" },
      { nome: "Farmácia Interna", descricao: "Medicamentos controlados e de uso interno", tipo: "lista", icone: "pill" },
      { nome: "Carrinho de Emergência", descricao: "Checklist por carrinho e responsável", tipo: "caixa", icone: "stethoscope" },
    ],
  },
  {
    valor: "autopecas",
    nome: "Autopeças",
    descricao: "Peças por prateleira, balcão e veículos de entrega",
    modulos: [
      { nome: "Peças", descricao: "Conferência das prateleiras de peças", tipo: "lista", icone: "package" },
      { nome: "Balcão", descricao: "Itens de giro rápido no balcão", tipo: "lista", icone: "cart" },
      { nome: "Veículos de Entrega", descricao: "Materiais embarcados por veículo", tipo: "frota", icone: "car" },
    ],
  },
  {
    valor: "supermercado",
    nome: "Supermercado / Varejo",
    descricao: "Gôndolas, depósito e frente de loja",
    modulos: [
      { nome: "Gôndolas", descricao: "Conferência por gôndola ou seção", tipo: "lista", icone: "cart" },
      { nome: "Depósito", descricao: "Estoque de retaguarda", tipo: "lista", icone: "warehouse" },
      { nome: "Frente de Caixa", descricao: "Itens e materiais da frente de loja", tipo: "lista", icone: "package" },
    ],
  },
  {
    valor: "industria",
    nome: "Indústria",
    descricao: "Almoxarifado, ferramentaria e manutenção",
    modulos: [
      { nome: "Almoxarifado", descricao: "Insumos e materiais por prateleira", tipo: "lista", icone: "warehouse" },
      { nome: "Ferramentaria", descricao: "Ferramentas por colaborador", tipo: "caixa", icone: "wrench" },
      { nome: "Manutenção", descricao: "Materiais das equipes de manutenção", tipo: "caixa", icone: "hardhat" },
    ],
  },
  {
    valor: "agronegocio",
    nome: "Agronegócio / Fazenda",
    descricao: "Insumos agrícolas, ferramentas e frota",
    modulos: [
      { nome: "Insumos Agrícolas", descricao: "Defensivos, fertilizantes e sementes", tipo: "lista", icone: "flask" },
      { nome: "Ferramentas", descricao: "Ferramentas por colaborador", tipo: "caixa", icone: "wrench" },
      { nome: "Frota", descricao: "Materiais embarcados em cada máquina ou caminhão", tipo: "frota", icone: "truck" },
    ],
  },
  {
    valor: "construcao",
    nome: "Construção Civil",
    descricao: "Canteiro de obras, ferramentas e EPIs",
    modulos: [
      { nome: "Canteiro", descricao: "Materiais do canteiro de obras", tipo: "lista", icone: "hardhat" },
      { nome: "Ferramentas", descricao: "Ferramentas por colaborador", tipo: "caixa", icone: "wrench" },
      { nome: "EPIs", descricao: "Equipamentos de proteção por colaborador", tipo: "caixa", icone: "shirt" },
    ],
  },
  {
    valor: "transportadora",
    nome: "Transportadora / Logística",
    descricao: "Frota, armazém e equipamentos",
    modulos: [
      { nome: "Frota", descricao: "Materiais e equipamentos por veículo", tipo: "frota", icone: "truck" },
      { nome: "Armazém", descricao: "Conferência do armazém por prateleira", tipo: "lista", icone: "warehouse" },
      { nome: "Equipamentos", descricao: "Equipamentos sob responsabilidade de cada colaborador", tipo: "caixa", icone: "boxes" },
    ],
  },
  {
    valor: "restaurante",
    nome: "Restaurante / Alimentação",
    descricao: "Cozinha, estoque e utensílios",
    modulos: [
      { nome: "Estoque de Alimentos", descricao: "Conferência do estoque de alimentos", tipo: "lista", icone: "utensils" },
      { nome: "Cozinha", descricao: "Utensílios e equipamentos da cozinha", tipo: "caixa", icone: "utensils" },
      { nome: "Bebidas", descricao: "Conferência do estoque de bebidas", tipo: "lista", icone: "cart" },
    ],
  },
  {
    valor: "escola",
    nome: "Escola / Educação",
    descricao: "Biblioteca, laboratórios e almoxarifado",
    modulos: [
      { nome: "Biblioteca", descricao: "Acervo por prateleira", tipo: "lista", icone: "book" },
      { nome: "Laboratórios", descricao: "Materiais e equipamentos de laboratório", tipo: "lista", icone: "flask" },
      { nome: "Almoxarifado", descricao: "Materiais administrativos e de limpeza", tipo: "lista", icone: "warehouse" },
    ],
  },
  {
    valor: "ti",
    nome: "Tecnologia / Escritório",
    descricao: "Equipamentos de TI e materiais de escritório",
    modulos: [
      { nome: "Equipamentos de TI", descricao: "Notebooks, monitores e periféricos por colaborador", tipo: "caixa", icone: "monitor" },
      { nome: "Almoxarifado", descricao: "Materiais de escritório por prateleira", tipo: "lista", icone: "warehouse" },
    ],
  },
  {
    valor: "outro",
    nome: "Outro segmento",
    descricao: "Começar com um módulo em branco e personalizar",
    modulos: [
      { nome: "Estoque", descricao: "Conferência do estoque por prateleira", tipo: "lista", icone: "package" },
    ],
  },
];

export function getSegmento(valor?: string | null) {
  return SEGMENTOS.find((s) => s.valor === valor) ?? null;
}

/**
 * Marca local (offline) indicando que o usuário pertence à estrutura legada.
 * Sem rede não há como consultar o servidor, e módulos legados nunca podem
 * aparecer para empresas novas — por isso a última resposta é memorizada.
 */
const CHAVE_LEGADO = "cr:legado";

export function memorizarLegado(legado: boolean) {
  try {
    window.localStorage.setItem(CHAVE_LEGADO, legado ? "1" : "0");
  } catch {
    /* armazenamento indisponível */
  }
}

export function legadoMemorizado() {
  try {
    return window.localStorage.getItem(CHAVE_LEGADO) === "1";
  } catch {
    return false;
  }
}
