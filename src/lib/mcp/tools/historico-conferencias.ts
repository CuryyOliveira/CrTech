import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "historico_conferencias",
  title: "Histórico de conferências",
  description:
    "Consulta o histórico permanente de conferências com quantidades previstas, conferidas, divergências, percentual e duração.",
  inputSchema: {
    modulo: z.string().optional().describe("Filtra pelo módulo, ex.: FROTA, ESTOQUE_AGRICOLA."),
    de: z.string().optional().describe("Data inicial no formato AAAA-MM-DD."),
    ate: z.string().optional().describe("Data final no formato AAAA-MM-DD."),
    limite: z.number().int().optional().describe("Máximo de registros (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ modulo, de, ate, limite }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("historico_conferencias")
      .select(
        "id,conferencia_id,nome,usuario_email,perfil,setor,modulo,modulo_titulo,lista,data,hora_inicio,hora_fim,duracao_segundos,tempo_trabalhado,quantidade_prevista,quantidade_conferida,divergencias,percentual,status",
      )
      .order("data", { ascending: false })
      .order("hora_inicio", { ascending: false })
      .limit(Math.min(Math.max(limite ?? 20, 1), 100));
    if (modulo?.trim()) query = query.eq("modulo", modulo.trim());
    if (de?.trim()) query = query.gte("data", de.trim());
    if (ate?.trim()) query = query.lte("data", ate.trim());

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { total: data?.length ?? 0, historico: data ?? [] },
    };
  },
});
