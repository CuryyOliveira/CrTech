/**
 * "Minha assinatura" — leitura e gestão do plano vigente.
 * Toda decisão é do servidor: o plano, valor, periodicidade e status vêm do
 * banco e são reconfirmados na API oficial do Mercado Pago. O frontend envia
 * apenas o código do plano desejado e o ambiente.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assinaturaVigente,
  exigirAdministrador,
  type ContextoAuth,
} from "@/lib/assinatura-gestao.server";

export type AmbienteCobranca = "sandbox" | "live";

export type MinhaAssinaturaDetalhe = {
  id: string;
  status: string;
  provider: string;
  planoCodigo: string | null;
  planoNome: string | null;
  valorCentavos: number | null;
  moeda: string | null;
  periodicidade: string | null;
  dataInicio: string | null;
  periodoAtualFim: string | null;
  proximaCobranca: string | null;
  trialInicio: string | null;
  trialFim: string | null;
  canceladaEm: string | null;
  cancelarNoFimPeriodo: boolean;
  maxUsuarios: number | null;
  maxModulos: number | null;
  modulos: string[];
  gerenciavel: boolean;
  sincronizada: boolean;
  avisoSincronizacao: string | null;
};


/** Estado atual da assinatura da empresa, reconfirmado no provedor. */
export const minhaAssinaturaDetalhada = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => ({
    ambiente: data.ambiente === "live" ? ("live" as const) : ("sandbox" as const),
  }))
  .handler(async ({ data, context }) => {
    await exigirAdministrador(context as ContextoAuth);
    const { empresaId, linha } = await assinaturaVigente(context as ContextoAuth, data.ambiente);
    if (!empresaId) return { empresaId: null, assinatura: null as MinhaAssinaturaDetalhe | null };
    if (!linha) return { empresaId, assinatura: null as MinhaAssinaturaDetalhe | null };

    let atual = linha;
    let sincronizada = false;
    let aviso: string | null = null;

    if (linha.provider === "mercadopago" && linha.provider_subscription_id) {
      try {
        const { sincronizarPreapprovalNoBanco } = await import("@/lib/assinatura-mp.server");
        const campos = await sincronizarPreapprovalNoBanco(
          data.ambiente,
          linha.id as string,
          linha.provider_subscription_id as string,
          (linha.plano_codigo as string | null) ?? null,
        );
        atual = { ...linha, ...campos };
        sincronizada = true;
      } catch (e) {
        aviso =
          "Não foi possível reconfirmar a assinatura no provedor agora; os dados exibidos são os últimos confirmados.";
        console.error("Falha ao sincronizar assinatura", e);
      }
    }

    const plano = (linha.planos ?? null) as
      | {
          nome?: string;
          max_usuarios?: number | null;
          modulos?: string[];
          limites?: Record<string, unknown> | null;
        }
      | null;
    const maxModulosBruto = plano?.limites?.["max_modulos"];
    const maxModulos =
      typeof maxModulosBruto === "number" ? maxModulosBruto : null;

    const detalhe: MinhaAssinaturaDetalhe = {
      id: atual.id,
      status: atual.status,
      provider: atual.provider,
      planoCodigo: atual.plano_codigo ?? null,
      planoNome: plano?.nome ?? null,
      valorCentavos: atual.valor_centavos ?? null,
      moeda: atual.moeda ?? null,
      periodicidade: atual.periodicidade ?? null,
      dataInicio: atual.data_inicio ?? null,
      periodoAtualFim: atual.periodo_atual_fim ?? null,
      proximaCobranca: atual.proxima_cobranca ?? null,
      trialInicio: atual.trial_inicio ?? null,
      trialFim: atual.trial_fim ?? null,
      canceladaEm: atual.cancelada_em ?? null,
      cancelarNoFimPeriodo: Boolean(atual.cancelar_no_fim_periodo),
      maxUsuarios: plano?.max_usuarios ?? null,
      maxModulos,
      modulos: plano?.modulos ?? [],
      gerenciavel:
        atual.provider === "mercadopago" && Boolean(atual.provider_subscription_id),
      sincronizada,
      avisoSincronizacao: aviso,
    };

    return { empresaId, assinatura: detalhe };
  });

