/**
 * Notificações de conferência: registro permanente no banco, histórico de envio
 * de e-mail, modelos de mensagem e indicadores da Central Administrativa.
 */

export type TipoNotificacao =
  | "conferencia_iniciada"
  | "conferencia_concluida"
  | "divergencia_estoque"
  | "erro_conferencia"
  | "conferencia_atrasada";

export type Gravidade = "info" | "sucesso" | "critica" | "atencao";

export const TIPOS_NOTIFICACAO: {
  valor: TipoNotificacao;
  label: string;
  assunto: string;
  gravidade: Gravidade;
}[] = [
  {
    valor: "conferencia_iniciada",
    label: "Nova conferência iniciada",
    assunto: "NOVA CONFERÊNCIA INICIADA",
    gravidade: "info",
  },
  {
    valor: "conferencia_concluida",
    label: "Conferência concluída",
    assunto: "CONFERÊNCIA CONCLUÍDA",
    gravidade: "sucesso",
  },
  {
    valor: "divergencia_estoque",
    label: "Divergência de estoque",
    assunto: "ALERTA DE DIVERGÊNCIA DE ESTOQUE",
    gravidade: "critica",
  },
  {
    valor: "erro_conferencia",
    label: "Erro durante conferência",
    assunto: "ERRO DURANTE CONFERÊNCIA",
    gravidade: "critica",
  },
  {
    valor: "conferencia_atrasada",
    label: "Conferência em aberto há mais de 30 minutos",
    assunto: "CONFERÊNCIA EM ABERTO HÁ MAIS DE 30 MINUTOS",
    gravidade: "atencao",
  },
];

export function tipoInfo(t?: string | null) {
  return (
    TIPOS_NOTIFICACAO.find((x) => x.valor === t) ?? {
      valor: (t ?? "") as TipoNotificacao,
      label: t ?? "—",
      assunto: "NOTIFICAÇÃO",
      gravidade: "info" as Gravidade,
    }
  );
}

export function gravidadeClasse(g?: string | null) {
  if (g === "critica") return "bg-destructive text-destructive-foreground";
  if (g === "atencao") return "bg-yellow-500 text-black hover:bg-yellow-500";
  if (g === "sucesso") return "bg-emerald-600 text-white hover:bg-emerald-600";
  return "bg-muted text-muted-foreground hover:bg-muted";
}

/** Divergência individual registrada no payload da notificação. */
export type DivergenciaItem = {
  codigo: string | null;
  descricao: string | null;
  esperada: number | null;
  encontrada: number | null;
};

export type PayloadNotificacao = {
  /** Nome do conferente registrado na própria conferência (nunca inferido). */
  conferente?: string | null;
  inicio?: string | null;
  fim?: string | null;
  duracao?: string | null;
  duracao_segundos?: number | null;
  itens?: number | null;
  corretos?: number | null;
  divergentes?: number | null;
  /** Métricas finais da conferência concluída. */
  previstos?: number | null;
  contados?: number | null;
  faltantes?: number | null;
  sobras?: number | null;
  percentual?: number | null;
  unidade_nome?: string | null;
  /** Relatório montado pelo servidor (notificações de início/conclusão desde a V2). */
  responsavel?: string | null;
  lista?: string | null;
  modulo_nome?: string | null;
  empresa_nome?: string | null;
  setor?: string | null;
  frota?: string | null;
  placa?: string | null;
  modelo?: string | null;
  pendentes?: number | null;
  status?: string | null;
  origem?: string | null;
  divergencias?: DivergenciaItem[];
  erro?: string | null;
  stack?: string | null;
  tela?: string | null;
  tempo_aberto?: string | null;
};


