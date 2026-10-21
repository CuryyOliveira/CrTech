/**
 * Registro dos eventos que geram notificação (início, conclusão, divergência e
 * erro) com disparo assíncrono do e-mail. Falhas nunca interrompem a conferência.
 */
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import { estaOffline } from "@/lib/offline/estado";
import { sessaoOffline } from "@/lib/offline/cofre";
import { registrarEnvioPendente } from "@/lib/offline/notificacoes-pendentes";
import { registrarAuditoria } from "@/lib/audit";
import { enviarEmailNotificacao } from "@/lib/notificacoes-conferencia.functions";
import { dispararWhatsappNotificacao } from "@/lib/whatsapp.functions";
import {
  dataHoraLocal,
  tipoInfo,
  type DivergenciaItem,
  type PayloadNotificacao,
  type TipoNotificacao,
} from "@/lib/notificacoes-conferencia";

type Contexto = {
  conferenciaId: string;
  unidadeId: string;
  local: string | null;
  frota: string | null;
  matricula?: string | null;
  /** Nome do conferente; quando ausente é lido da própria conferência. */
  conferente?: string | null;
  modulo: string | null;
  tipoConferencia?: string | null;
};

async function usuarioAtual() {
  let id: string | null = null;
  let email: string | null = null;
  if (!estaOffline()) {
    const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    id = auth.user?.id ?? null;
    email = auth.user?.email ?? null;
  }
  if (!id) {
    // Sem internet a identidade vem do cofre local (Offline Login).
    const local = sessaoOffline();
    if (!local) return null;
    id = local.userId;
    email = local.email ?? null;
  }
  const { data: perfil } = await db
    .from("user_profiles")
    .select("nome")
    .eq("user_id", id)
    .maybeSingle();
  return {
    id,
    email,
    nome: ((perfil as { nome: string | null } | null)?.nome ?? email?.split("@")[0]) || null,
  };
}
/**
 * Lê o conferente e a matrícula gravados na conferência (fonte da verdade).
 * Nunca inventa o nome: se não houver registro, o campo fica vazio.
 */
async function dadosDaConferencia(ctx: Contexto) {
  let conferente = ctx.conferente ?? null;
  let matricula = ctx.matricula ?? null;
  try {
    const { data } = await db
      .from("conferencias")
      .select("conferente, almoxarife, codigo_almoxarife")
      .eq("id", ctx.conferenciaId)
      .maybeSingle();
    const c = data as
      | { conferente: string | null; almoxarife: string | null; codigo_almoxarife: string | null }
      | null;
    if (c) {
      conferente = c.conferente ?? c.almoxarife ?? conferente;
      matricula = c.codigo_almoxarife ?? matricula;
    }
  } catch {
    // Sem acesso ao registro: mantém apenas o que veio do contexto.
  }
  return { conferente: conferente || null, matricula: matricula || null };
}


