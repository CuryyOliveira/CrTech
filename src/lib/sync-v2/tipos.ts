/**
 * Motor de sincronização V2 — tipos.
 *
 * Toda ação feita numa conferência vira um EVENTO com event_id gerado no aparelho. O evento
 * é gravado localmente (junto do efeito na tela) numa única transação do IndexedDB e depois
 * enviado ao servidor, sempre com o MESMO event_id, quantas vezes for preciso.
 */

export const VERSAO_EVENTO = 1 as const;

export type TipoEvento =
  | "CONFERENCE_CREATED"
  | "ITEM_COUNTED"
  | "MATERIAL_ADDED"
  | "CONFERENCE_PAUSED"
  | "CONFERENCE_RESUMED"
  | "SIGNATURE_ADDED"
  | "CONFERENCE_FINALIZED"
  | "CONFERENCE_CANCELLED"
  | "PHOTO_ADDED";

export type Evento = {
  event_id: string;
  conference_id: string;
  device_id: string;
  user_id: string;
  company_id: string | null;
  event_type: TipoEvento;
  created_at_device: string;
  schema_version: typeof VERSAO_EVENTO;
  payload: Record<string, unknown>;
  /** Ordem local (monotônica por aparelho/usuário). */
  seq: number;
};

/** Estados de um evento na fila de sincronização. Nada sai da fila sem decisão explícita. */
export type StatusFila =
  | "PENDING" // aguardando envio
  | "SYNCING" // em envio (volta a PENDING se o app fechar no meio)
  | "SYNCED" // aplicado no servidor (ou reconhecido como já aplicado)
  | "FAILED" // falhou; nova tentativa agendada (backoff)
  | "NEEDS_ATTENTION" // recusado pelo servidor ou falhas repetidas: o usuário precisa decidir
  | "CONFLICT" // o servidor tem outra versão: o usuário decide
  | "RESOLVED"; // decisão explícita do usuário registrada (evento mantido para auditoria)

export type ItemFila = {
  event_id: string;
  seq: number;
  conference_id: string;
  event_type: TipoEvento;
  status: StatusFila;
  /** Falhas de servidor (contam para NEEDS_ATTENTION). */
  tentativas: number;
  /** Falhas de rede/timeout (NÃO contam: sem internet não é erro do dado). */
  falhas_rede: number;
  created_at: string;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  error_code: string | null;
  error_message: string | null;
  payload: Record<string, unknown>;
  /** Item local afetado (chave `k`), quando houver. */
  alvo_k: string | null;
  /** Resposta do servidor (resultado, estado do servidor em conflitos). */
  resposta: Record<string, unknown> | null;
  /** Transação do servidor que aplicou o evento (para saber quando o pull já o refletiu). */
  txid: string | null;
  /** O pull já trouxe o efeito deste evento: não precisa mais ser reaplicado na tela. */
  refletido: boolean;
  /** Foto que precisa ser enviada ao Storage antes do evento. */
  aguarda_foto: string | null;
  resolucao: { decisao: Decisao; em: string; novo_evento?: string } | null;
};

export type Decisao = "manter_local" | "usar_servidor" | "tentar_novamente";

/** Resultado do processamento de um evento pelo servidor. */
export type ResultadoServidor = {
  event_id: string;
  status: "aplicado" | "conflito" | "rejeitado" | "tentar_novamente";
  duplicado?: boolean;
  erro_codigo?: string;
  erro_mensagem?: string;
  estado_servidor?: Record<string, unknown>;
  [k: string]: unknown;
};

export type Alteracao = {
  tabela: "unidades" | "materiais" | "conferencias" | "conferencia_itens" | "conferencia_fotos";
  id: string;
  conferencia_id?: string | null;
  operacao: "upsert" | "delete";
  dados: Record<string, unknown> | null;
};

export type PaginaAlteracoes = {
  alteracoes: Alteracao[];
  cursor: string;
  mais: boolean;
  reset: boolean;
};

/** Estado global de conexão/sincronização exibido ao usuário. */
export type EstadoSync = "ONLINE" | "OFFLINE" | "SYNCING" | "ERROR";

/** Estado da conferência como o aparelho a mostra (servidor + eventos locais ainda não refletidos). */
export type EstadoConferencia = {
  unidade_id: string;
  status: "em_andamento" | "pausada" | "finalizada" | "cancelada" | "concluida";
  hora_inicio: string;
  hora_fim: string | null;
  total_tempo_pausado: number;
  quantidade_pausas: number;
  ultima_pausa: string | null;
  ultima_retomada: string | null;
  tempo_trabalhado: number | null;
  conferente: string | null;
  responsavel: string | null;
  observacoes: string | null;
  motivo_cancelamento: string | null;
  tem_assinatura: boolean;
  tem_assinatura_gestor: boolean;
};

export type ConferenciaLocal = EstadoConferencia & {
  id: string;
  /** Linha do servidor (sem imagens), quando já conhecida. */
  servidor: Record<string, unknown> | null;
  /** Estado inicial criado no aparelho (antes de o servidor confirmar). */
  inicial: EstadoConferencia | null;
  /** O servidor informou exclusão, mas ainda há eventos locais pendentes. */
  removida_no_servidor: boolean;
  /** Há eventos locais ainda não confirmados/refletidos. */
  pendente: boolean;
};

export type EstadoItem = {
  id: string | null;
  material_id: string | null;
  codigo: string | null;
  descricao: string | null;
  locacao: string | null;
  quantidade_esperada: number;
  quantidade_contada: number | null;
  status: "pendente" | "conferido" | "divergencia";
  observacoes: string | null;
  origem: "lista" | "adicionado";
  motivo_inclusao: string | null;
  /** Versão do servidor que este aparelho viu (detecção de conflito). */
  versao: number;
};

export type ItemLocal = EstadoItem & {
  /** Chave local estável: `<conferencia>|m|<material>` ou `<conferencia>|i|<item>`. */
  k: string;
  conferencia_id: string;
  servidor: Record<string, unknown> | null;
  inicial: EstadoItem | null;
  removido_no_servidor: boolean;
  pendente: boolean;
};

export type FotoLocal = {
  id: string;
  conferencia_id: string;
  empresa_id: string;
  usuario_id: string;
  evento_id: string;
  item_k: string | null;
  caminho: string;
  mime: string;
  bytes: number;
  /** Conteúdo da foto (ArrayBuffer: funciona em todos os WebViews). Só é liberado após confirmação do servidor. */
  arquivo: ArrayBuffer | null;
  largura: number | null;
  altura: number | null;
  status: "pendente_upload" | "enviando" | "enviada" | "confirmada" | "erro";
  tentativas: number;
  erro: string | null;
  criada_em: string;
};

export type Sessao = {
  userId: string;
  empresaId: string | null;
  deviceId: string;
};

export class ErroRede extends Error {
  constructor(
    mensagem = "Sem conexão com o servidor",
    readonly motivo: "offline" | "timeout" | "rede" = "rede",
  ) {
    super(mensagem);
    this.name = "ErroRede";
  }
}

export class ErroServidor extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string | null = null,
    readonly definitivo = false,
  ) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

export class ErroRegra extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroRegra";
  }
}
