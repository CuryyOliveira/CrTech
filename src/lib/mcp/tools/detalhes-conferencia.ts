import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

type Item = {
  codigo: string | null;
  descricao: string | null;
  locacao: string | null;
  quantidade_esperada: number | null;
  quantidade_contada: number | null;
  status: string | null;
  observacoes: string | null;
};

export default defineTool({
  name: "detalhes_conferencia",
  title: "Detalhes da conferência",
  description:
    "Retorna os dados de uma conferência com o resumo de itens (total, corretos, divergências e pendentes) e a lista de divergências.",
  inputSchema: {
    conferencia_id: z.string().describe("UUID da conferência."),
    incluir_itens: z
      .boolean()
      .optional()
      .describe("Quando verdadeiro, retorna todos os itens além do resumo."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ conferencia_id, incluir_itens }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: conferencia, error: erroConf } = await supabase
      .from("conferencias")
      .select(
        "id,tipo,data,status,conferente,responsavel,almoxarife,observacoes,hora_inicio,hora_fim,tempo_trabalhado,quantidade_pausas,unidade_id,unidades(nome,tipo)",
      )
      .eq("id", conferencia_id)
      .maybeSingle();
    if (erroConf) return { content: [{ type: "text", text: erroConf.message }], isError: true };
    if (!conferencia) {
      return {
        content: [{ type: "text", text: "Conferência não encontrada ou sem permissão de acesso." }],
        isError: true,
      };
    }

    const { data: itens, error: erroItens } = await supabase
      .from("conferencia_itens")
      .select("codigo,descricao,locacao,quantidade_esperada,quantidade_contada,status,observacoes")
      .eq("conferencia_id", conferencia_id)
      .order("codigo", { ascending: true });
    if (erroItens) return { content: [{ type: "text", text: erroItens.message }], isError: true };

    const lista = (itens ?? []) as Item[];
    const contado = (i: Item) => i.quantidade_contada !== null && i.quantidade_contada !== undefined;
    const divergentes = lista.filter(
      (i) => contado(i) && Number(i.quantidade_contada) !== Number(i.quantidade_esperada ?? 0),
    );
    const resumo = {
      total: lista.length,
      corretos: lista.filter(
        (i) => contado(i) && Number(i.quantidade_contada) === Number(i.quantidade_esperada ?? 0),
      ).length,
      divergencias: divergentes.length,
      pendentes: lista.filter((i) => !contado(i)).length,
    };

    const payload = {
      conferencia,
      resumo,
      divergencias: divergentes,
      ...(incluir_itens ? { itens: lista } : {}),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
