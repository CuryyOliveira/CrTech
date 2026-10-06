/** Estrutura de navegação da Central Administrativa. */

export type AdminItem = {
  slug: string;
  titulo: string;
  descricao: string;
  icone:
    | "users"
    | "clipboard"
    | "settings"
    | "gauge"
    | "target"
    | "fileText"
    | "bell"
    | "shieldCheck"
    | "history"
    | "creditCard"
    | "building"
    | "boxes";

};

export type AdminCategoria = {
  id: "gestao" | "inteligencia" | "controle";
  titulo: string;
  emoji: string;
  /** Texto curto exibido no grupo (Central e tela do grupo). */
  descricao: string;
  itens: AdminItem[];
};

export const ADMIN_CATEGORIAS: AdminCategoria[] = [
  {
    id: "gestao",
    titulo: "Gestão",
    emoji: "👥",
    descricao: "Usuários, empresa, módulos, setores, planos, avisos e sistema.",
    itens: [
      {
        slug: "usuarios",
        titulo: "Gestão de Usuários",
        descricao: "Cadastro, edição, bloqueio, perfil, setor e senha",
        icone: "users",
      },
      {
        slug: "catalogo",
        titulo: "Planos, Módulos e Categorias",
        descricao: "Edite o catálogo do sistema pela tela, sem depender de código",
        icone: "clipboard",
      },
      {
        slug: "modulos",
        titulo: "Módulos da Empresa",
        descricao: "Crie e organize as áreas de conferência do seu negócio",
        icone: "boxes",
      },
      {
        slug: "setores",
        titulo: "Setores da Empresa",
        descricao: "Crie, renomeie e ative os setores da sua operação",
        icone: "building",
      },
      {
        slug: "cadastros",
        titulo: "Cadastros",
        descricao: "Setores, perfis, módulos, categorias e tipos",
        icone: "clipboard",
      },
      {
        slug: "avisos",
        titulo: "Avisos do Sistema",
        descricao: "Comunicados com agendamento e confirmação de leitura",
        icone: "bell",
      },
      {
        slug: "minha-empresa",
        titulo: "Minha Empresa",
        descricao: "Dados da empresa, plano contratado e licenças em uso",
        icone: "building",
      },
      {
        slug: "assinaturas",
        titulo: "Assinaturas e Planos",
        descricao: "Empresas, plano contratado, situação da conta e pagamentos",
        icone: "creditCard",
      },
      {
        slug: "status-pagamentos",
        titulo: "Status de Pagamentos",
        descricao: "Credenciais do Mercado Pago e situação do webhook",
        icone: "creditCard",
      },


      {
        slug: "sincronizacao",
        titulo: "Sincronização Manual",
        descricao: "Veja e envie o que ainda não chegou ao servidor",
        icone: "history",
      },
      {
        slug: "dados-offline",
        titulo: "Dados Offline",
        descricao: "Empresas, módulos, setores e planos guardados no aparelho",
        icone: "boxes",
      },
      {
        slug: "sistema",
        titulo: "Administração do Sistema",
        descricao: "Configurações gerais, segurança e integrações",
        icone: "settings",
      },
    ],
  },
  {
    id: "inteligencia",
    titulo: "Inteligência",
    emoji: "📊",
    descricao: "Painel gerencial, metas, estoque e relatórios.",
    itens: [
      {
        slug: "painel-gerencial",
        titulo: "Painel Gerencial",
        descricao: "Indicadores consolidados das operações",
        icone: "gauge",
      },
      {
        slug: "metas",
        titulo: "Metas e KPIs",
        descricao: "Definição e acompanhamento de metas",
        icone: "target",
      },
      {
        slug: "estoque",
        titulo: "Estoque por Módulo",
        descricao: "Entradas, saídas e saldo de cada material, sem abrir a conferência",
        icone: "boxes",
      },
      {
        slug: "relatorios",
        titulo: "Relatórios",
        descricao: "Relatórios gerenciais e exportações",
        icone: "fileText",
      },
    ],
  },
  {
    id: "controle",
    titulo: "Controle",
    emoji: "🔒",
    descricao: "Notificações, auditoria, histórico e diagnóstico.",
    itens: [
      {
        slug: "notificacoes",
        titulo: "Central de Notificações",
        descricao: "Avisos e alertas do sistema",
        icone: "bell",
      },
      {
        slug: "auditoria",
        titulo: "Log de Auditoria",
        descricao: "Registro das ações realizadas",
        icone: "shieldCheck",
      },
      {
        slug: "relatorios-admin",
        titulo: "Relatórios Administrativos",
        descricao: "Usuários, permissões, cadastros, logs e configurações",
        icone: "fileText",
      },
      {
        slug: "historico-operacional",
        titulo: "Histórico Operacional",
        descricao: "Conferências e movimentações por período",
        icone: "history",
      },
      {
        slug: "diagnostico",
        titulo: "Autodiagnóstico de Acesso",
        descricao: "Sessão, perfil, hierarquia, políticas de acesso e leitura das tabelas",
        icone: "shieldCheck",
      },

    ],
  },
];

export const ADMIN_ITENS: AdminItem[] = ADMIN_CATEGORIAS.flatMap((c) => c.itens);

export function adminItem(slug: string) {
  return ADMIN_ITENS.find((i) => i.slug === slug);
}

export function adminCategoria(id: string) {
  return ADMIN_CATEGORIAS.find((c) => c.id === id);
}

/** Grupo a que um módulo pertence (para a trilha Central → Grupo → Módulo). */
export function categoriaDoItem(slug: string) {
  return ADMIN_CATEGORIAS.find((c) => c.itens.some((i) => i.slug === slug));
}

/** Categorias de configuração da Administração do Sistema (fase estrutural). */
export const SISTEMA_CATEGORIAS = [
  { id: "gerais", titulo: "Configurações Gerais" },
  { id: "usuarios", titulo: "Usuários e Permissões" },
  { id: "operacao", titulo: "Operação" },
  { id: "notificacoes", titulo: "Notificações" },
  { id: "seguranca", titulo: "Segurança" },
  { id: "integracoes", titulo: "Integrações" },
  { id: "banco", titulo: "Banco de Dados" },
  { id: "governanca", titulo: "Governança" },

] as const;

/** Cadastros centralizados do sistema (fase estrutural). */
export const CADASTROS = [
  { id: "setores", titulo: "Setores" },
  { id: "perfis", titulo: "Perfis" },
  { id: "modulos", titulo: "Módulos" },
  { id: "categorias", titulo: "Categorias" },
  { id: "tipos-conferencia", titulo: "Tipos de conferência" },
] as const;