export type NotificacaoConferenciaRow = {
  id: string;
  conferencia_id: string | null;
  unidade_id: string | null;
  tipo: string;
  user_id: string;
  usuario_nome: string | null;
  usuario_email: string | null;
  matricula: string | null;
  frota: string | null;
  local: string | null;
  modulo: string | null;
  data: string;
  hora: string | null;
  status: string;
  email_status: string;
  assunto: string | null;
  mensagem: string | null;
  payload: PayloadNotificacao;
  tipo_conferencia: string | null;
  gravidade: string;
  tentativas: number;
  ultima_tentativa: string | null;
  created_at: string;
};

export type NotificacaoEmailRow = {
  id: string;
  notificacao_id: string | null;
  destinatario: string;
  assunto: string | null;
  status: string;
  confirmado: boolean;
  erro: string | null;
  tentativa: number;
  enviado_em: string;
};

export type ConfigEmails = {
  ativo: boolean;
  destinatarios: string[];
  remetente: string;
  sender_domain: string;
  /** Data/hora da última validação bem-sucedida da conexão de envio. */
  validado_em: string | null;
  /** Endereço usado no último teste de conexão aprovado. */
  validado_por: string | null;
  /** Erro do último teste de conexão, quando houver. */
  ultimo_erro: string | null;
};

export const CONFIG_EMAILS_PADRAO: ConfigEmails = {
  ativo: true,
  destinatarios: ["lucas.oliveira@alcoeste.com", "lucasaranttess@gmail.com"],
  remetente: "",
  sender_domain: "",
  validado_em: null,
  validado_por: null,
  ultimo_erro: null,
};

/** Domínio remetente sugerido a partir do e-mail informado. */
export function dominioDoEmail(email: string) {
  return (email.split("@")[1] ?? "").trim().toLowerCase();
}

export function emailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Etapa do assistente de configuração do servidor de envio. */
export type EtapaEnvio = {
  id: "dominio" | "remetente" | "destinatarios" | "validacao";
  titulo: string;
  ajuda: string;
  concluida: boolean;
};

/** Situação de cada etapa do fluxo guiado de configuração de envio. */
export function etapasEnvio(cfg: ConfigEmails): EtapaEnvio[] {
  const dominio = (cfg.sender_domain ?? "").trim();
  const remetente = (cfg.remetente ?? "").trim();
  const destinatarios = (cfg.destinatarios ?? []).filter((d) => d.trim());
  return [
    {
      id: "dominio",
      titulo: "Domínio de envio (DNS)",
      ajuda:
        "Informe o domínio verificado que assinará os e-mails (ex.: notificacoes.suaempresa.com). A verificação de DNS é feita no painel de e-mail do projeto.",
      concluida: !!dominio,
    },
    {
      id: "remetente",
      titulo: "Endereço remetente",
      ajuda: "E-mail que aparecerá para quem recebe. Precisa pertencer ao domínio de envio.",
      concluida: !!remetente && dominioDoEmail(remetente) === dominio && !!dominio,
    },
    {
      id: "destinatarios",
      titulo: "Destinatários das notificações",
      ajuda: "Ao menos um endereço deve estar cadastrado para receber os alertas.",
      concluida: destinatarios.length > 0,
    },
    {
      id: "validacao",
      titulo: "Teste de conexão",
      ajuda:
        "Um e-mail de teste é enviado pelo servidor real. Os disparos automáticos só são liberados depois que o teste for aprovado.",
      concluida: !!cfg.validado_em,
    },
  ];
}

/** Disparos reais só são permitidos após a validação da conexão. */
export function envioLiberado(cfg: ConfigEmails) {
  return etapasEnvio(cfg).every((e) => e.concluida) && cfg.ativo;
}

export const CHAVE_CONFIG_EMAILS = "emails_conferencia";

/** Minutos de tolerância antes de alertar sobre conferência em aberto. */
export const MINUTOS_ATRASO = 30;

export function emailStatusLabel(s?: string | null) {
  if (s === "enviado") return "Enviado";
  if (s === "reenviado") return "Reenviado";
  if (s === "falha") return "Falhou";
  if (s === "nao_configurado") return "Servidor de e-mail não configurado";
  return "Pendente";
}

