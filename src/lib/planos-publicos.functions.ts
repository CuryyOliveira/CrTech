/**
 * Catálogo público de planos.
 * A vitrine de preços lê os mesmos registros usados no checkout, para que o
 * valor exibido no site nunca divirja do valor efetivamente cobrado.
 */
import { createServerFn } from "@tanstack/react-start";

export type PlanoPublico = {
  codigo: string;
  nome: string;
  descricao: string | null;
  valorCentavos: number | null;
  moeda: string;
  periodicidade: string | null;
  diasTrial: number;
  maxUsuarios: number | null;
  maxModulos: number | null;
  ordem: number;
};

/** Planos ativos do ambiente de cobrança informado (leitura pública). */
export const planosPublicos = createServerFn({ method: "GET" })
  .inputValidator((data: { ambiente: "sandbox" | "live" }) => ({
    ambiente: data?.ambiente === "sandbox" ? ("sandbox" as const) : ("live" as const),
  }))
  .handler(async ({ data }): Promise<PlanoPublico[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: linhas, error } = await supabaseAdmin
      .from("planos")
      .select(
        "codigo, nome, descricao, valor_centavos, moeda, periodicidade, dias_trial, max_usuarios, limites, ordem",
      )
      .eq("ambiente", data.ambiente)
      .eq("ativo", true)
      .order("ordem", { ascending: true });
    if (error) throw new Error(error.message);

    return (linhas ?? []).map((p) => {
      const limites = (p.limites ?? {}) as Record<string, unknown>;
      const max = limites["max_modulos"];
      return {
        codigo: p.codigo,
        nome: p.nome,
        descricao: p.descricao ?? null,
        valorCentavos: p.valor_centavos ?? null,
        moeda: p.moeda ?? "BRL",
        periodicidade: p.periodicidade ?? null,
        diasTrial: p.dias_trial ?? 0,
        maxUsuarios: p.max_usuarios ?? null,
        maxModulos: typeof max === "number" ? max : null,
        ordem: p.ordem ?? 0,
      };
    });
  });
