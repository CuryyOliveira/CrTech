/**
 * Camada central de registro: Log de Auditoria e Histórico Operacional.
 * Fonte de dados para os módulos futuros (Painel Gerencial, Relatórios, KPIs, Notificações).
 */
import { supabase } from "@/integrations/supabase/client";
import { dispositivoAtual } from "@/lib/cadastros";
import { dbOffline } from "@/lib/offline/db";
import { sessaoOffline } from "@/lib/offline/cofre";

import { getModulo, moduloPorTipo, type ModuloId } from "@/lib/permissions";
import { dataLocalISO } from "@/lib/datas";

const sb = dbOffline as unknown as { from: (t: string) => any };

export type TipoAcao =
  | "autenticacao"
  | "usuarios"
  | "administracao"
  | "importacao"
  | "operacao"
  | "exportacao";

export const TIPOS_ACAO: { valor: TipoAcao; label: string }[] = [
  { valor: "autenticacao", label: "Autenticação" },
  { valor: "usuarios", label: "Usuários" },
  { valor: "administracao", label: "Administração" },
  { valor: "importacao", label: "Importações" },
  { valor: "operacao", label: "Operação" },
  { valor: "exportacao", label: "Exportações" },
];

export const STATUS_HISTORICO: { valor: string; label: string }[] = [
  { valor: "em_andamento", label: "Em andamento" },
  { valor: "pausada", label: "Pausada" },
  { valor: "finalizada", label: "Finalizada" },
  { valor: "cancelada", label: "Cancelada" },
];

export function statusLabel(s?: string | null) {
  return STATUS_HISTORICO.find((x) => x.valor === s)?.label ?? (s ?? "—");
}

export function tipoAcaoLabel(t?: string | null) {
  return TIPOS_ACAO.find((x) => x.valor === t)?.label ?? (t ?? "—");
}

export type AuditoriaRow = {
  id: string;
  created_at: string;
  usuario: string | null;
  nome: string | null;
  perfil: string | null;
  setor: string | null;
  tipo_acao: string;
  acao: string;
  detalhe: string | null;
  modulo: string | null;
  lista: string | null;
  resultado: string;
};

export type HistoricoRow = {
  id: string;
  conferencia_id: string | null;
  unidade_id: string | null;
  user_id: string;
  usuario_email: string | null;
  nome: string | null;
  perfil: string | null;
  setor: string | null;
  modulo: string;
  modulo_titulo: string | null;
  lista: string | null;
  data: string;
  hora_inicio: string;
  hora_fim: string | null;
  duracao_segundos: number | null;
  total_tempo_pausado?: number | null;
  ultima_pausa?: string | null;
  ultima_retomada?: string | null;
  tempo_trabalhado?: number | null;
  quantidade_pausas?: number | null;

  updated_at?: string | null;

  quantidade_prevista: number;
  quantidade_conferida: number;
  divergencias: number;
  percentual: number;
  status: string;
  detalhes: Record<string, unknown>;
  created_at: string;
};

type Contexto = {
  userId: string | null;
  email: string | null;
  nome: string | null;
  perfil: string | null;
  setor: string | null;
};

let cache: Contexto | null = null;

/** Dados do usuário logado usados nos registros (memorizados por sessão). */
export async function contextoUsuario(): Promise<Contexto> {
  if (cache) return cache;
  const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const user = auth.user;
  if (!user) {
    // Sem internet: usa a identidade validada pelo cofre local (login offline).
    const local = sessaoOffline();
    if (!local) return { userId: null, email: null, nome: null, perfil: null, setor: null };
    cache = {
      userId: local.userId,
      email: local.email,
      nome: local.nome,
      perfil: local.perfil,
      setor: local.setor,
    };
    return cache;
  }
  const { data: row } = await sb
    .from("user_profiles")
    .select("nome,perfil,setor")
    .eq("user_id", user.id)
    .maybeSingle();
  cache = {
    userId: user.id,
    email: user.email ?? null,
    nome: row?.nome ?? (user.user_metadata?.['nome'] as string | undefined) ?? null,
    perfil: row?.perfil ?? null,
    setor: row?.setor ?? row?.perfil ?? null,
  };
  return cache;
}