export function emailStatusClasse(s?: string | null) {
  if (s === "enviado" || s === "reenviado") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (s === "falha") return "bg-destructive text-destructive-foreground";
  if (s === "nao_configurado") return "bg-yellow-500 text-black hover:bg-yellow-500";
  return "bg-muted text-muted-foreground hover:bg-muted";
}

export const EMAIL_STATUS: { valor: string; label: string }[] = [
  { valor: "pendente", label: "Pendente" },
  { valor: "enviado", label: "Enviado" },
  { valor: "reenviado", label: "Reenviado" },
  { valor: "falha", label: "Falhou" },
  { valor: "nao_configurado", label: "Não configurado" },
];

const FUSO = "America/Sao_Paulo";

/** Data (AAAA-MM-DD) e hora (HH:MM) locais usadas no registro e no e-mail. */
export function dataHoraLocal(quando: Date = new Date()) {
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(quando);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  }).format(quando);
  return { data, hora };
}

export function fmtDataBR(data?: string | null) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : data;
}

export function fmtDuracao(segundos?: number | null) {
  if (segundos == null || Number.isNaN(segundos)) return "—";
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  return h ? `${h}h ${m}min` : m ? `${m}min ${s}s` : `${s}s`;
}

export type IndicadoresNotificacao = {
  iniciadasHoje: number;
  concluidasHoje: number;
  emAndamento: number;
  atrasadas: number;
  divergencias: number;
  erros: number;
  ultimaConferencia: NotificacaoConferenciaRow | null;
  ultimaConcluida: NotificacaoConferenciaRow | null;
  ultimoErro: NotificacaoConferenciaRow | null;
  ultimoEmail: NotificacaoEmailRow | null;
  emailsHoje: number;
  falhasHoje: number;
  tempoMedio: string;
};

/** Indicadores do dashboard de notificações. */
export function indicadores(
  notificacoes: NotificacaoConferenciaRow[],
  emails: NotificacaoEmailRow[],
): IndicadoresNotificacao {
  const { data: hoje } = dataHoraLocal();
  const doDia = (iso: string) => dataHoraLocal(new Date(iso)).data === hoje;
  const enviosHoje = emails.filter((e) => doDia(e.enviado_em));
  const doTipo = (t: TipoNotificacao) => notificacoes.filter((n) => n.tipo === t);
  const iniciadas = doTipo("conferencia_iniciada");
  const concluidas = doTipo("conferencia_concluida");
  const concluidasIds = new Set(concluidas.map((n) => n.conferencia_id));
  const duracoes = concluidas
    .map((n) => Number((n.payload as { duracao_segundos?: number })?.duracao_segundos))
    .filter((n) => Number.isFinite(n) && n > 0);

  return {
    iniciadasHoje: iniciadas.filter((n) => n.data === hoje).length,
    concluidasHoje: concluidas.filter((n) => n.data === hoje).length,
    emAndamento: iniciadas.filter((n) => !concluidasIds.has(n.conferencia_id)).length,
    atrasadas: doTipo("conferencia_atrasada").filter((n) => !concluidasIds.has(n.conferencia_id))
      .length,
    divergencias: doTipo("divergencia_estoque").length,
    erros: doTipo("erro_conferencia").length,
    ultimaConferencia: iniciadas[0] ?? null,
    ultimaConcluida: concluidas[0] ?? null,
    ultimoErro: doTipo("erro_conferencia")[0] ?? null,
    ultimoEmail: emails[0] ?? null,
    emailsHoje: enviosHoje.filter((e) => e.status === "enviado" || e.status === "reenviado").length,
    falhasHoje: enviosHoje.filter((e) => e.status === "falha").length,
    tempoMedio: duracoes.length
      ? fmtDuracao(duracoes.reduce((a, b) => a + b, 0) / duracoes.length)
      : "—",
  };
}

export type LinhaEmail = { rotulo: string; valor: string };

const v = (x?: string | number | null) => (x === 0 ? "0" : x && String(x).trim() ? String(x) : "—");

