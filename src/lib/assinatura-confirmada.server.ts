/**
 * Resolução da assinatura vigente usando o provedor como fonte de verdade.
 * Somente uma assinatura confirmada como ativa ou em período de teste pelo
 * Mercado Pago libera o plano. Status locais (inclusive de provedores antigos)
 * nunca são suficientes por si.
 */
export type AmbienteCobranca = "sandbox" | "live";

export type AssinaturaConfirmada = {
  status: string;
  plano_codigo: string | null;
  periodicidade: string | null;
  valor_centavos: number | null;
  moeda: string | null;
  proxima_cobranca: string | null;
  trial_fim: string | null;
} | null;

const STATUS_LIBERADOS = new Set(["ativa", "trial"]);

/**
 * Devolve a assinatura confirmada pelo provedor (ou null quando não existe
 * nenhuma confirmada). Também grava no banco o estado autoritativo lido.
 */
export async function resolverAssinaturaConfirmada(
  supabase: {
    from: (t: string) => any;
  },
  empresaId: string,
  ambiente: AmbienteCobranca,
): Promise<{ assinatura: AssinaturaConfirmada; aviso: string | null }> {
  const { data: linhas } = await supabase
    .from("assinaturas")
    .select(
      "id, status, plano_codigo, provider, provider_subscription_id, periodicidade, valor_centavos, moeda, proxima_cobranca, trial_fim",
    )
    .eq("empresa_id", empresaId)
    .eq("ambiente", ambiente)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = (linhas ?? []) as Array<Record<string, any>>;
  let aviso: string | null = null;

  for (const linha of rows) {
    // Assinaturas de provedores anteriores não podem ser reconfirmadas:
    // por definição não liberam o plano.
    if (linha["provider"] !== "mercadopago" || !linha["provider_subscription_id"]) continue;

    try {
      const { sincronizarPreapprovalNoBanco } = await import("@/lib/assinatura-mp.server");
      const campos = await sincronizarPreapprovalNoBanco(
        ambiente,
        linha["id"] as string,
        linha["provider_subscription_id"] as string,
        (linha["plano_codigo"] as string | null) ?? null,
      );
      if (STATUS_LIBERADOS.has(campos.status)) {
        return {
          assinatura: {
            status: campos.status,
            plano_codigo: campos.plano_codigo,
            periodicidade: campos.periodicidade,
            valor_centavos: campos.valor_centavos,
            moeda: campos.moeda,
            proxima_cobranca: campos.proxima_cobranca,
            trial_fim: campos.trial_fim,
          },
          aviso: null,
        };
      }
    } catch (e) {
      console.error("Falha ao reconfirmar assinatura no provedor", e);
      const msg = e instanceof Error ? e.message : String(e);
      // Rejeição definitiva do provedor (assinatura criada por outra conta /
      // credencial): repetir não resolve, então a mensagem precisa ser clara.
      aviso = /not valid for callerId|Mercado Pago 40[13]/.test(msg)
        ? "Esta assinatura não pertence à conta do Mercado Pago configurada atualmente. Contrate novamente o plano para regularizar o acesso."
        : "Não foi possível reconfirmar a assinatura no provedor agora. Tente novamente em instantes.";
    }
  }

  return { assinatura: null, aviso };
}