export function limparContextoUsuario() {
  cache = null;
}
/** Dispositivo/navegador do usuário, gravado em cada evento de auditoria. */
function descricaoDispositivo() {
  const { dispositivo, navegador } = dispositivoAtual();
  if (!dispositivo) return null;
  return `${dispositivo} · ${navegador}`;
}

let ipCache: string | null = null;

/** IP público do usuário (consulta única por sessão, nunca bloqueia a operação). */
async function ipAtual() {
  if (ipCache) return ipCache;
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = (await r.json()) as { ip?: string };
    ipCache = j.ip ?? null;
  } catch {
    ipCache = null;
  }
  return ipCache;
}


/** Grava um evento no Log de Auditoria (somente leitura na interface). */
export async function registrarAuditoria(entrada: {
  tipo: TipoAcao;
  acao: string;
  detalhe?: string | null;
  modulo?: ModuloId | string | null;
  lista?: string | null;
  resultado?: "sucesso" | "erro" | "negado";
}) {
  try {
    const ctx = await contextoUsuario();
    if (!ctx.userId) return;
    await sb.from("auditoria").insert({
      user_id: ctx.userId,
      usuario: ctx.email,
      nome: ctx.nome,
      perfil: ctx.perfil,
      setor: ctx.setor,
      tipo_acao: entrada.tipo,
      acao: entrada.acao,
      detalhe: entrada.detalhe ?? null,
      modulo: entrada.modulo ?? null,
      lista: entrada.lista ?? null,
      resultado: entrada.resultado ?? "sucesso",
      ip: await ipAtual(),
      dispositivo: descricaoDispositivo(),

    });
  } catch {
    /* auditoria nunca deve interromper a operação do usuário */
  }
}

function tituloModulo(modulo?: string | null) {
  if (!modulo) return null;
  try {
    return getModulo(modulo as ModuloId)?.titulo ?? modulo;
  } catch {
    return modulo;
  }
}

/** Cria o registro do Histórico Operacional ao iniciar uma conferência. */
export async function abrirHistorico(dados: {
  conferenciaId: string;
  unidadeId: string;
  tipoUnidade?: string | null;
  lista: string;
  horaInicio: string;
  prevista: number;
}) {
  try {
    const ctx = await contextoUsuario();
    if (!ctx.userId) return;
    const modulo = moduloPorTipo(dados.tipoUnidade)?.id ?? dados.tipoUnidade ?? "";
    await sb.from("historico_conferencias").insert({
      conferencia_id: dados.conferenciaId,
      unidade_id: dados.unidadeId,
      user_id: ctx.userId,
      usuario_email: ctx.email,
      nome: ctx.nome,
      perfil: ctx.perfil,
      setor: ctx.setor,
      modulo,
      modulo_titulo: tituloModulo(modulo),
      lista: dados.lista,
      data: dataLocalISO(dados.horaInicio),
      hora_inicio: dados.horaInicio,
      quantidade_prevista: dados.prevista,
      status: "em_andamento",
    });
  } catch {
    /* ignora falhas de registro */
  }
}

/** Atualiza o registro do Histórico Operacional (pausa, retomada, finalização, cancelamento). */
export async function fecharHistorico(dados: {
  conferenciaId: string;
  status: "em_andamento" | "pausada" | "finalizada" | "cancelada";
  horaFim?: string | null;
  horaInicio?: string | null;
  prevista?: number;
  conferida?: number;
  divergencias?: number;
}) {
  try {
    const prevista = dados.prevista ?? 0;
    // O tempo (duracao_segundos / tempo_trabalhado / total_tempo_pausado) é
    // calculado e sincronizado pelo banco a partir da tabela de conferências,
    // descontando todo o período pausado.
    const patch: Record<string, unknown> = {
      status: dados.status,
      hora_fim: dados.horaFim ?? null,
      quantidade_conferida: dados.conferida ?? 0,
      divergencias: dados.divergencias ?? 0,
      percentual: prevista ? Math.round(((dados.conferida ?? 0) / prevista) * 100) : 0,
    };

    if (dados.prevista !== undefined) patch['quantidade_prevista'] = prevista;
    await sb.from("historico_conferencias").update(patch).eq("conferencia_id", dados.conferenciaId);
  } catch {
    /* ignora falhas de registro */
  }
}

export function fmtDuracao(segundos?: number | null) {
  if (segundos == null) return "—";
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