/**
 * Conteúdo do e-mail e do painel para cada tipo de notificação: título,
 * linhas da tabela e uma tabela extra opcional (divergências).
 */
export function conteudoNotificacao(n: NotificacaoConferenciaRow): {
  titulo: string;
  assunto: string;
  intro: string;
  linhas: LinhaEmail[];
  divergencias: DivergenciaItem[];
} {
  const info = tipoInfo(n.tipo);
  const p = (n.payload ?? {}) as PayloadNotificacao & { duracao_segundos?: number };
  const base: LinhaEmail[] = [
    { rotulo: "Usuário", valor: v(n.usuario_nome) },
    { rotulo: "Frota", valor: v(n.frota) },
    { rotulo: "Conferente", valor: v(p.conferente) },
    { rotulo: "Matrícula", valor: v(n.matricula) },
  ];

  if (n.tipo === "conferencia_concluida") {
    return {
      titulo: info.label,
      assunto: info.assunto,
      intro: "Uma conferência foi finalizada.",
      linhas: [
        { rotulo: "Status", valor: "Concluída" },
        ...relatorioBase(n, p),
        { rotulo: "Início", valor: v(p.inicio) },
        { rotulo: "Término", valor: v(p.fim) },
        { rotulo: "Tempo total", valor: v(p.duracao ?? fmtDuracao(p.duracao_segundos)) },
        { rotulo: "Quantidade de itens", valor: v(p.previstos ?? p.itens) },
        { rotulo: "Corretos", valor: v(p.corretos) },
        { rotulo: "Divergências", valor: v(p.divergentes) },
        ...(p.pendentes ? [{ rotulo: "Não contados", valor: v(p.pendentes) }] : []),
        { rotulo: "Usuário", valor: v(n.usuario_nome) },
        { rotulo: "Matrícula", valor: v(n.matricula) },
        { rotulo: "Tipo de conferência", valor: v(n.tipo_conferencia) },
        { rotulo: "ID da conferência", valor: v(n.conferencia_id) },
      ],
      divergencias: p.divergencias ?? [],
    };
  }

  if (n.tipo === "divergencia_estoque") {
    return {
      titulo: info.label,
      assunto: info.assunto,
      intro: "Foram identificadas divergências de estoque nesta conferência.",
      linhas: [
        ...base,
        { rotulo: "Local", valor: v(n.local) },
        { rotulo: "Data", valor: fmtDataBR(n.data) },
        { rotulo: "Hora", valor: v(n.hora) },
        { rotulo: "Divergências", valor: v(p.divergencias?.length ?? 0) },
        { rotulo: "ID da conferência", valor: v(n.conferencia_id) },
      ],
      divergencias: p.divergencias ?? [],
    };
  }

  if (n.tipo === "erro_conferencia") {
    return {
      titulo: info.label,
      assunto: info.assunto,
      intro: "Ocorreu um erro durante a conferência.",
      linhas: [
        ...base,
        { rotulo: "Horário", valor: `${fmtDataBR(n.data)} ${v(n.hora)}` },
        { rotulo: "Tela", valor: v(p.tela) },
        { rotulo: "Mensagem do erro", valor: v(p.erro) },
        { rotulo: "ID da conferência", valor: v(n.conferencia_id) },
        { rotulo: "Stack trace", valor: v(p.stack) },
      ],
      divergencias: [],
    };
  }

  if (n.tipo === "conferencia_atrasada") {
    return {
      titulo: info.label,
      assunto: info.assunto,
      intro: `A conferência permanece aberta há mais de ${MINUTOS_ATRASO} minutos.`,
      linhas: [
        ...base,
        { rotulo: "Local", valor: v(n.local) },
        { rotulo: "Horário de início", valor: v(p.inicio) },
        { rotulo: "Tempo aberto", valor: v(p.tempo_aberto) },
        { rotulo: "Status", valor: "Em aberto" },
        { rotulo: "ID da conferência", valor: v(n.conferencia_id) },
      ],
      divergencias: [],
    };
  }

  return {
    titulo: info.label,
    assunto: info.assunto,
    intro: "Uma nova conferência foi iniciada.",
    linhas: [
      { rotulo: "Status", valor: "Em andamento" },
      ...relatorioBase(n, p),
      { rotulo: "Início", valor: v(p.inicio ?? `${fmtDataBR(n.data)} ${v(n.hora)}`) },
      { rotulo: "Término", valor: "Em andamento" },
      { rotulo: "Tempo total", valor: "Em andamento" },
      { rotulo: "Quantidade de itens", valor: v(p.previstos ?? p.itens) },
      { rotulo: "Divergências", valor: v(p.divergentes ?? 0) },
      { rotulo: "Usuário", valor: v(n.usuario_nome) },
      { rotulo: "Matrícula", valor: v(n.matricula) },
      { rotulo: "Tipo de conferência", valor: v(n.tipo_conferencia) },
      { rotulo: "ID da conferência", valor: v(n.conferencia_id) },
    ],
    divergencias: [],
  };
}

