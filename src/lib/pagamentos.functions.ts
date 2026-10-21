/**
 * Contratação de planos — toda decisão sensível acontece no servidor.
 * O aplicativo nunca manipula dados de cartão: o checkout é 100% do provedor.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AmbienteCobranca = "sandbox" | "live";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type PlanoDisponivel = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  periodicidade: string | null;
  valor_centavos: number | null;
  moeda: string;
  dias_trial: number;
  modulos: string[];
  max_usuarios: number | null;
  recursos: Record<string, Json>;
  limites: Record<string, Json>;
  provider_price_id: string | null;
};

/** Catálogo de planos ativos + assinatura vigente da empresa do usuário. */
export const planosDisponiveis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: empresaId } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });

    const { data: planos } = await supabase
      .from("planos")
      .select("*")
      .eq("ambiente", data.ambiente)
      .eq("ativo", true)
      .order("ordem");

    // Fonte de verdade: a confirmação do provedor. Assinaturas canceladas,
    // pausadas, rejeitadas, inexistentes ou de provedores antigos não contam.
    let confirmada: Record<string, Json> | null = null;
    let avisoAssinatura: string | null = null;
    if (empresaId) {
      const { resolverAssinaturaConfirmada } = await import("@/lib/assinatura-confirmada.server");
      const resultado = await resolverAssinaturaConfirmada(
        supabase as never,
        empresaId as string,
        data.ambiente,
      );
      confirmada = (resultado.assinatura as unknown as Record<string, Json> | null) ?? null;
      avisoAssinatura = resultado.aviso;
    }

    return {
      empresaId: (empresaId as string | null) ?? null,
      ativa: Boolean(confirmada),
      planoAtual: confirmada,
      avisoAssinatura,
      planos: (planos ?? []) as unknown as PlanoDisponivel[],

    };
  });

/**
 * Cadastra a empresa do próprio administrador e cria o vínculo de proprietário.
 * Somente administradores conseguem executar (garantido pelas políticas de
 * acesso do banco). Se o usuário já possui empresa, apenas devolve o vínculo.
 */
export const cadastrarMinhaEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { nome: string; cnpj?: string | null }) => {
    const nome = (data.nome ?? "").trim();
    if (nome.length < 2) throw new Error("Informe o nome da empresa.");
    return { nome, cnpj: (data.cnpj ?? "").trim() || null };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existente } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });
    if (existente) return { empresaId: existente as string, criada: false };

    const { data: empresa, error } = await supabase
      .from("empresas")
      .insert({ nome: data.nome, cnpj: data.cnpj, created_by: userId })
      .select("id")
      .single();
    if (error || !empresa) {
      throw new Error(
        "Não foi possível cadastrar a empresa. Apenas administradores podem realizar o cadastro.",
      );
    }

    const empresaId = (empresa as { id: string }).id;
    const { error: erroVinculo } = await supabase
      .from("empresa_usuarios")
      .insert({ empresa_id: empresaId, user_id: userId, papel: "proprietario", ativo: true });
    if (erroVinculo) {
      throw new Error("Empresa cadastrada, mas o vínculo do usuário falhou. Tente novamente.");
    }

    return { empresaId, criada: true };
  });




/**
 * Consulta o estado da assinatura após o checkout. O status devolvido é o
 * confirmado pelo provedor — nunca apenas o gravado localmente.
 */
export const statusAssinaturaEmpresa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: empresaId } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });
    if (!empresaId) return { status: null as string | null, planoCodigo: null as string | null };

    const { resolverAssinaturaConfirmada } = await import("@/lib/assinatura-confirmada.server");
    const { assinatura } = await resolverAssinaturaConfirmada(
      supabase as never,
      empresaId as string,
      data.ambiente,
    );

    return {
      status: assinatura?.status ?? null,
      planoCodigo: assinatura?.plano_codigo ?? null,
    };
  });


/**
 * Inicia o checkout de assinatura no Mercado Pago.
 * A empresa é resolvida no servidor (nunca vem do frontend) e o link devolvido
 * é o checkout oficial do provedor — o cartão nunca passa pelo aplicativo.
 */
