import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "listar_conferencias",
  title: "Listar conferências",
  description:
    "Lista as conferências (em andamento, pausadas, concluídas ou canceladas) com unidade, conferente, data e tempo trabalhado.",
  inputSchema: {
    status: z.string().optional().describe("Filtra pelo status da conferência, ex.: concluida."),
    unidade_id: z.string().optional().describe("Filtra por uma unidade específica (UUID)."),
    limite: z.number().int().optional().describe("Máximo de registros (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, unidade_id, limite }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("conferencias")
      .select(
        "id,tipo,data,status,conferente,responsavel,hora_inicio,hora_fim,tempo_trabalhado,quantidade_pausas,unidade_id,unidades(nome,tipo)",
      )
      .order("data", { ascending: false })
      .order("hora_inicio", { ascending: false })
      .limit(Math.min(Math.max(limite ?? 20, 1), 100));
    if (status?.trim()) query = query.eq("status", status.trim());
    if (unidade_id?.trim()) query = query.eq("unidade_id", unidade_id.trim());

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { total: data?.length ?? 0, conferencias: data ?? [] },
    };
  },
});
