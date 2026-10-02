/**
 * Central de Notificações — os eventos são DERIVADOS das fontes já existentes
 * (Histórico Operacional e Log de Auditoria). Nada é gravado em duplicidade:
 * cada notificação tem uma chave determinística e o banco guarda apenas a leitura.
 */
import type { AuditoriaRow, HistoricoRow } from "@/lib/audit";
import { moduloLabel, setorLabel, tempoTrabalhado } from "@/lib/gerencial";

export type Categoria = "info" | "aviso" | "atencao" | "critica";

export const CATEGORIAS: { valor: Categoria; label: string; emoji: string; classe: string }[] = [
  {
    valor: "info",
    label: "Informação",
    emoji: "🔵",
    classe: "bg-sky-600 text-white hover:bg-sky-600",
  },
  {
    valor: "aviso",
    label: "Aviso",
    emoji: "🟡",
    classe: "bg-yellow-500 text-black hover:bg-yellow-500",
  },
  {
    valor: "atencao",
    label: "Atenção",
    emoji: "🟠",
    classe: "bg-amber-600 text-white hover:bg-amber-600",
  },
  {
    valor: "critica",
    label: "Crítica",
    emoji: "🔴",
    classe: "bg-destructive text-destructive-foreground",
  },
];

export function categoriaInfo(c: Categoria) {
  return CATEGORIAS.find((x) => x.valor === c) ?? CATEGORIAS[0]!;
}

export type ConfigAlertas = {
  minutos_sem_movimentacao: number;
  tempo_maximo_minutos: number;
  limite_divergencias: number;
};

export const CONFIG_ALERTAS_PADRAO: ConfigAlertas = {
  minutos_sem_movimentacao: 30,
  tempo_maximo_minutos: 120,
  limite_divergencias: 5,
};

export type Notificacao = {
  chave: string;
  categoria: Categoria;
  origem: "operacional" | "administrativa";
  titulo: string;
  detalhe: string;
  quando: string;
  usuario: string | null;
  userId: string | null;
  setor: string | null;
  modulo: string | null;
};

type HistoricoComUpdate = HistoricoRow & { updated_at?: string | null };

const STATUS_EVENTO: Record<string, { titulo: string; categoria: Categoria }> = {
  em_andamento: { titulo: "Conferência iniciada", categoria: "info" },
  pausada: { titulo: "Conferência pausada", categoria: "aviso" },
  finalizada: { titulo: "Conferência finalizada", categoria: "info" },
  cancelada: { titulo: "Conferência cancelada", categoria: "atencao" },
};

const ACAO_ADMIN: Record<string, { titulo: string; categoria: Categoria }> = {
  cadastro: { titulo: "Novo usuário cadastrado", categoria: "info" },
  cadastro_usuario: { titulo: "Novo usuário cadastrado", categoria: "info" },
  lista_importada: { titulo: "Importação concluída", categoria: "info" },
  lista_excluida: { titulo: "Exclusão de lista", categoria: "atencao" },
  usuario_criado: { titulo: "Novo usuário cadastrado", categoria: "info" },
  usuario_bloqueado: { titulo: "Usuário bloqueado", categoria: "atencao" },
  usuario_desbloqueado: { titulo: "Usuário desbloqueado", categoria: "aviso" },
  usuario_atualizado: { titulo: "Perfil/setor alterado", categoria: "aviso" },
  perfil_alterado: { titulo: "Perfil alterado", categoria: "aviso" },
  setor_alterado: { titulo: "Setor alterado", categoria: "aviso" },
  permissoes_alteradas: { titulo: "Permissões alteradas", categoria: "atencao" },
  senha_redefinida: { titulo: "Senha redefinida", categoria: "atencao" },
  configuracao_alterada: { titulo: "Configuração do sistema modificada", categoria: "atencao" },
  importacao: { titulo: "Importação concluída", categoria: "info" },
  exclusao: { titulo: "Exclusão de lista", categoria: "atencao" },
  retomada: { titulo: "Conferência retomada", categoria: "info" },
  conferencia_retomada: { titulo: "Conferência retomada", categoria: "info" },
};