/** Grava a notificação e dispara o e-mail em segundo plano. */
async function registrarEvento(
  tipo: TipoNotificacao,
  ctx: Contexto,
  extras: {
    status?: string;
    mensagem?: string;
    payload?: PayloadNotificacao & { duracao_segundos?: number };
    /** Impede mais de uma notificação deste tipo para a mesma conferência. */
    unico?: boolean;
  } = {},
) {
  // Sem internet a notificação é gravada localmente, enfileirada para o banco de
  // dados e o envio do e-mail/relatório fica pendente até a conexão voltar.
  const offline = estaOffline();
  try {
    const user = await usuarioAtual();
    if (!user) return;
    if (extras.unico) {
      const { data: existente } = await db
        .from("notificacoes_conferencia")
        .select("id")
        .eq("conferencia_id", ctx.conferenciaId)
        .eq("tipo", tipo)
        .limit(1)
        .maybeSingle();
      if (existente) return;
    }
    const info = tipoInfo(tipo);
    const { data, hora } = dataHoraLocal();
    // Conferente e matrícula vêm sempre da própria conferência (pelo ID),
    // garantindo consistência entre os e-mails de início e de conclusão.
    const dados = await dadosDaConferencia(ctx);
    // O identificador é gerado aqui para que a notificação criada offline já
    // tenha a mesma chave usada depois no envio do e-mail com o relatório.
    const notificacaoId = crypto.randomUUID();
    const { data: criada, error } = await db
      .from("notificacoes_conferencia")
      .insert({
        id: notificacaoId,
        conferencia_id: ctx.conferenciaId,
        unidade_id: ctx.unidadeId,
        tipo,
        user_id: user.id,
        usuario_nome: user.nome,
        usuario_email: user.email,
        matricula: dados.matricula,
        frota: ctx.frota,
        local: ctx.local,
        modulo: ctx.modulo,
        tipo_conferencia: ctx.tipoConferencia ?? null,
        data,
        hora,
        status: extras.status ?? "em_andamento",
        assunto: info.assunto,
        mensagem: extras.mensagem ?? null,
        gravidade: info.gravidade,
        ...(offline ? { email_status: "pendente" } : {}),
        payload: { ...(extras.payload ?? {}), conferente: dados.conferente } as never,
      })
      .select("id")
      .maybeSingle();

    void registrarAuditoria({
      tipo: "operacao",
      acao: `notificacao_${tipo}`,
      detalhe: offline
        ? `${extras.mensagem ?? info.label} (registrada offline; envio pendente)`
        : (extras.mensagem ?? info.label),
      modulo: ctx.modulo,
      lista: ctx.local,
      resultado: error ? "erro" : "sucesso",
    });

    if (error) return;
    if (offline) {
      // Fica pendente: ao reconectar, a sincronização grava no banco e só então
      // envia o e-mail com o relatório da conferência.
      registrarEnvioPendente(notificacaoId, tipo, ctx.conferenciaId);
      return;
    }
    if (!criada) return;
    // Envio assíncrono: a interface não aguarda o resultado.
    void enviarEmailNotificacao({
      data: { notificacaoId: (criada as { id: string }).id },
    }).catch(() => undefined);
    // WhatsApp: só início e conclusão, para os números cadastrados na empresa.
    if (tipo === "conferencia_iniciada" || tipo === "conferencia_concluida") {
      void dispararWhatsappNotificacao({
        data: { notificacaoId: (criada as { id: string }).id },
      }).catch(() => undefined);
    }
  } catch {
    // Silencioso: o fluxo da conferência nunca pode ser interrompido.
  }
}

export function registrarInicioConferencia(ctx: Contexto) {
  return registrarEvento("conferencia_iniciada", ctx, { status: "em_andamento" });
}

export function registrarConclusaoConferencia(
  ctx: Contexto,
  dados: {
    inicio: string;
    fim: string;
    duracaoSegundos: number;
    duracao: string;
    itens: number;
    corretos: number;
    divergentes: number;
    previstos?: number;
    contados?: number;
    faltantes?: number;
    sobras?: number;
    percentual?: number;
  },
) {
  return registrarEvento("conferencia_concluida", ctx, {
    status: "finalizada",
    unico: true,
    mensagem: `Conferência concluída com ${dados.corretos} itens corretos e ${dados.divergentes} divergências.`,
    payload: {
      inicio: dados.inicio,
      fim: dados.fim,
      duracao: dados.duracao,
      duracao_segundos: dados.duracaoSegundos,
      itens: dados.itens,
      corretos: dados.corretos,
      divergentes: dados.divergentes,
      previstos: dados.previstos ?? dados.itens,
      contados: dados.contados ?? dados.itens,
      faltantes: dados.faltantes ?? null,
      sobras: dados.sobras ?? null,
      percentual: dados.percentual ?? null,
      unidade_nome: ctx.local,
    },
  });
}


export function registrarDivergencias(ctx: Contexto, divergencias: DivergenciaItem[]) {
  if (!divergencias.length) return Promise.resolve();
  return registrarEvento("divergencia_estoque", ctx, {
    status: "divergencia",
    mensagem: `${divergencias.length} divergência(s) de estoque identificada(s).`,
    payload: { divergencias },
  });
}

export function registrarErroConferencia(
  ctx: Contexto,
  erro: unknown,
  tela = "Conferência de materiais",
) {
  const e = erro instanceof Error ? erro : new Error(String(erro));
  return registrarEvento("erro_conferencia", ctx, {
    status: "erro",
    mensagem: e.message,
    payload: { erro: e.message, stack: e.stack ?? null, tela },
  });
}
