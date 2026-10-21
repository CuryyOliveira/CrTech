/**
 * Cadastros mestres, matriz de permissões, avisos do sistema e sessões.
 * Camada única de tipos e utilitários usada pela Central Administrativa.
 */

export type CadastroTipo = "setor" | "perfil" | "modulo" | "categoria" | "tipo_conferencia";

export const CADASTRO_TIPOS: { id: CadastroTipo; titulo: string; singular: string }[] = [
  { id: "setor", titulo: "Setores", singular: "Setor" },
  { id: "perfil", titulo: "Perfis", singular: "Perfil" },
  { id: "modulo", titulo: "Módulos", singular: "Módulo" },
  { id: "categoria", titulo: "Categorias", singular: "Categoria" },
  { id: "tipo_conferencia", titulo: "Tipos de conferência", singular: "Tipo de conferência" },
];

export type CadastroRow = {
  id: string;
  tipo: CadastroTipo;
  codigo: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
  excluido: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Matriz de permissões: ações possíveis em cada módulo. */
export type Acao =
  | "visualizar"
  | "criar"
  | "editar"
  | "excluir"
  | "exportar"
  | "importar"
  | "administrar"
  | "auditar";

export const ACOES: { valor: Acao; label: string }[] = [
  { valor: "visualizar", label: "Visualizar" },
  { valor: "criar", label: "Criar" },
  { valor: "editar", label: "Editar" },
  { valor: "excluir", label: "Excluir" },
  { valor: "exportar", label: "Exportar" },
  { valor: "importar", label: "Importar" },
  { valor: "administrar", label: "Administrar" },
  { valor: "auditar", label: "Auditar" },
];

export type PermissaoRow = {
  id: string;
  modulo: string;
  acoes: Acao[];
  updated_at: string;
};

export type PermissaoPerfilRow = PermissaoRow & { perfil: string };
export type PermissaoUsuarioRow = PermissaoRow & { user_id: string };

/** Avisos e notificações publicados pelos administradores. */
export type AvisoCategoria = "aviso" | "atualizacao" | "alerta" | "notificacao";

export const AVISO_CATEGORIAS: { valor: AvisoCategoria; label: string }[] = [
  { valor: "aviso", label: "Aviso do sistema" },
  { valor: "atualizacao", label: "Atualização" },
  { valor: "alerta", label: "Alerta" },
  { valor: "notificacao", label: "Notificação" },
];

export type AvisoRow = {
  id: string;
  titulo: string;
  mensagem: string;
  categoria: AvisoCategoria;
  prioridade: "info" | "aviso" | "atencao" | "critica";
  destino_perfil: string | null;
  destino_setor: string | null;
  agendado_para: string | null;
  publicado: boolean;
  exige_confirmacao: boolean;
  arquivado: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SessaoRow = {
  id: string;
  user_id: string;
  dispositivo: string | null;
  navegador: string | null;
  ip: string | null;
  iniciada_em: string;
  ultimo_ping: string;
  encerrada_em: string | null;
  motivo_encerramento: string | null;
};

/** Uma sessão é considerada online enquanto houver sinal nos últimos 3 minutos. */
export const JANELA_ONLINE_MS = 3 * 60 * 1000;

export function sessaoOnline(s: Pick<SessaoRow, "ultimo_ping" | "encerrada_em">, agora = Date.now()) {
  if (s.encerrada_em) return false;
  return agora - new Date(s.ultimo_ping).getTime() < JANELA_ONLINE_MS;
}

/** Configurações gerais e de segurança do sistema. */
export type ConfigGeral = {
  empresa: string;
  logotipo: string;
  tema: "sistema" | "claro" | "escuro";
  cor_principal: string;
  idioma: string;
  timezone: string;
};

export const CONFIG_GERAL_PADRAO: ConfigGeral = {
  empresa: "Oficina de Caminhões",
  logotipo: "",
  tema: "sistema",
  cor_principal: "#ea580c",
  idioma: "pt-BR",
  timezone: "America/Sao_Paulo",
};

export type ConfigSeguranca = {
  sessao_minutos: number;
  senha_minima: number;
  senha_exige_numero: boolean;
  senha_exige_maiuscula: boolean;
  senha_exige_especial: boolean;
  mfa_preparado: boolean;
  limite_tentativas: number;
  sessoes_simultaneas: number;
};

export const CONFIG_SEGURANCA_PADRAO: ConfigSeguranca = {
  sessao_minutos: 480,
  senha_minima: 6,
  senha_exige_numero: false,
  senha_exige_maiuscula: false,
  senha_exige_especial: false,
  mfa_preparado: false,
  limite_tentativas: 5,
  sessoes_simultaneas: 3,
};

export type ConfigSistema = {
  limpeza_automatica: boolean;
  limpeza_dias: number;
};

export const CONFIG_SISTEMA_PADRAO: ConfigSistema = {
  limpeza_automatica: false,
  limpeza_dias: 365,
};

/** Identificação simplificada do dispositivo e navegador do usuário. */
export function dispositivoAtual() {
  if (typeof navigator === "undefined") return { dispositivo: null, navegador: null };
  const ua = navigator.userAgent;
  const dispositivo = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "Desconhecido";
  const navegador = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /firefox|fxios/i.test(ua)
        ? "Firefox"
        : /safari/i.test(ua)
          ? "Safari"
          : "Outro";
  return { dispositivo, navegador };
}