/** Cancela a assinatura no provedor e reflete o estado confirmado no banco. */
export const cancelarMinhaAssinatura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => ({
    ambiente: data.ambiente === "live" ? ("live" as const) : ("sandbox" as const),
  }))
  .handler(async ({ data, context }) => {
    await exigirAdministrador(context as ContextoAuth);
    const { empresaId, linha } = await assinaturaVigente(context as ContextoAuth, data.ambiente);
    if (!empresaId || !linha) throw new Error("Nenhuma assinatura encontrada para a sua empresa.");
    if (linha.provider !== "mercadopago" || !linha.provider_subscription_id) {
      throw new Error("Esta assinatura não pode ser cancelada automaticamente.");
    }
    if (linha.status === "cancelada" || linha.status === "encerrada") {
      return {
        status: linha.status as string,
        jaCancelada: true,
        acessoAte: (linha.periodo_atual_fim as string | null) ?? null,
      };
    }

    // O fim do período já pago é preservado antes do cancelamento: depois disso
    // o provedor deixa de informar a próxima cobrança.
    const fimPeriodoConhecido =
      (linha.periodo_atual_fim as string | null) ??
      (linha.proxima_cobranca as string | null) ??
      (linha.trial_fim as string | null) ??
      null;

    const { alterarStatusPreapproval } = await import("@/lib/mercadopago.server");
    await alterarStatusPreapproval(
      data.ambiente,
      linha.provider_subscription_id as string,
      "cancelled",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (fimPeriodoConhecido && !linha.periodo_atual_fim) {
      await supabaseAdmin
        .from("assinaturas")
        .update({ periodo_atual_fim: fimPeriodoConhecido })
        .eq("id", linha.id as string);
    }

    const { sincronizarPreapprovalNoBanco } = await import("@/lib/assinatura-mp.server");
    const campos = await sincronizarPreapprovalNoBanco(
      data.ambiente,
      linha.id as string,
      linha.provider_subscription_id as string,
      (linha.plano_codigo as string | null) ?? null,
    );

    await supabaseAdmin.from("auditoria").insert({
      user_id: (context as ContextoAuth).userId,
      acao: "Assinatura cancelada pelo administrador",
      detalhe: `Assinatura ${linha.provider_subscription_id} (${linha.plano_codigo ?? "sem plano"})`,
      tipo_acao: "cobranca",
      modulo: "assinaturas",
      resultado: "sucesso",
      lista: empresaId,
    });

    return {
      status: campos.status,
      jaCancelada: false,
      acessoAte: campos.cancelar_no_fim_periodo ? campos.periodo_atual_fim : null,
    };
  });


/**
 * Altera o plano da assinatura vigente (upgrade/downgrade). O valor cobrado é
 * sempre o valor do plano gravado no banco; o provedor confirma a alteração.
 * Quando o provedor não permite ajustar a recorrência atual (por exemplo,
 * assinatura cancelada ou pendente), devolvemos `requerNovoCheckout` para que a
 * contratação seja refeita no checkout oficial.
 */
export const alterarMeuPlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca; planoCodigo: string }) => {
    const planoCodigo = (data.planoCodigo ?? "").trim();
    if (!planoCodigo) throw new Error("Plano não informado.");
    return {
      ambiente: data.ambiente === "live" ? ("live" as const) : ("sandbox" as const),
      planoCodigo,
    };
  })
  .handler(async ({ data, context }) => {
    await exigirAdministrador(context as ContextoAuth);
    const ctx = context as ContextoAuth;
    const { empresaId, linha } = await assinaturaVigente(ctx, data.ambiente);
    if (!empresaId) throw new Error("Seu usuário não está vinculado a nenhuma empresa.");

    const { data: plano } = await ctx.supabase
      .from("planos")
      .select("id, codigo, nome, ativo, valor_centavos, moeda, periodicidade, max_usuarios, limites")
      .eq("codigo", data.planoCodigo)
      .eq("ambiente", data.ambiente)
      .maybeSingle();
    const novo = plano as
      | {
          id: string;
          codigo: string;
          nome: string;
          ativo: boolean;
          valor_centavos: number | null;
          moeda: string | null;
          periodicidade: string | null;
          max_usuarios: number | null;
          limites: Record<string, unknown> | null;
        }
      | null;
    if (!novo?.ativo) throw new Error("Plano indisponível para contratação.");
    if (!novo.valor_centavos || novo.valor_centavos <= 0) {
      throw new Error(`O plano "${novo.nome}" não possui valor configurado para cobrança.`);
    }

    // Downgrade só é permitido se o uso atual couber no plano de destino —
    // caso contrário a empresa ficaria acima do limite contratado.
    const [{ data: usuariosUsados }, { data: modulosUsados }] = await Promise.all([
      ctx.supabase.rpc("usuarios_ativos_empresa", { _empresa_id: empresaId }),
      ctx.supabase.rpc("modulos_ativos_empresa", { _empresa_id: empresaId }),
    ]);
    const maxModulosBruto = novo.limites?.["max_modulos"];
    const maxModulos = typeof maxModulosBruto === "number" ? maxModulosBruto : null;
    if (novo.max_usuarios != null && Number(usuariosUsados ?? 0) > novo.max_usuarios) {
      throw new Error(
        `O plano ${novo.nome} permite ${novo.max_usuarios} usuário(s) e sua empresa tem ${usuariosUsados} ativo(s). Bloqueie ou exclua usuários antes de trocar de plano.`,
      );
    }
    if (maxModulos != null && Number(modulosUsados ?? 0) > maxModulos) {
      throw new Error(
        `O plano ${novo.nome} permite ${maxModulos} módulo(s) ativo(s) e sua empresa tem ${modulosUsados}. Desative módulos antes de trocar de plano.`,
      );
    }


    const podeAjustar =
      linha &&
      linha.provider === "mercadopago" &&
      linha.provider_subscription_id &&
      (linha.status === "ativa" || linha.status === "trial");
    if (!podeAjustar) {
      return { requerNovoCheckout: true, status: (linha?.status as string) ?? null };
    }
    if (linha.plano_codigo === novo.codigo) {
      return { requerNovoCheckout: false, status: linha.status as string, semAlteracao: true };
    }

    const { atualizarValorPreapproval, sincronizarPreapprovalNoBanco } = await import(
      "@/lib/assinatura-mp.server"
    );

    try {
      await atualizarValorPreapproval(data.ambiente, linha.provider_subscription_id as string, {
        valorCentavos: novo.valor_centavos,
        periodicidade: novo.periodicidade === "anual" ? "anual" : "mensal",
        moeda: novo.moeda ?? "BRL",
        motivo: `Conferência Rápida — ${novo.nome}`,
        externalReference: `user:${ctx.userId}|plano:${novo.codigo}`,
      });
    } catch (e) {
      console.error("Provedor recusou a alteração do plano", e);
      return { requerNovoCheckout: true, status: linha.status as string };
    }

    const campos = await sincronizarPreapprovalNoBanco(
      data.ambiente,
      linha.id as string,
      linha.provider_subscription_id as string,
      novo.codigo,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("assinaturas")
      .update({
        plano_id: novo.id,
        plano_codigo: novo.codigo,
        metadata: { external_reference: `user:${ctx.userId}|plano:${novo.codigo}` },
        updated_at: new Date().toISOString(),
      })
      .eq("id", linha.id as string);
    if (error) throw new Error(`Falha ao registrar o novo plano: ${error.message}`);

    await supabaseAdmin.from("auditoria").insert({
      user_id: ctx.userId,
      acao: "Plano da assinatura alterado",
      detalhe: `De ${linha.plano_codigo ?? "—"} para ${novo.codigo}`,
      tipo_acao: "cobranca",
      modulo: "assinaturas",
      resultado: "sucesso",
      lista: empresaId,
    });

    return {
      requerNovoCheckout: false,
      status: campos.status,
      planoCodigo: novo.codigo,
      valorCentavos: campos.valor_centavos,
    };
  });
