/**
 * Motor de sincronização V2 (offline-first, orientado a eventos).
 *
 * Garantias:
 *  - Cada ação vira um evento com event_id gerado AQUI, gravado no IndexedDB na MESMA
 *    transação que atualiza a tela. Se o app fechar em seguida, nada se perde.
 *  - O event_id nunca é regenerado: reenvios (timeout, resposta perdida) são reconhecidos
 *    pelo servidor como "duplicado" e não são aplicados duas vezes.
 *  - Nada é descartado automaticamente. Falhas repetidas → NEEDS_ATTENTION; conflito → CONFLICT.
 *    Só uma decisão explícita do usuário tira o evento da fila (RESOLVED, mantido para auditoria).
 *  - Eventos de uma mesma conferência são enviados em ordem. Um evento parado (conflito,
 *    atenção, aguardando nova tentativa) segura os seguintes da mesma conferência.
 *  - Finalizar/cancelar e fotos só são enviados quando tudo o que veio antes na conferência
 *    já foi confirmado.
 */
import { BancoLocal, apagarBanco, type Transacao } from "./banco-local";
import { LIMITE_LOGS, sanitizar, type RegistroLog } from "./log";
import {
  aplicarNaConferencia,
  aplicarNoItem,
  chaveItem,
  conferenciaDoServidor,
  encerrada,
  itemDoServidor,
  reaplicavel,
  statusItem,
} from "./projecao";
import type { TabelaSync, Transporte } from "./transporte";
import {
  ErroRede,
  ErroRegra,
  ErroServidor,
  VERSAO_EVENTO,
  type Alteracao,
  type ConferenciaLocal,
  type Decisao,
  type EstadoConferencia,
  type EstadoItem,
  type EstadoSync,
  type Evento,
  type FotoLocal,
  type ItemFila,
  type ItemLocal,
  type ResultadoServidor,
  type Sessao,
  type TipoEvento,
} from "./tipos";

export type OpcoesMotor = {
  fabrica?: IDBFactory;
  agora?: () => Date;
  /** Liga timers, eventos online/offline e sincronização após cada ação. */
  automatico?: boolean;
  /** Falhas de SERVIDOR até NEEDS_ATTENTION (falhas de rede não contam). */
  limiteFalhas?: number;
  loteEnvio?: number;
  lotePull?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  aleatorio?: () => number;
  online?: () => boolean;
  gerarId?: () => string;
};

export type Resumo = {
  estado: EstadoSync;
  pendentes: number;
  atencao: number;
  conflitos: number;
  progresso: { total: number; feitos: number } | null;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
};

export type ResultadoSync = {
  ok: boolean;
  mensagem: string;
  enviados: number;
  recebidos: number;
  pendentes: number;
  atencao: number;
};

export const MENSAGEM_CONCLUIDA = "Sincronização concluída.";
export const MENSAGEM_ATENCAO = "Existem operações que precisam de atenção.";
export const MENSAGEM_PAINEL = "Há alterações que precisam de atenção.";
export const MENSAGEM_SEM_REDE =
  "Sem conexão. As alterações continuam salvas no aparelho e serão enviadas quando a internet voltar.";

const STORES_OPERACAO = [
  "unidades",
  "materiais",
  "conferencias",
  "itens",
  "eventos",
  "fila",
  "sincronizacao",
  "fotos",
] as const;
const STORES_PULL = [
  "unidades",
  "materiais",
  "conferencias",
  "itens",
  "fila",
  "sincronizacao",
  "fotos",
] as const;
const ABERTOS = ["PENDING", "SYNCING", "FAILED", "NEEDS_ATTENTION", "CONFLICT"] as const;
const BARREIRAS: TipoEvento[] = ["CONFERENCE_FINALIZED", "CONFERENCE_CANCELLED"];

const MENSAGENS_CONFLITO: Record<string, string> = {
  item_alterado_no_servidor: "Este item foi alterado em outro aparelho depois da sua contagem.",
  CR002: "A conferência já foi encerrada no servidor.",
  CR004: "A conferência já foi encerrada no servidor; o item não pode mais ser alterado.",
  CR006: "A conferência foi cancelada no servidor.",
  CR008: "A conferência já foi finalizada no servidor; não pode ser cancelada.",
  CR012: "A conferência está pausada no servidor.",
  CR013: "Este material já faz parte da conferência no servidor.",
  CR014: "A conferência mudou no servidor.",
  CR015: "Já existe outra conferência aberta nesta lista (criada em outro aparelho).",
  CR016: "A conferência foi excluída no servidor.",
  CR017: "O item não faz parte desta conferência no servidor.",
  "23505": "Registro duplicado no servidor.",
};

function uuid() {
  return crypto.randomUUID();
}

