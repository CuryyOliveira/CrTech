import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NIVEL_ADMIN, temNivel, type Perfil } from "@/lib/permissions";

export type ItemStatusPagamento = {
  chave: string;
  titulo: string;
  descricao: string;
  configurado: boolean;
  obrigatorio: boolean;
};

export type StatusPagamentos = {
  gerado_em: string;
  ambiente_app: "live" | "sandbox";
  secrets: ItemStatusPagamento[];
  webhook: {
    endpoint: string;
    hmac_ativo: boolean;
    ativo: boolean;
    eventos_total: number;
    ultimo_evento_em: string | null;
    ultimo_evento_tipo: string | null;
  };
  pronto: boolean;
};

/**
 * Situação da integração de pagamentos (Mercado Pago) para o administrador.
 * Retorna apenas se cada credencial está presente — nunca o valor.
 */
export const statusPagamentos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StatusPagamentos> => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: perfilRow } = await supabase
      .from("user_profiles")
      .select("perfil")
      .eq("user_id", userId)
      .maybeSingle();

    const perfil = (perfilRow?.perfil ?? null) as Perfil | null;
    if (!perfil || !temNivel(perfil, NIVEL_ADMIN)) {
      throw new Error("Acesso restrito a administradores.");
    }

    const tem = (nome: string) => Boolean((process.env[nome] ?? "").trim());

    const ambienteApp =
      (process.env["VITE_COBRANCA_AMBIENTE"] ?? "").trim() === "live" ? "live" : "sandbox";

    const secrets: ItemStatusPagamento[] = [
      {
        chave: "MERCADOPAGO_ACCESS_TOKEN",
        titulo: "Token de produção",
        descricao: "Usado somente quando o ambiente de cobrança está em produção (live).",
        configurado: tem("MERCADOPAGO_ACCESS_TOKEN"),
        obrigatorio: ambienteApp === "live",
      },
      {
        chave: "MERCADOPAGO_TEST_ACCESS_TOKEN",
        titulo: "Token de teste (Sandbox)",
        descricao: "Usado somente no ambiente de testes, sem cobranças reais.",
        configurado: tem("MERCADOPAGO_TEST_ACCESS_TOKEN"),
        obrigatorio: ambienteApp === "sandbox",
      },
      {
        chave: "MERCADOPAGO_WEBHOOK_SECRET",
        titulo: "Segredo do webhook (produção)",
        descricao: "Valida a assinatura HMAC das notificações recebidas do Mercado Pago.",
        configurado: tem("MERCADOPAGO_WEBHOOK_SECRET"),
        obrigatorio: true,
      },
      {
        chave: "MERCADOPAGO_TEST_WEBHOOK_SECRET",
        titulo: "Segredo do webhook (teste)",
        descricao: "Opcional: valida notificações da configuração de testes.",
        configurado: tem("MERCADOPAGO_TEST_WEBHOOK_SECRET"),
        obrigatorio: false,
      },
    ];

    let eventosTotal = 0;
    let ultimoEm: string | null = null;
    let ultimoTipo: string | null = null;

    const { count } = await supabase
      .from("webhook_eventos_pagamento")
      .select("id", { count: "exact", head: true });
    eventosTotal = count ?? 0;

    const { data: ultimo } = await supabase
      .from("webhook_eventos_pagamento")
      .select("event_type,recebido_em")
      .order("recebido_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimo) {
      ultimoEm = (ultimo.recebido_em as string) ?? null;
      ultimoTipo = (ultimo.event_type as string) ?? null;
    }

    const hmacAtivo = tem("MERCADOPAGO_WEBHOOK_SECRET") || tem("MERCADOPAGO_TEST_WEBHOOK_SECRET");

    const obrigatoriosOk = secrets.filter((s) => s.obrigatorio).every((s) => s.configurado);

    return {
      gerado_em: new Date().toISOString(),
      ambiente_app: ambienteApp,
      secrets,
      webhook: {
        endpoint: "/api/public/payments/mercadopago",
        hmac_ativo: hmacAtivo,
        ativo: hmacAtivo,
        eventos_total: eventosTotal,
        ultimo_evento_em: ultimoEm,
        ultimo_evento_tipo: ultimoTipo,
      },
      pronto: obrigatoriosOk && hmacAtivo,
    };
  });
