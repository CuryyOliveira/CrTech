import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const TIPOS = ["caminhao", "caixa", "prateleira", "caixa_industria", "prateleira_industria"] as const;

export default defineTool({
  name: "listar_unidades",
  title: "Listar unidades",
  description:
    "Lista as unidades cadastradas (caminhões, caixas de ferramentas e prateleiras de estoque) do usuário autenticado.",
  inputSchema: {
    tipo: z.enum(TIPOS).optional().describe("Filtra por tipo de unidade."),
    busca: z.string().optional().describe("Texto livre para filtrar por nome."),
    limite: z.number().int().optional().describe("Máximo de registros (padrão 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tipo, busca, limite }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("unidades")
      .select("id,nome,tipo,setor,placa,frota,modelo,gestor,ativo")
      .eq("ativo", true)
      .order("nome", { ascending: true })
      .limit(Math.min(Math.max(limite ?? 50, 1), 200));
    if (tipo) query = query.eq("tipo", tipo);
    if (busca?.trim()) query = query.ilike("nome", `%${busca.trim()}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { total: data?.length ?? 0, unidades: data ?? [] },
    };
  },
});