function maiorTxid(a: string, b: string) {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

export class MotorSync {
  private ouvintes = new Set<(r: Resumo) => void>();
  private resumoAtual: Resumo = {
    estado: "ONLINE",
    pendentes: 0,
    atencao: 0,
    conflitos: 0,
    progresso: null,
    ultimaSincronizacao: null,
    ultimoErro: null,
  };
  private emAndamento: Promise<ResultadoSync> | null = null;
  private sincronizando = false;
  private semRede = false;
  private encerrado = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private agendado: ReturnType<typeof setTimeout> | null = null;
  private desligar: (() => void)[] = [];
  private logsGravados = 0;
  private readonly o: Required<Omit<OpcoesMotor, "fabrica">> & { fabrica?: IDBFactory };

  private constructor(
    readonly sessao: Sessao,
    private readonly banco: BancoLocal,
    private readonly transporte: Transporte,
    opcoes: OpcoesMotor,
  ) {
    this.o = {
      agora: () => new Date(),
      automatico: false,
      limiteFalhas: 8,
      loteEnvio: 50,
      lotePull: 500,
      backoffBaseMs: 2_000,
      backoffMaxMs: 5 * 60_000,
      aleatorio: Math.random,
      online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      gerarId: uuid,
      ...opcoes,
    };
  }

  /** Abre o motor do usuário. Cada usuário tem o seu próprio banco local. */
  static async abrir(sessao: Sessao, transporte: Transporte, opcoes: OpcoesMotor = {}) {
    const banco = await BancoLocal.abrir(sessao.userId, opcoes.fabrica);
    const motor = new MotorSync(sessao, banco, transporte, opcoes);
    const recuperados = await banco.transacao(
      ["fila", "sessao", "fotos"],
      "readwrite",
      async (t) => {
        // Recuperação após fechamento: o que estava "enviando" volta para a fila. O reenvio usa
        // o mesmo event_id, então se o servidor já tinha aplicado, responde "duplicado".
        const presos = await t.porIndice<ItemFila>("fila", "status", "SYNCING");
        for (const f of presos) await t.put("fila", { ...f, status: "PENDING" });
        for (const foto of await t.porIndice<FotoLocal>("fotos", "status", "enviando")) {
          await t.put("fotos", { ...foto, status: "pendente_upload" });
        }
        // Sessão local SEM tokens: apenas identificação do usuário/empresa/aparelho.
        await t.put("sessao", {
          chave: "atual",
          userId: sessao.userId,
          empresaId: sessao.empresaId,
          deviceId: sessao.deviceId,
          aberta_em: motor.agoraIso(),
        });
        return presos.length;
      },
    );
    await motor.log("info", "motor_aberto", { recuperados });
    await motor.atualizarResumo();
    if (motor.o.automatico) motor.ligarAutomatico();
    return motor;
  }

  // ---------------------------------------------------------------------------------------
  // Estado / observadores
  // ---------------------------------------------------------------------------------------

  resumo() {
    return this.resumoAtual;
  }

  observar(fn: (r: Resumo) => void) {
    this.ouvintes.add(fn);
    fn(this.resumoAtual);
    return () => {
      this.ouvintes.delete(fn);
    };
  }

  private emitir(parcial: Partial<Resumo>) {
    const r = { ...this.resumoAtual, ...parcial };
    r.estado = this.sincronizando
      ? "SYNCING"
      : this.semRede || !this.o.online()
        ? "OFFLINE"
        : r.atencao + r.conflitos > 0
          ? "ERROR"
          : "ONLINE";
    this.resumoAtual = r;
    for (const fn of this.ouvintes) {
      try {
        fn(r);
      } catch {
        /* ouvinte com erro não derruba o motor */
      }
    }
  }

  async atualizarResumo() {
    const contagem = await this.banco.transacao(
      ["fila", "sincronizacao"],
      "readonly",
      async (t) => {
        const n = (s: string) => t.contar("fila", "status", s);
        const ultima = await t.get<{ valor: string }>("sincronizacao", "ultima");
        return {
          pendentes: (await n("PENDING")) + (await n("SYNCING")) + (await n("FAILED")),
          atencao: await n("NEEDS_ATTENTION"),
          conflitos: await n("CONFLICT"),
          ultimaSincronizacao: ultima?.valor ?? null,
        };
      },
    );
    this.emitir(contagem);
    return contagem;
  }

  private agoraIso() {
    return this.o.agora().toISOString();
  }

  async log(nivel: RegistroLog["nivel"], acao: string, dados: unknown = null) {
    try {
      await this.banco.gravar("logs", {
        em: this.agoraIso(),
        nivel,
        acao,
        dados: sanitizar(dados),
      });
      this.logsGravados++;
      if (this.logsGravados % 200 === 0) await this.podarLogs();
    } catch {
      /* log nunca pode impedir a operação */
    }
  }

  private async podarLogs() {
    await this.banco.transacao(["logs"], "readwrite", async (t) => {
      const todos = await t.todos<RegistroLog>("logs");
      const excesso = todos.length - LIMITE_LOGS;
      for (let i = 0; i < excesso; i++) await t.delete("logs", todos[i].n!);
    });
  }

  logs() {
    return this.banco.todos<RegistroLog>("logs");
  }

  // ---------------------------------------------------------------------------------------
  // Consultas locais (funcionam offline)
  // ---------------------------------------------------------------------------------------

  unidades() {
    return this.banco.todos<Record<string, unknown>>("unidades");
  }
  materiais(unidadeId: string) {
    return this.banco.porIndice<Record<string, unknown>>("materiais", "unidade_id", unidadeId);
  }
  conferencias() {
    return this.banco.todos<ConferenciaLocal>("conferencias");
  }
  conferencia(id: string) {
    return this.banco.ler<ConferenciaLocal>("conferencias", id);
  }
  async itens(conferenciaId: string) {
    const itens = await this.banco.porIndice<ItemLocal>("itens", "conferencia_id", conferenciaId);
    return itens.sort((a, b) => String(a.codigo ?? "").localeCompare(String(b.codigo ?? "")));
  }
  item(k: string) {
    return this.banco.ler<ItemLocal>("itens", k);
  }
  fotos(conferenciaId: string) {
    return this.banco.porIndice<FotoLocal>("fotos", "conferencia_id", conferenciaId);
  }
  eventos(conferenciaId: string) {
    return this.banco.porIndice<Evento>("eventos", "conference_id", conferenciaId);
  }
  async fila(status?: ItemFila["status"]) {
    const itens = status
      ? await this.banco.porIndice<ItemFila>("fila", "status", status)
      : await this.banco.todos<ItemFila>("fila");
    return itens.sort((a, b) => a.seq - b.seq);
  }
  /** Itens que precisam de decisão do usuário (painel "Há alterações que precisam de atenção."). */
  async pendenciasAtencao() {
    const [a, c] = await Promise.all([this.fila("NEEDS_ATTENTION"), this.fila("CONFLICT")]);
    return [...a, ...c].sort((x, y) => x.seq - y.seq);
  }

  // ---------------------------------------------------------------------------------------
  // Operações locais (offline-first)
  // ---------------------------------------------------------------------------------------

  private async proximoSeq(t: Transacao) {
    const atual =
      (await t.get<{ chave: string; valor: number }>("sincronizacao", "seq"))?.valor ?? 0;
    await t.put("sincronizacao", { chave: "seq", valor: atual + 1 });
    return atual + 1;
  }

  /**
   * Grava o evento, a entrada na fila e o efeito na tela numa única transação.
   * `efeito` valida as regras locais e altera conferência/itens; se lançar, nada é gravado.
   */
  private async registrar(
    conferenciaId: string,
    tipo: TipoEvento,
    payload: Record<string, unknown>,
    efeito: (t: Transacao, e: ItemFila) => Promise<void>,
    extra: { alvo_k?: string | null; aguarda_foto?: string | null; empresaId?: string | null } = {},
  ) {
    if (this.encerrado) throw new ErroRegra("Sessão encerrada.");
    const eventId = this.o.gerarId();
    const agora = this.agoraIso();
    await this.banco.transacao([...STORES_OPERACAO], "readwrite", async (t) => {
      const seq = await this.proximoSeq(t);
      const f: ItemFila = {
        event_id: eventId,
        seq,
        conference_id: conferenciaId,
        event_type: tipo,
        status: "PENDING",
        tentativas: 0,
        falhas_rede: 0,
        created_at: agora,
        last_attempt_at: null,
        next_attempt_at: null,
        error_code: null,
        error_message: null,
        payload,
        alvo_k: extra.alvo_k ?? null,
        resposta: null,
        txid: null,
        refletido: false,
        aguarda_foto: extra.aguarda_foto ?? null,
        resolucao: null,
      };
      await efeito(t, f);
      const evento: Evento = {
        event_id: eventId,
        conference_id: conferenciaId,
        device_id: this.sessao.deviceId,
        user_id: this.sessao.userId,
        company_id: extra.empresaId ?? this.sessao.empresaId,
        event_type: tipo,
        created_at_device: agora,
        schema_version: VERSAO_EVENTO,
        // Cópia de auditoria sem imagens (a imagem fica só na fila até ser confirmada).
        payload: sanitizarPayloadAuditoria(payload),
        seq,
      };
      await t.put("eventos", evento);
      await t.put("fila", f);
    });
    await this.log("info", "evento_local", { event_id: eventId, tipo, conferencia: conferenciaId });
    // Contagem incremental (O(1)); a contagem completa é refeita a cada sincronização.
    this.emitir({ pendentes: this.resumoAtual.pendentes + 1 });
    this.agendar();
    return eventId;
  }

  private async exigirAberta(t: Transacao, conferenciaId: string) {
    const c = await t.get<ConferenciaLocal>("conferencias", conferenciaId);
    if (!c) throw new ErroRegra("Conferência não encontrada neste aparelho.");
    if (encerrada(c.status)) throw new ErroRegra("Esta conferência já foi encerrada.");
    return c;
  }

  private async empresaDaUnidade(unidadeId: string) {
    const u = await this.banco.ler<Record<string, unknown>>("unidades", unidadeId);
    return (u?.empresa_id as string | null | undefined) ?? this.sessao.empresaId;
  }

  /** Inicia uma conferência (offline inclusive), com os itens da lista guardada no aparelho. */
  async criarConferencia(dados: {
    unidade_id: string;
    conferente?: string | null;
    responsavel?: string | null;
    almoxarife?: string | null;
    codigo_almoxarife?: string | null;
    tipo?: string | null;
  }) {
    const id = this.o.gerarId();
    const empresaId = await this.empresaDaUnidade(dados.unidade_id);
    const payload: Record<string, unknown> = { ...dados };
    await this.registrar(
      id,
      "CONFERENCE_CREATED",
      payload,
      async (t, f) => {
        const unidade = await t.get<Record<string, unknown>>("unidades", dados.unidade_id);
        if (!unidade)
          throw new ErroRegra(
            "Lista não disponível neste aparelho. Sincronize com internet primeiro.",
          );
        const abertas = await t.todos<ConferenciaLocal>("conferencias");
        if (abertas.some((c) => c.unidade_id === dados.unidade_id && !encerrada(c.status))) {
          throw new ErroRegra("Já existe uma conferência aberta nesta lista.");
        }
        const materiais = await this.materiaisNaTransacao(t, dados.unidade_id);
        if (materiais.length === 0) throw new ErroRegra("Cadastre materiais antes de iniciar.");
        const inicial: EstadoConferencia = {
          unidade_id: dados.unidade_id,
          status: "em_andamento",
          hora_inicio: f.created_at,
          hora_fim: null,
          total_tempo_pausado: 0,
          quantidade_pausas: 0,
          ultima_pausa: null,
          ultima_retomada: null,
          tempo_trabalhado: null,
          conferente: dados.conferente ?? null,
          responsavel: dados.responsavel ?? (unidade.gestor as string | null) ?? null,
          observacoes: null,
          motivo_cancelamento: null,
          tem_assinatura: false,
          tem_assinatura_gestor: false,
        };
        await t.put("conferencias", {
          id,
          ...inicial,
          servidor: null,
          inicial,
          removida_no_servidor: false,
          pendente: true,
        } satisfies ConferenciaLocal);
        for (const m of materiais) {
          const est: EstadoItem = {
            id: null,
            material_id: String(m.id),
            codigo: (m.codigo as string) ?? null,
            descricao: (m.descricao as string) ?? null,
            locacao: (m.locacao as string) ?? null,
            quantidade_esperada: Number(m.quantidade_esperada ?? 0),
            quantidade_contada: null,
            status: "pendente",
            observacoes: null,
            origem: "lista",
            motivo_inclusao: null,
            versao: 0,
          };
          await t.put("itens", {
            k: chaveItem(id, est.material_id, null),
            conferencia_id: id,
            ...est,
            servidor: null,
            inicial: est,
            removido_no_servidor: false,
            pendente: false,
          } satisfies ItemLocal);
        }
      },
      { empresaId },
    );
    return id;
  }

  private materiaisNaTransacao(t: Transacao, unidadeId: string) {
    return t.porIndice<Record<string, unknown>>("materiais", "unidade_id", unidadeId);
  }

  /** Registra a contagem (ou a correção) de um item. `quantidade = null` volta o item a pendente. */
  async contarItem(
    conferenciaId: string,
    k: string,
    quantidade: number | null,
    observacoes?: string | null,
  ) {
    if (quantidade !== null && (!Number.isFinite(quantidade) || quantidade < 0)) {
      throw new ErroRegra("Quantidade inválida.");
    }
    const item = await this.item(k);
    if (!item || item.conferencia_id !== conferenciaId)
      throw new ErroRegra("Item não encontrado nesta conferência.");
    const payload: Record<string, unknown> = {
      ...(item.id ? { item_id: item.id } : { material_id: item.material_id }),
      quantidade,
      versao_base: item.versao,
    };
    if (observacoes !== undefined) payload.observacoes = observacoes;
    return this.registrar(
      conferenciaId,
      "ITEM_COUNTED",
      payload,
      async (t, f) => {
        await this.exigirAberta(t, conferenciaId);
        const atual = await t.get<ItemLocal>("itens", k);
        if (!atual) throw new ErroRegra("Item não encontrado nesta conferência.");
        await t.put("itens", { ...atual, ...aplicarNoItem(atual, f), pendente: true });
      },
      { alvo_k: k },
    );
  }

  /** Inclui na conferência um material que não estava na lista (idempotente pelo item_id local). */
  async adicionarMaterial(
    conferenciaId: string,
    dados: {
      material_id?: string | null;
      codigo: string;
      descricao: string;
      quantidade: number;
      motivo: string;
      locacao?: string | null;
      observacoes?: string | null;
      incluido_por_nome?: string | null;
    },
  ) {
    const codigo = dados.codigo.trim();
    const descricao = dados.descricao.trim();
    const motivo = dados.motivo.trim();
    if (!codigo) throw new ErroRegra("Informe o código do material");
    if (!descricao) throw new ErroRegra("Informe a descrição do material");
    if (!motivo) throw new ErroRegra("Informe o motivo da inclusão");
    if (!Number.isFinite(dados.quantidade) || dados.quantidade <= 0)
      throw new ErroRegra("Informe a quantidade encontrada");
    const itemId = this.o.gerarId();
    const materialId = dados.material_id ?? null;
    let esperada = 0;
    if (materialId) {
      const m = await this.banco.ler<Record<string, unknown>>("materiais", materialId);
      esperada = Number(m?.quantidade_esperada ?? 0);
    }
    const k = chaveItem(conferenciaId, materialId, itemId);
    await this.registrar(
      conferenciaId,
      "MATERIAL_ADDED",
      { ...dados, codigo, descricao, motivo, item_id: itemId, material_id: materialId },
      async (t) => {
        const c = await this.exigirAberta(t, conferenciaId);
        if (c.status === "pausada")
          throw new ErroRegra("Conferência pausada: retome para incluir materiais.");
        const itens = await t.porIndice<ItemLocal>("itens", "conferencia_id", conferenciaId);
        if (
          itens.some(
            (i) =>
              (materialId && i.material_id === materialId) ||
              String(i.codigo ?? "")
                .trim()
                .toUpperCase() === codigo.toUpperCase(),
          )
        ) {
          throw new ErroRegra("Este material já faz parte desta conferência.");
        }
        const est: EstadoItem = {
          id: itemId,
          material_id: materialId,
          codigo,
          descricao,
          locacao: dados.locacao ?? null,
          quantidade_esperada: esperada,
          quantidade_contada: dados.quantidade,
          status: statusItem(dados.quantidade, esperada),
          observacoes: dados.observacoes ?? null,
          origem: "adicionado",
          motivo_inclusao: motivo,
          versao: 0,
        };
        await t.put("itens", {
          k,
          conferencia_id: conferenciaId,
          ...est,
          servidor: null,
          inicial: est,
          removido_no_servidor: false,
          pendente: true,
        } satisfies ItemLocal);
      },
      { alvo_k: k },
    );
    return k;
  }

  private operacaoConferencia(
    conferenciaId: string,
    tipo: TipoEvento,
    payload: Record<string, unknown>,
    validar: (c: ConferenciaLocal) => void,
  ) {
    return this.registrar(conferenciaId, tipo, payload, async (t, f) => {
      const c = await t.get<ConferenciaLocal>("conferencias", conferenciaId);
      if (!c) throw new ErroRegra("Conferência não encontrada neste aparelho.");
      validar(c);
      await t.put("conferencias", { ...c, ...aplicarNaConferencia(c, f), pendente: true });
    });
  }

  pausar(conferenciaId: string) {
    return this.operacaoConferencia(conferenciaId, "CONFERENCE_PAUSED", {}, (c) => {
      if (encerrada(c.status)) throw new ErroRegra("Esta conferência já foi encerrada.");
      if (c.status === "pausada") throw new ErroRegra("A conferência já está pausada.");
    });
  }

  retomar(conferenciaId: string) {
    return this.operacaoConferencia(conferenciaId, "CONFERENCE_RESUMED", {}, (c) => {
      if (encerrada(c.status)) throw new ErroRegra("Esta conferência já foi encerrada.");
      if (c.status !== "pausada") throw new ErroRegra("A conferência não está pausada.");
    });
  }

  /** Assinatura: operação crítica, vai para a fila como qualquer evento (nunca é perdida). */
  assinar(conferenciaId: string, imagem: string, tipo: "conferente" | "gestor" = "conferente") {
    if (
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imagem) ||
      imagem.length > 700_000
    ) {
      throw new ErroRegra("Assinatura inválida.");
    }
    return this.operacaoConferencia(conferenciaId, "SIGNATURE_ADDED", { tipo, imagem }, (c) => {
      if (encerrada(c.status)) throw new ErroRegra("Esta conferência já foi encerrada.");
    });
  }

  finalizar(
    conferenciaId: string,
    dados: {
      conferente?: string | null;
      responsavel?: string | null;
      observacoes?: string | null;
    } = {},
  ) {
    return this.operacaoConferencia(conferenciaId, "CONFERENCE_FINALIZED", { ...dados }, (c) => {
      if (c.status === "cancelada")
        throw new ErroRegra("Conferência cancelada não pode ser finalizada.");
      if (encerrada(c.status)) throw new ErroRegra("Esta conferência já foi finalizada.");
      if (!c.tem_assinatura)
        throw new ErroRegra("A assinatura do conferente é obrigatória para finalizar.");
    });
  }

  cancelar(conferenciaId: string, motivo: string) {
    const m = motivo.trim();
    return this.operacaoConferencia(conferenciaId, "CONFERENCE_CANCELLED", { motivo: m }, (c) => {
      if (c.status === "finalizada" || c.status === "concluida") {
        throw new ErroRegra("Conferência finalizada não pode ser cancelada.");
      }
      if (c.status === "cancelada") throw new ErroRegra("Esta conferência já foi cancelada.");
      if (m.length < 3) throw new ErroRegra("Informe o motivo do cancelamento.");
    });
  }

  /**
   * Foto: fica guardada no aparelho até o servidor confirmar. Primeiro vai o arquivo para o
   * Storage (caminho único por foto), depois o evento PHOTO_ADDED.
   */
  async adicionarFoto(
    conferenciaId: string,
    k: string | null,
    arquivo: ArrayBuffer,
    mime: "image/jpeg" | "image/png" | "image/webp",
    dim: { largura?: number | null; altura?: number | null } = {},
  ) {
    if (arquivo.byteLength === 0 || arquivo.byteLength > 5 * 1024 * 1024) {
      throw new ErroRegra("A foto deve ter até 5 MB.");
    }
    const c = await this.conferencia(conferenciaId);
    if (!c) throw new ErroRegra("Conferência não encontrada neste aparelho.");
    const empresaId = await this.empresaDaUnidade(c.unidade_id);
    if (!empresaId)
      throw new ErroRegra("Esta lista não está vinculada a uma empresa; fotos indisponíveis.");
    const item = k ? await this.item(k) : null;
    if (k && !item) throw new ErroRegra("Item não encontrado nesta conferência.");
    const fotoId = this.o.gerarId();
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const caminho = `${empresaId}/${conferenciaId}/${fotoId}.${ext}`;
    const payload: Record<string, unknown> = {
      foto_id: fotoId,
      caminho,
      mime,
      bytes: arquivo.byteLength,
      largura: dim.largura ?? null,
      altura: dim.altura ?? null,
    };
    if (item)
      Object.assign(payload, item.id ? { item_id: item.id } : { material_id: item.material_id });
    await this.registrar(
      conferenciaId,
      "PHOTO_ADDED",
      payload,
      async (t, f) => {
        await this.exigirAberta(t, conferenciaId);
        await t.put("fotos", {
          id: fotoId,
          conferencia_id: conferenciaId,
          empresa_id: empresaId,
          usuario_id: this.sessao.userId,
          evento_id: f.event_id,
          item_k: k,
          caminho,
          mime,
          bytes: arquivo.byteLength,
          arquivo,
          largura: dim.largura ?? null,
          altura: dim.altura ?? null,
          status: "pendente_upload",
          tentativas: 0,
          erro: null,
          criada_em: f.created_at,
        } satisfies FotoLocal);
      },
      { alvo_k: k, aguarda_foto: fotoId, empresaId },
    );
    return fotoId;
  }

  // ---------------------------------------------------------------------------------------
  // Decisões do usuário (conflitos / atenção)
  // ---------------------------------------------------------------------------------------

  async resolver(eventId: string, decisao: Decisao) {
    const f = await this.banco.ler<ItemFila>("fila", eventId);
    if (!f) throw new ErroRegra("Operação não encontrada.");
    if (f.status !== "CONFLICT" && f.status !== "NEEDS_ATTENTION" && f.status !== "FAILED") {
      throw new ErroRegra("Esta operação não precisa de decisão.");
    }
    const agora = this.agoraIso();
    if (decisao === "tentar_novamente") {
      await this.banco.gravar("fila", {
        ...f,
        status: "PENDING",
        tentativas: 0,
        next_attempt_at: null,
      } satisfies ItemFila);
      await this.log("info", "decisao", { event_id: eventId, decisao });
      await this.atualizarResumo();
      this.agendar();
      return null;
    }

    if (decisao === "manter_local") {
      // Só faz sentido para contagem: reenvia a MESMA intenção como novo evento, com "forcar".
      if (f.event_type !== "ITEM_COUNTED" || f.status !== "CONFLICT") {
        throw new ErroRegra(
          "Para esta operação só é possível usar a versão do servidor ou tentar novamente.",
        );
      }
      const servidor = (f.resposta?.estado_servidor ?? {}) as Record<string, unknown>;
      const novoId = this.o.gerarId();
      await this.banco.transacao([...STORES_OPERACAO], "readwrite", async (t) => {
        const seq = await this.proximoSeq(t);
        const payload = {
          ...f.payload,
          ...(f.resposta?.item_id ? { item_id: f.resposta.item_id } : {}),
          versao_base: Number(servidor.versao ?? f.payload.versao_base ?? 0),
          forcar: true,
        };
        const novo: ItemFila = {
          ...f,
          event_id: novoId,
          seq,
          status: "PENDING",
          tentativas: 0,
          falhas_rede: 0,
          created_at: agora,
          last_attempt_at: null,
          next_attempt_at: null,
          error_code: null,
          error_message: null,
          payload,
          resposta: null,
          txid: null,
          refletido: false,
          resolucao: null,
        };
        await t.put("fila", novo);
        await t.put("eventos", {
          event_id: novoId,
          conference_id: f.conference_id,
          device_id: this.sessao.deviceId,
          user_id: this.sessao.userId,
          company_id: this.sessao.empresaId,
          event_type: f.event_type,
          created_at_device: agora,
          schema_version: VERSAO_EVENTO,
          payload: sanitizarPayloadAuditoria(payload),
          seq,
        } satisfies Evento);
        await t.put("fila", {
          ...f,
          status: "RESOLVED",
          resolucao: { decisao, em: agora, novo_evento: novoId },
        });
        await this.recalcular(t, f.conference_id);
      });
      await this.log("info", "decisao", { event_id: eventId, decisao, novo_evento: novoId });
      await this.atualizarResumo();
      this.agendar();
      return novoId;
    }

    // usar_servidor: descarta o efeito local DESTA operação por decisão explícita (fica registrado).
    await this.banco.transacao([...STORES_OPERACAO], "readwrite", async (t) => {
      const alvo = [f];
      if (f.event_type === "CONFERENCE_CREATED") {
        // Sem a criação, nenhuma operação posterior desta conferência pode ser aplicada.
        const todas = await t.porIndice<ItemFila>("fila", "conference_id", f.conference_id);
        alvo.push(
          ...todas.filter((x) => x.event_id !== f.event_id && ABERTOS.includes(x.status as never)),
        );
      }
      for (const x of alvo) {
        await t.put("fila", { ...x, status: "RESOLVED", resolucao: { decisao, em: agora } });
        if (x.aguarda_foto) {
          const foto = await t.get<FotoLocal>("fotos", x.aguarda_foto);
          if (foto)
            await t.put("fotos", {
              ...foto,
              status: "erro",
              erro: "Descartada por decisão do usuário",
            });
        }
      }
      await this.recalcular(t, f.conference_id);
    });
    await this.log("aviso", "decisao", { event_id: eventId, decisao, tipo: f.event_type });
    await this.atualizarResumo();
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Projeção (servidor + eventos pendentes)
  // ---------------------------------------------------------------------------------------

  /** Recalcula conferência e itens a partir do servidor + eventos ainda não refletidos. */
  private async recalcular(t: Transacao, conferenciaId: string, somenteItens?: Set<string>) {
    const eventos = (await t.porIndice<ItemFila>("fila", "conference_id", conferenciaId)).sort(
      (a, b) => a.seq - b.seq,
    );
    const ativos = eventos.filter(reaplicavel);
    const c = await t.get<ConferenciaLocal>("conferencias", conferenciaId);
    if (c && !somenteItens) {
      const base = c.servidor ? conferenciaDoServidor(c.servidor) : c.inicial;
      if (!c.servidor) {
        const criacao = eventos.find(
          (e) => e.event_type === "CONFERENCE_CREATED" && e.status !== "RESOLVED",
        );
        if (!criacao && (!c.removida_no_servidor || ativos.length === 0)) {
          // Criação descartada por decisão do usuário (ou conferência removida sem pendências): sai da tela.
          await t.delete("conferencias", conferenciaId);
          for (const i of await t.porIndice<ItemLocal>("itens", "conferencia_id", conferenciaId))
            await t.delete("itens", i.k);
          return;
        }
      }
      if (base) {
        let est = base;
        for (const e of ativos) est = aplicarNaConferencia(est, e);
        await t.put("conferencias", { ...c, ...est, pendente: ativos.length > 0 });
      }
    }
    const porItem = new Map<string, ItemFila[]>();
    const versoes = new Map<string, number>();
    for (const e of eventos) {
      if (!e.alvo_k) continue;
      if (reaplicavel(e)) porItem.set(e.alvo_k, [...(porItem.get(e.alvo_k) ?? []), e]);
      const v = Number(e.resposta?.versao ?? NaN);
      if (e.status === "SYNCED" && Number.isFinite(v))
        versoes.set(e.alvo_k, Math.max(versoes.get(e.alvo_k) ?? 0, v));
    }
    const itens = await t.porIndice<ItemLocal>("itens", "conferencia_id", conferenciaId);
    for (const i of itens) {
      if (somenteItens && !somenteItens.has(i.k)) continue;
      const base = i.servidor ? itemDoServidor(i.servidor) : i.inicial;
      const evs = porItem.get(i.k) ?? [];
      // Material incluído no aparelho cuja inclusão foi descartada por decisão do usuário.
      const inclusaoDescartada =
        !i.servidor &&
        i.origem === "adicionado" &&
        !evs.some((e) => e.event_type === "MATERIAL_ADDED");
      if (!base || inclusaoDescartada || (i.removido_no_servidor && evs.length === 0)) {
        await t.delete("itens", i.k);
        continue;
      }
      let est = base;
      for (const e of evs) est = aplicarNoItem(est, e);
      await t.put("itens", {
        ...i,
        ...est,
        versao: Math.max(base.versao, versoes.get(i.k) ?? 0),
        pendente: evs.length > 0,
      });
    }
  }

  // ---------------------------------------------------------------------------------------
  // Sincronização
  // ---------------------------------------------------------------------------------------

  /** "SINCRONIZAR AGORA": envia tudo (ignorando o backoff) e recebe as alterações do servidor. */
  sincronizarAgora() {
    return this.sincronizar({ forcar: true });
  }

  sincronizar(opcoes: { forcar?: boolean } = {}): Promise<ResultadoSync> {
    if (this.emAndamento) return this.emAndamento;
    this.emAndamento = this.executarSync(Boolean(opcoes.forcar)).finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  private async executarSync(forcar: boolean): Promise<ResultadoSync> {
    if (this.encerrado) throw new ErroRegra("Sessão encerrada.");
    this.sincronizando = true;
    this.emitir({ progresso: { total: 0, feitos: 0 }, ultimoErro: null });
    let enviados = 0;
    let recebidos = 0;
    let rede = false;
    try {
      if (!this.o.online()) throw new ErroRede(undefined, "offline");
      enviados = await this.enviar(forcar);
      recebidos = await this.receber();
      // Eventos liberados pelo pull (ex.: conferência criada confirmada) — segunda rodada.
      enviados += await this.enviar(forcar);
      this.semRede = false;
      await this.banco.gravar("sincronizacao", { chave: "ultima", valor: this.agoraIso() });
    } catch (e) {
      if (e instanceof ErroRede) {
        rede = true;
        this.semRede = true;
        await this.log("aviso", "sem_rede", { motivo: e.motivo });
      } else {
        await this.log("erro", "falha_sync", e);
        this.emitir({ ultimoErro: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      this.sincronizando = false;
    }
    const r = await this.atualizarResumo();
    this.emitir({ progresso: null });
    const precisaAtencao = r.atencao + r.conflitos > 0;
    const falhou = !rede && this.resumoAtual.ultimoErro !== null;
    const mensagem = rede
      ? MENSAGEM_SEM_REDE
      : precisaAtencao || falhou
        ? MENSAGEM_ATENCAO
        : r.pendentes > 0
          ? `Sincronização parcial: ${r.pendentes} alteração(ões) aguardando nova tentativa.`
          : MENSAGEM_CONCLUIDA;
    await this.log("info", "sync", {
      enviados,
      recebidos,
      pendentes: r.pendentes,
      atencao: r.atencao + r.conflitos,
      rede,
    });
    return {
      ok: !rede && !precisaAtencao && !falhou && r.pendentes === 0,
      mensagem,
      enviados,
      recebidos,
      pendentes: r.pendentes,
      atencao: r.atencao + r.conflitos,
    };
  }

  private backoff(n: number) {
    const base = Math.min(this.o.backoffMaxMs, this.o.backoffBaseMs * 2 ** Math.max(0, n - 1));
    const jitter = base * 0.2 * this.o.aleatorio();
    return new Date(this.o.agora().getTime() + base + jitter).toISOString();
  }

  private async carregarAbertos() {
    return this.banco.transacao(["fila"], "readonly", async (t) => {
      const todos: ItemFila[] = [];
      for (const s of ABERTOS) todos.push(...(await t.porIndice<ItemFila>("fila", "status", s)));
      return todos.sort((a, b) => a.seq - b.seq);
    });
  }

  /** Seleciona o próximo lote respeitando a ordem por conferência e as barreiras. */
  private selecionarLote(abertos: ItemFila[], forcar: boolean, tentados: Set<string>) {
    const agora = this.o.agora().getTime();
    const porConf = new Map<string, { bloqueada: boolean; noLote: number }>();
    const lote: ItemFila[] = [];
    let restantes = 0;
    for (const f of abertos) {
      if (f.status === "SYNCED" || f.status === "RESOLVED") continue;
      let st = porConf.get(f.conference_id);
      if (!st) porConf.set(f.conference_id, (st = { bloqueada: false, noLote: 0 }));
      if (f.status !== "CONFLICT" && f.status !== "NEEDS_ATTENTION") restantes++;
      if (st.bloqueada) continue;
      // Um evento já tentado nesta sincronização não é repetido nela (evita laço com o servidor).
      const pronto =
        !tentados.has(f.event_id) &&
        (f.status === "PENDING" ||
          f.status === "SYNCING" ||
          (f.status === "FAILED" &&
            (forcar || !f.next_attempt_at || Date.parse(f.next_attempt_at) <= agora)));
      if (!pronto) {
        st.bloqueada = true; // ordem por conferência: nada passa na frente
        continue;
      }
      const barreira = BARREIRAS.includes(f.event_type) || f.aguarda_foto !== null;
      if (barreira && st.noLote > 0) {
        st.bloqueada = true; // só vai quando tudo antes estiver confirmado
        continue;
      }
      if (lote.length >= this.o.loteEnvio) continue;
      lote.push(f);
      st.noLote++;
      if (barreira) st.bloqueada = true;
    }
    return { lote, restantes };
  }

  private paraServidor(f: ItemFila, ev: Evento | undefined): Record<string, unknown> {
    return {
      event_id: f.event_id,
      conference_id: f.conference_id,
      device_id: this.sessao.deviceId,
      user_id: this.sessao.userId,
      company_id: ev?.company_id ?? this.sessao.empresaId,
      event_type: f.event_type,
      created_at_device: f.created_at,
      schema_version: VERSAO_EVENTO,
      payload: f.payload,
    };
  }

  private async enviar(forcar: boolean) {
    let enviados = 0;
    let feitos = 0;
    // A lista é lida uma vez; cada rodada atualiza em memória só o que foi enviado.
    const abertos = await this.carregarAbertos();
    const indice = new Map(abertos.map((f, i) => [f.event_id, i]));
    const tentados = new Set<string>();
    const atualizar = async (ids: string[]) => {
      const novos = await this.banco.transacao(["fila"], "readonly", async (t) =>
        Promise.all(ids.map((id) => t.get<ItemFila>("fila", id))),
      );
      for (const f of novos) {
        if (!f || !indice.has(f.event_id)) continue;
        abertos[indice.get(f.event_id)!] = f;
        if (f.status === "PENDING") tentados.delete(f.event_id); // lote interrompido: pode ir de novo
      }
    };
    for (let rodada = 0; rodada < 100_000; rodada++) {
      const { lote: candidatos, restantes } = this.selecionarLote(abertos, forcar, tentados);
      if (candidatos.length === 0) break;
      const totalAbertos = restantes;
      for (const f of candidatos) tentados.add(f.event_id);
      this.emitir({ progresso: { total: feitos + totalAbertos, feitos } });

      // 1) Fotos: o arquivo sobe antes do evento. Falha de rede interrompe tudo.
      const lote: ItemFila[] = [];
      const excluidas = new Set<string>();
      for (const f of candidatos) {
        if (excluidas.has(f.conference_id)) continue;
        if (f.aguarda_foto) {
          const ok = await this.subirFoto(f);
          if (!ok) {
            excluidas.add(f.conference_id);
            continue;
          }
        }
        lote.push(f);
      }
      if (lote.length === 0) {
        await atualizar(candidatos.map((f) => f.event_id));
        continue;
      }

      // 2) Marca "enviando" (se o app fechar agora, volta para PENDING na abertura).
      const agora = this.agoraIso();
      const eventos = await this.banco.transacao(["fila", "eventos"], "readwrite", async (t) => {
        const evs: Evento[] = [];
        for (const f of lote) {
          await t.put("fila", { ...f, status: "SYNCING", last_attempt_at: agora });
          const ev = await t.get<Evento>("eventos", f.event_id);
          if (ev) evs.push(ev);
        }
        return evs;
      });
      const porId = new Map(eventos.map((e) => [e.event_id, e]));

      // 3) Envia. Timeout/rede: tudo volta para FAILED com o MESMO event_id.
      let resultados: ResultadoServidor[];
      try {
        resultados = await this.transporte.enviarEventos(
          lote.map((f) => this.paraServidor(f, porId.get(f.event_id))),
        );
      } catch (e) {
        await this.registrarFalhaLote(lote, e);
        if (e instanceof ErroRede) throw e;
        break; // erro de servidor: tenta mais tarde (backoff)
      }
      const mapa = new Map(resultados.map((r) => [String(r.event_id), r]));
      await this.aplicarResultados(lote, mapa);
      await atualizar(candidatos.map((f) => f.event_id));
      enviados += resultados.filter((r) => r.status === "aplicado").length;
      feitos += lote.length;
      this.emitir({
        progresso: { total: feitos + Math.max(0, totalAbertos - lote.length), feitos },
      });
    }
    return enviados;
  }

  private async subirFoto(f: ItemFila) {
    const foto = await this.banco.ler<FotoLocal>("fotos", f.aguarda_foto!);
    if (!foto) {
      await this.marcar(f, {
        status: "NEEDS_ATTENTION",
        error_code: "FOTO_AUSENTE",
        error_message: "O arquivo da foto não foi encontrado neste aparelho.",
      });
      return false;
    }
    if (foto.status === "enviada" || foto.status === "confirmada") return true;
    if (!foto.arquivo) {
      await this.marcar(f, {
        status: "NEEDS_ATTENTION",
        error_code: "FOTO_AUSENTE",
        error_message: "Arquivo da foto indisponível.",
      });
      return false;
    }
    await this.banco.gravar("fotos", { ...foto, status: "enviando" });
    try {
      await this.transporte.enviarFoto(
        foto.caminho,
        new Blob([foto.arquivo], { type: foto.mime }),
        foto.mime,
      );
      await this.banco.gravar("fotos", { ...foto, status: "enviada", erro: null });
      await this.log("info", "foto_enviada", { foto: foto.id, bytes: foto.bytes });
      return true;
    } catch (e) {
      await this.banco.gravar("fotos", {
        ...foto,
        status: "pendente_upload",
        tentativas: foto.tentativas + 1,
        erro: e instanceof Error ? e.message : String(e),
      });
      await this.registrarFalhaLote([f], e);
      if (e instanceof ErroRede) throw e;
      return false;
    }
  }

  private async marcar(f: ItemFila, patch: Partial<ItemFila>) {
    const atual = (await this.banco.ler<ItemFila>("fila", f.event_id)) ?? f;
    await this.banco.gravar("fila", { ...atual, ...patch });
  }

  private async registrarFalhaLote(lote: ItemFila[], e: unknown) {
    const rede = e instanceof ErroRede;
    const agora = this.agoraIso();
    await this.banco.transacao(["fila"], "readwrite", async (t) => {
      for (const f0 of lote) {
        const f = (await t.get<ItemFila>("fila", f0.event_id)) ?? f0;
        if (rede) {
          const n = f.falhas_rede + 1;
          await t.put("fila", {
            ...f,
            status: "FAILED",
            falhas_rede: n,
            last_attempt_at: agora,
            next_attempt_at: this.backoff(n),
            error_code: (e as ErroRede).motivo === "timeout" ? "TIMEOUT" : "SEM_REDE",
            error_message: (e as Error).message,
          } satisfies ItemFila);
        } else {
          const n = f.tentativas + 1;
          const atencao = n >= this.o.limiteFalhas || (e instanceof ErroServidor && e.definitivo);
          await t.put("fila", {
            ...f,
            status: atencao ? "NEEDS_ATTENTION" : "FAILED",
            tentativas: n,
            last_attempt_at: agora,
            next_attempt_at: atencao ? null : this.backoff(n),
            error_code: e instanceof ErroServidor ? (e.codigo ?? "ERRO_SERVIDOR") : "ERRO",
            error_message: e instanceof Error ? e.message : String(e),
          } satisfies ItemFila);
        }
      }
    });
    await this.log(rede ? "aviso" : "erro", "falha_envio", { eventos: lote.length, erro: e });
  }

  private async aplicarResultados(lote: ItemFila[], mapa: Map<string, ResultadoServidor>) {
    const agora = this.agoraIso();
    const conferencias = new Set<string>();
    await this.banco.transacao([...STORES_OPERACAO], "readwrite", async (t) => {
      for (const f0 of lote) {
        const f = (await t.get<ItemFila>("fila", f0.event_id)) ?? f0;
        const r = mapa.get(f.event_id);
        conferencias.add(f.conference_id);
        if (!r || r.status === "tentar_novamente") {
          // Não registrado no servidor (dependência ainda não sincronizada, falha transitória
          // ou lote interrompido). Reenvia depois com o mesmo event_id.
          const interrompido = r?.erro_codigo === "LOTE_INTERROMPIDO";
          const n = interrompido ? f.tentativas : f.tentativas + 1;
          const atencao = n >= this.o.limiteFalhas;
          await t.put("fila", {
            ...f,
            status: atencao ? "NEEDS_ATTENTION" : interrompido ? "PENDING" : "FAILED",
            tentativas: n,
            next_attempt_at: atencao || interrompido ? null : this.backoff(n),
            error_code: r?.erro_codigo ?? "SEM_RESPOSTA",
            error_message: r?.erro_mensagem ?? "O servidor não retornou o resultado deste evento.",
          } satisfies ItemFila);
          continue;
        }
        const base = {
          ...f,
          last_attempt_at: agora,
          resposta: r as Record<string, unknown>,
          next_attempt_at: null,
        };
        if (r.status === "aplicado") {
          await t.put("fila", {
            ...base,
            status: "SYNCED",
            txid: typeof r.txid === "string" ? r.txid : null,
            refletido: false,
            error_code: null,
            error_message: null,
          } satisfies ItemFila);
          if (f.aguarda_foto) {
            const foto = await t.get<FotoLocal>("fotos", f.aguarda_foto);
            // Confirmado pelo servidor: agora sim o arquivo local pode ser liberado.
            if (foto)
              await t.put("fotos", { ...foto, status: "confirmada", arquivo: null, erro: null });
          }
          if (f.event_type === "MATERIAL_ADDED" || f.event_type === "ITEM_COUNTED") {
            // Guarda o id/versão que o servidor atribuiu (próximas contagens usam como base).
            const i = f.alvo_k ? await t.get<ItemLocal>("itens", f.alvo_k) : undefined;
            if (i) {
              await t.put("itens", {
                ...i,
                id: i.id ?? (r.item_id as string | undefined) ?? null,
                versao: Math.max(i.versao, Number(r.versao ?? 0)),
              });
            }
          }
        } else if (r.status === "conflito") {
          const codigo = String(r.erro_codigo ?? r.motivo ?? "CONFLITO");
          await t.put("fila", {
            ...base,
            status: "CONFLICT",
            error_code: codigo,
            error_message:
              MENSAGENS_CONFLITO[codigo] ?? String(r.erro_mensagem ?? "Conflito com o servidor."),
          } satisfies ItemFila);
        } else {
          await t.put("fila", {
            ...base,
            status: "NEEDS_ATTENTION",
            tentativas: f.tentativas + 1,
            error_code: String(r.erro_codigo ?? "REJEITADO"),
            error_message: String(r.erro_mensagem ?? "O servidor recusou esta operação."),
          } satisfies ItemFila);
        }
      }
    });
    const contagem = { aplicados: 0, conflitos: 0, rejeitados: 0, repetir: 0, duplicados: 0 };
    for (const r of mapa.values()) {
      if (r.duplicado) contagem.duplicados++;
      if (r.status === "aplicado") contagem.aplicados++;
      else if (r.status === "conflito") contagem.conflitos++;
      else if (r.status === "rejeitado") contagem.rejeitados++;
      else contagem.repetir++;
    }
    await this.log(
      contagem.conflitos + contagem.rejeitados > 0 ? "aviso" : "info",
      "resultado_envio",
      contagem,
    );
  }

  // ---------------------------------------------------------------------------------------
  // Pull (servidor → aparelho)
  // ---------------------------------------------------------------------------------------

  private async receber() {
    let cursor =
      (await this.banco.ler<{ valor: string }>("sincronizacao", "cursor"))?.valor ?? null;
    let recebidos = 0;
    if (!cursor) {
      recebidos += await this.cargaInicial();
      cursor = (await this.banco.ler<{ valor: string }>("sincronizacao", "cursor"))!.valor;
    }
    for (let pagina = 0; pagina < 100_000; pagina++) {
      const r = await this.transporte.alteracoes(cursor, this.o.lotePull);
      if (r.reset) {
        await this.log("aviso", "cursor_reset", null);
        await this.banco.transacao(["sincronizacao"], "readwrite", (t) =>
          t.delete("sincronizacao", "cursor"),
        );
        recebidos += await this.cargaInicial();
        cursor = (await this.banco.ler<{ valor: string }>("sincronizacao", "cursor"))!.valor;
        continue;
      }
      recebidos += r.alteracoes.length;
      await this.aplicarAlteracoes(r.alteracoes, r.cursor, !r.mais ? (r.ate ?? null) : null);
      cursor = r.cursor;
      if (!r.mais) break;
    }
    return recebidos;
  }

  /** Carga inicial completa. Registros locais que não existem mais no servidor são removidos (sem pendências). */
  private async cargaInicial() {
    const cursor = await this.transporte.cursorInicial();
    const tabelas: TabelaSync[] = ["unidades", "materiais", "conferencias", "conferencia_itens"];
    const vistos = new Map<TabelaSync, Set<string>>();
    let total = 0;
    for (const tabela of tabelas) {
      const ids = new Set<string>();
      vistos.set(tabela, ids);
      let apos: string | null = null;
      for (;;) {
        const pagina = await this.transporte.snapshot(tabela, apos, this.o.lotePull);
        const alteracoes: Alteracao[] = pagina.linhas.map((l) => ({
          tabela,
          id: String(l.id),
          conferencia_id: (l.conferencia_id as string) ?? null,
          operacao: "upsert",
          dados: l,
        }));
        for (const a of alteracoes) ids.add(a.id);
        total += alteracoes.length;
        await this.aplicarAlteracoes(alteracoes, null, null);
        if (!pagina.proximo) break;
        apos = pagina.proximo;
      }
    }
    // Remove o que sumiu (e não tem nada pendente), depois grava o cursor.
    await this.banco.transacao([...STORES_PULL], "readwrite", async (t) => {
      const pendentes = new Set(
        (await t.todos<ItemFila>("fila")).filter(reaplicavel).map((f) => f.conference_id),
      );
      for (const u of await t.todos<{ id: string }>("unidades")) {
        if (!vistos.get("unidades")!.has(u.id)) await t.delete("unidades", u.id);
      }
      for (const m of await t.todos<{ id: string }>("materiais")) {
        if (!vistos.get("materiais")!.has(m.id)) await t.delete("materiais", m.id);
      }
      for (const c of await t.todos<ConferenciaLocal>("conferencias")) {
        if (!c.servidor || vistos.get("conferencias")!.has(c.id) || pendentes.has(c.id)) continue;
        await t.delete("conferencias", c.id);
        for (const i of await t.porIndice<ItemLocal>("itens", "conferencia_id", c.id))
          await t.delete("itens", i.k);
      }
      await t.put("sincronizacao", { chave: "cursor", valor: cursor });
    });
    await this.log("info", "carga_inicial", { registros: total });
    return total;
  }

  /** Aplica uma página de alterações e avança o cursor NA MESMA transação. */
  private async aplicarAlteracoes(
    alteracoes: Alteracao[],
    cursor: string | null,
    ate: string | null,
  ) {
    await this.banco.transacao([...STORES_PULL], "readwrite", async (t) => {
      const confs = new Map<string, Set<string> | null>(); // null = recalcular tudo
      const tocar = (conf: string, k?: string) => {
        if (!confs.has(conf)) confs.set(conf, k ? new Set([k]) : null);
        else if (k && confs.get(conf)) confs.get(conf)!.add(k);
        else if (!k) confs.set(conf, null);
      };
      for (const a of alteracoes) {
        switch (a.tabela) {
          case "unidades":
          case "materiais":
            if (a.operacao === "delete" || !a.dados) await t.delete(a.tabela, a.id);
            else await t.put(a.tabela, a.dados);
            break;
          case "conferencias": {
            const atual = await t.get<ConferenciaLocal>("conferencias", a.id);
            if (a.operacao === "delete" || !a.dados) {
              if (!atual) break;
              const pend = (await t.porIndice<ItemFila>("fila", "conference_id", a.id)).filter(
                reaplicavel,
              );
              if (pend.length === 0) {
                await t.delete("conferencias", a.id);
                for (const i of await t.porIndice<ItemLocal>("itens", "conferencia_id", a.id))
                  await t.delete("itens", i.k);
                confs.delete(a.id);
              } else {
                // Mantém o que o usuário fez: os eventos pendentes vão gerar conflito (CR016) para ele decidir.
                await t.put("conferencias", {
                  ...atual,
                  inicial: atual.servidor ? conferenciaDoServidor(atual.servidor) : atual.inicial,
                  servidor: null,
                  removida_no_servidor: true,
                });
              }
              break;
            }
            const est = conferenciaDoServidor(a.dados);
            await t.put("conferencias", {
              ...(atual ?? { inicial: null, pendente: false }),
              ...est,
              id: a.id,
              servidor: a.dados,
              removida_no_servidor: false,
            } as ConferenciaLocal);
            tocar(a.id);
            break;
          }
          case "conferencia_itens": {
            if (a.operacao === "delete" || !a.dados) {
              const locais = await t.porIndice<ItemLocal>("itens", "id", a.id);
              for (const i of locais) {
                // Guarda o último estado conhecido: se houver contagem local pendente, o item
                // continua visível até o usuário decidir o conflito (CR017).
                await t.put("itens", {
                  ...i,
                  servidor: null,
                  inicial: i.servidor ? itemDoServidor(i.servidor) : i.inicial,
                  removido_no_servidor: true,
                });
                tocar(i.conferencia_id, i.k);
              }
              break;
            }
            const conf = String(a.dados.conferencia_id);
            const k = chaveItem(conf, (a.dados.material_id as string) ?? null, a.id);
            const atual = await t.get<ItemLocal>("itens", k);
            await t.put("itens", {
              ...(atual ?? { inicial: null, pendente: false }),
              ...itemDoServidor(a.dados),
              k,
              conferencia_id: conf,
              servidor: a.dados,
              removido_no_servidor: false,
            } as ItemLocal);
            tocar(conf, k);
            break;
          }
          default:
            break; // conferencia_fotos: confirmação já vem pelo resultado do evento
        }
      }

      // Marca d'água: eventos confirmados cuja transação já foi entregue não precisam mais ser
      // reaplicados (o efeito está na linha do servidor) e saem da fila operacional. A cópia
      // de auditoria continua no store "eventos".
      if (ate) {
        for (const f of await t.porIndice<ItemFila>("fila", "status", "SYNCED")) {
          if (f.txid && !maiorTxid(ate, f.txid)) continue;
          await t.delete("fila", f.event_id);
          tocar(f.conference_id);
          if (f.aguarda_foto) {
            const foto = await t.get<FotoLocal>("fotos", f.aguarda_foto);
            if (foto?.status === "confirmada" && foto.arquivo)
              await t.put("fotos", { ...foto, arquivo: null });
          }
        }
        // Decisões do usuário já aplicadas: também saem da fila (ficam em "eventos").
        for (const f of await t.porIndice<ItemFila>("fila", "status", "RESOLVED")) {
          await t.delete("fila", f.event_id);
        }
      }
      for (const [conf, ks] of confs) await this.recalcular(t, conf, ks ?? undefined);
      if (cursor) await t.put("sincronizacao", { chave: "cursor", valor: cursor });
    });
  }

  // ---------------------------------------------------------------------------------------
  // Automático / ciclo de vida
  // ---------------------------------------------------------------------------------------

  private agendar(ms = 800) {
    if (!this.o.automatico || this.encerrado) return;
    if (this.agendado) clearTimeout(this.agendado);
    this.agendado = setTimeout(() => {
      this.agendado = null;
      if (this.o.online()) void this.sincronizar().catch(() => undefined);
    }, ms);
  }

  private ligarAutomatico() {
    const ciclo = setInterval(() => {
      if (!this.o.online() || this.encerrado) return;
      void this.sincronizar().catch(() => undefined);
    }, 30_000);
    this.timers.push(ciclo as unknown as ReturnType<typeof setTimeout>);
    if (typeof window !== "undefined") {
      const on = () => {
        this.semRede = false;
        this.emitir({});
        this.agendar(300);
      };
      const off = () => {
        this.semRede = true;
        this.emitir({});
      };
      const visivel = () => {
        if (document.visibilityState === "visible") this.agendar(300);
      };
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      document.addEventListener("visibilitychange", visivel);
      this.desligar.push(() => {
        window.removeEventListener("online", on);
        window.removeEventListener("offline", off);
        document.removeEventListener("visibilitychange", visivel);
      });
    }
    this.agendar(500);
  }

  /**
   * Encerra o motor (logout). O banco deste usuário só é apagado se não houver nada pendente:
   * alteração não enviada nunca é descartada. Em qualquer caso, outro usuário abre OUTRO banco.
   */
  async encerrar(opcoes: { apagarDados?: boolean } = {}) {
    if (this.emAndamento) await this.emAndamento.catch(() => undefined);
    this.encerrado = true;
    for (const t of this.timers) clearInterval(t as unknown as ReturnType<typeof setInterval>);
    if (this.agendado) clearTimeout(this.agendado);
    for (const d of this.desligar) d();
    this.ouvintes.clear();
    const abertos = (await this.banco.todos<ItemFila>("fila")).filter((f) =>
      ABERTOS.includes(f.status as never),
    ).length;
    const nome = this.banco.nome;
    this.banco.fechar();
    let apagado = false;
    if (opcoes.apagarDados && abertos === 0) {
      await apagarBanco(nome, this.o.fabrica);
      apagado = true;
    }
    return { apagado, pendentes: abertos };
  }
}

function sanitizarPayloadAuditoria(payload: Record<string, unknown>) {
  const copia: Record<string, unknown> = { ...payload };
  if (typeof copia.imagem === "string") {
    copia.imagem_bytes = (copia.imagem as string).length;
    delete copia.imagem;
  }
  return copia;
}