export const iniciarCheckoutMercadoPago = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      planoCodigo: string;
      ambiente: AmbienteCobranca;
      origem: string;
      emailPagador?: string | null;
    }) => {
      const codigo = (data.planoCodigo ?? "").trim();
      if (!codigo) throw new Error("Plano não informado.");
      const ambiente: AmbienteCobranca = data.ambiente === "live" ? "live" : "sandbox";
      const emailPagador = (data.emailPagador ?? "").trim().toLowerCase() || null;
      if (emailPagador && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailPagador)) {
        throw new Error("Informe um e-mail válido da sua conta Mercado Pago.");
      }
      return { planoCodigo: codigo, ambiente, origem: (data.origem ?? "").trim(), emailPagador };
    },
  )

  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: empresaId } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });
    if (!empresaId) {
      throw new Error(
        "Seu usuário não está vinculado a nenhuma empresa. Cadastre a empresa antes de contratar um plano.",
      );
    }

    const { data: plano } = await supabase
      .from("planos")
      .select("codigo, nome, ativo, valor_centavos, moeda, periodicidade, dias_trial")
      .eq("codigo", data.planoCodigo)
      .eq("ambiente", data.ambiente)
      .maybeSingle();

    const linha = plano as
      | {
          codigo: string;
          nome: string;
          ativo: boolean;
          valor_centavos: number | null;
          moeda: string | null;
          periodicidade: string | null;
          dias_trial: number | null;
        }
      | null;
    if (!linha?.ativo) throw new Error("Plano indisponível para contratação.");
    if (!linha.valor_centavos || linha.valor_centavos <= 0) {
      throw new Error(`O plano "${linha.nome}" não possui valor configurado para cobrança.`);
    }

    const emailUsuario = (claims as { email?: string } | null)?.email;
    if (!emailUsuario) throw new Error("Não foi possível identificar o e-mail do usuário.");

    /**
     * Em ambiente de teste o Mercado Pago exige que pagador e vendedor sejam
     * ambos usuários de teste ("Both payer and collector must be real or test
     * users"). Com o e-mail real do usuário o checkout abre no ambiente real e
     * os cartões de teste não são aceitos — o botão "Confirmar" nunca habilita.
     * Por isso, no sandbox usamos o comprador de teste configurado.
     */
    const emailTeste = process.env["MERCADOPAGO_TEST_PAYER_EMAIL"];
    /**
     * Em produção o e-mail do pagador precisa ser exatamente o da conta
     * Mercado Pago usada no checkout. Se divergir (ou se for a própria conta
     * que recebe os pagamentos), o provedor mantém o botão "Confirmar"
     * desabilitado. Por isso aceitamos o e-mail informado pelo assinante.
     */
    const email =
      data.ambiente === "sandbox" && emailTeste
        ? emailTeste.trim()
        : (data.emailPagador ?? emailUsuario);

    const { criarPreapproval, urlRetornoValida, emailContaCobranca } = await import(
      "@/lib/mercadopago.server"
    );

    const emailColetor = await emailContaCobranca(data.ambiente);
    if (emailColetor && email.trim().toLowerCase() === emailColetor) {
      throw new Error(
        "Esta é a conta Mercado Pago que recebe os pagamentos e não pode assinar o próprio plano. Use outra conta Mercado Pago para concluir a assinatura.",
      );
    }

    const backUrl = `${urlRetornoValida(data.origem)}/planos?checkout=sucesso`;


    let preapproval;
    try {
      preapproval = await criarPreapproval(data.ambiente, {
        payerEmail: email,
        externalReference: `user:${userId}|plano:${linha.codigo}`,
        backUrl,
        motivo: `Conferência Rápida — ${linha.nome}`,
        valorCentavos: linha.valor_centavos,
        periodicidade: linha.periodicidade === "anual" ? "anual" : "mensal",
        moeda: linha.moeda ?? "BRL",
        diasTrial: linha.dias_trial ?? 0,
      });
    } catch (e) {
      // Log técnico sem dados sensíveis (nenhuma credencial, nenhum cartão).
      console.error("Falha ao criar assinatura no provedor", {
        ambiente: data.ambiente,
        plano: linha.codigo,
        valor_centavos: linha.valor_centavos,
        moeda: linha.moeda ?? "BRL",
        periodicidade: linha.periodicidade,
        dias_trial: linha.dias_trial,
        pagador_de_teste: data.ambiente === "sandbox" && Boolean(emailTeste),
        erro: e instanceof Error ? e.message : String(e),
      });
      throw new Error(
        "Não foi possível iniciar o checkout do plano agora. Tente novamente em instantes.",
      );
    }

    console.log("Assinatura criada no provedor", {
      preapproval_id: preapproval.id,
      status: preapproval.status,
      ambiente: data.ambiente,
      plano: linha.codigo,
      valor: (linha.valor_centavos / 100).toFixed(2),
      moeda: linha.moeda ?? "BRL",
      dias_trial: linha.dias_trial ?? 0,
    });

    const link =
      (data.ambiente === "sandbox" ? preapproval.sandbox_init_point : null) ??
      preapproval.init_point;
    if (!link) throw new Error("O provedor não devolveu o link do checkout. Tente novamente.");

    return { url: link, preapprovalId: preapproval.id, empresaId: empresaId as string };
  });