/** Unidade/local da lista: empresa, módulo e setor cadastrados. */
export function unidadeLocal(n: Pick<NotificacaoConferenciaRow, "local">, p: PayloadNotificacao) {
  const partes = [p.empresa_nome, p.modulo_nome, p.setor].filter((x) => x && String(x).trim());
  return partes.length ? partes.join(" · ") : (n.local ?? null);
}

/** Frota da lista, somente quando cadastrada (com placa e modelo, se houver). */
export function frotaCadastrada(n: Pick<NotificacaoConferenciaRow, "frota">, p: PayloadNotificacao) {
  const frota = p.frota ?? n.frota;
  const partes = [frota, p.placa ? `placa ${p.placa}` : null, p.modelo].filter(
    (x) => x && String(x).trim(),
  );
  return partes.length ? partes.join(" · ") : null;
}

/** Identificação comum de início e conclusão: responsável, conferente, lista, local e frota. */
function relatorioBase(n: NotificacaoConferenciaRow, p: PayloadNotificacao): LinhaEmail[] {
  const frota = frotaCadastrada(n, p);
  return [
    { rotulo: "Responsável", valor: v(p.responsavel) },
    { rotulo: "Conferente", valor: v(p.conferente) },
    { rotulo: "Lista", valor: v(p.lista ?? p.unidade_nome ?? n.local) },
    { rotulo: "Unidade/Local", valor: v(unidadeLocal(n, p)) },
    ...(frota ? [{ rotulo: "Frota", valor: frota }] : []),
  ];
}

/** Resumo curto usado na lista (caixa de entrada) do painel. */
export function resumoNotificacao(n: NotificacaoConferenciaRow) {
  if (n.mensagem?.trim()) return n.mensagem;
  const c = conteudoNotificacao(n);
  return c.intro;
}

/** Versão em texto puro do e-mail (fallback para clientes sem HTML). */
export function corpoTexto(n: NotificacaoConferenciaRow) {
  const c = conteudoNotificacao(n);
  const linhas = c.linhas.map((l) => `${l.rotulo}: ${l.valor}`);
  const divs = c.divergencias.map(
    (d, i) =>
      `${i + 1}. ${d.codigo ?? "—"} — ${d.descricao ?? "—"} | esperada: ${d.esperada ?? "—"} | encontrada: ${d.encontrada ?? "—"} | diferença: ${
        d.encontrada != null && d.esperada != null ? d.encontrada - d.esperada : "—"
      }`,
  );
  return [
    c.intro,
    "",
    ...linhas,
    ...(divs.length ? ["", "Divergências:", ...divs] : []),
    "",
    "Acesse a Central Administrativa para acompanhar em tempo real.",
    "Este é um e-mail automático. Não responda.",
  ].join("\n");
}

/** Compatibilidade: corpo do e-mail de início de conferência. */
export const ASSUNTO_EMAIL_INICIO = "NOVA CONFERÊNCIA INICIADA";