function rotuloAcao(acao: string) {
  return acao.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function minutos(desde: string, ate: number) {
  return Math.round((ate - new Date(desde).getTime()) / 60000);
}

/** Notificações operacionais e de progresso derivadas do Histórico Operacional. */
export function notificacoesDoHistorico(
  rows: HistoricoComUpdate[],
  config: ConfigAlertas,
  agora = Date.now(),
): Notificacao[] {
  const saida: Notificacao[] = [];
  for (const r of rows) {
    const base = {
      origem: "operacional" as const,
      usuario: r.nome ?? r.usuario_email ?? null,
      userId: r.user_id,
      setor: r.setor,
      modulo: r.modulo,
    };
    const contexto = `${moduloLabel(r.modulo)} — ${r.lista ?? "sem lista"} (${setorLabel(r.setor)})`;
    const evento = STATUS_EVENTO[r.status];
    if (evento) {
      saida.push({
        ...base,
        chave: `hist:${r.id}:${r.status}`,
        categoria: evento.categoria,
        titulo: evento.titulo,
        detalhe: contexto,
        quando: r.hora_fim ?? r.updated_at ?? r.hora_inicio,
      });
    }

    // Progresso: 25%, 50%, 75% e 100%
    const pct = Number(r.percentual ?? 0);
    for (const marco of [25, 50, 75, 100]) {
      if (pct >= marco) {
        saida.push({
          ...base,
          chave: `prog:${r.id}:${marco}`,
          categoria: "info",
          titulo: `Progresso de ${marco}% alcançado`,
          detalhe: `${contexto} — ${r.quantidade_conferida}/${r.quantidade_prevista} itens`,
          quando: r.hora_fim ?? r.updated_at ?? r.hora_inicio,
        });
      }
    }

    // Situações especiais
    const emCurso = r.status === "em_andamento" || r.status === "pausada";
    const ultima = r.updated_at ?? r.hora_inicio;
    if (emCurso && minutos(ultima, agora) >= config.minutos_sem_movimentacao) {
      saida.push({
        ...base,
        chave: `alerta:${r.id}:sem_movimentacao`,
        categoria: "atencao",
        titulo: "Conferência sem movimentação",
        detalhe: `${contexto} — sem atualização há ${minutos(ultima, agora)} min`,
        quando: ultima,
      });
    }
    // Considera apenas o tempo efetivamente trabalhado (sem as pausas).
    const decorrido = tempoTrabalhado(r, agora) / 60;

    if ((emCurso || r.status === "finalizada") && decorrido > config.tempo_maximo_minutos) {
      saida.push({
        ...base,
        chave: `alerta:${r.id}:tempo_maximo`,
        categoria: "critica",
        titulo: "Tempo máximo ultrapassado",
        detalhe: `${contexto} — ${Math.round(decorrido)} min (limite ${config.tempo_maximo_minutos} min)`,
        quando: r.hora_fim ?? ultima,
      });
    }
    if (Number(r.divergencias ?? 0) > config.limite_divergencias) {
      saida.push({
        ...base,
        chave: `alerta:${r.id}:divergencias`,
        categoria: "critica",
        titulo: "Limite de divergências ultrapassado",
        detalhe: `${contexto} — ${r.divergencias} divergências (limite ${config.limite_divergencias})`,
        quando: r.hora_fim ?? ultima,
      });
    }
  }
  return saida;
}

/** Notificações administrativas e de falha derivadas do Log de Auditoria. */
export function notificacoesDaAuditoria(rows: AuditoriaRow[]): Notificacao[] {
  const saida: Notificacao[] = [];
  for (const r of rows) {
    const mapeada = ACAO_ADMIN[r.acao];
    const falha = r.resultado === "erro" || r.resultado === "negado";
    if (!mapeada && !falha) continue;
    const categoria: Categoria = falha ? "critica" : (mapeada?.categoria ?? "info");
    const titulo = falha
      ? r.tipo_acao === "importacao"
        ? "Erro durante importação"
        : r.acao.includes("sinc")
          ? "Falha na sincronização"
          : r.resultado === "negado"
            ? "Acesso negado"
            : `Erro inesperado — ${rotuloAcao(r.acao)}`
      : (mapeada?.titulo ?? rotuloAcao(r.acao));
    saida.push({
      chave: `aud:${r.id}`,
      categoria,
      origem: r.tipo_acao === "operacao" ? "operacional" : "administrativa",
      titulo,
      detalhe: r.detalhe ?? rotuloAcao(r.acao),
      quando: r.created_at,
      usuario: r.nome ?? r.usuario ?? null,
      userId: null,
      setor: r.setor,
      modulo: r.modulo,
    });
  }
  return saida;
}

/** Consolida as duas fontes, remove chaves repetidas e ordena da mais recente. */
export function consolidar(
  historico: HistoricoComUpdate[],
  auditoria: AuditoriaRow[],
  config: ConfigAlertas,
): Notificacao[] {
  const mapa = new Map<string, Notificacao>();
  for (const n of [
    ...notificacoesDoHistorico(historico, config),
    ...notificacoesDaAuditoria(auditoria),
  ]) {
    if (!mapa.has(n.chave)) mapa.set(n.chave, n);
  }
  return [...mapa.values()].sort((a, b) => (a.quando < b.quando ? 1 : -1));
}

/** Estrutura preparada para integrações futuras (nada é enviado nesta fase). */
export type IntegracaoRow = {
  id: string;
  tipo: string;
  nome: string;
  ativo: boolean;
  config: Record<string, unknown>;
};

export const INTEGRACOES_FUTURAS: { tipo: string; nome: string; descricao: string }[] = [
  {
    tipo: "power_bi",
    nome: "Power BI",
    descricao: "Exportação de indicadores para painéis externos",
  },
  { tipo: "teams", nome: "Microsoft Teams", descricao: "Envio de alertas para canais da equipe" },
  { tipo: "whatsapp", nome: "WhatsApp", descricao: "Alertas críticos por mensagem" },
  { tipo: "slack", nome: "Slack", descricao: "Alertas em canais de operação" },
  { tipo: "api_rest", nome: "API REST", descricao: "Consumo externo dos dados operacionais" },
  {
    tipo: "backup",
    nome: "Backup automático",
    descricao: "Cópia periódica das bases operacionais",
  },
];

export type AgendamentoRow = {
  id: string;
  nome: string;
  fonte: string;
  frequencia: string;
  hora: string;
  formato: string;
  filtros: Record<string, string>;
  destinatarios: string;
  ativo: boolean;
  ultima_execucao: string | null;
  created_at: string;
};

export const FREQUENCIAS = [
  { valor: "diario", label: "Diário" },
  { valor: "semanal", label: "Semanal" },
  { valor: "mensal", label: "Mensal" },
];

export const FORMATOS = [
  { valor: "pdf", label: "PDF" },
  { valor: "xlsx", label: "Excel (.xlsx)" },
  { valor: "csv", label: "CSV" },
];

export function frequenciaLabel(f?: string | null) {
  return FREQUENCIAS.find((x) => x.valor === f)?.label ?? f ?? "—";
}

export function formatoLabel(f?: string | null) {
  return FORMATOS.find((x) => x.valor === f)?.label ?? f ?? "—";
}
