import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "meu_perfil",
  title: "Meu perfil de acesso",
  description:
    "Retorna o perfil de acesso do usuário autenticado (nome, perfil, setor e último acesso).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("nome,perfil,setor,bloqueado,ultimo_acesso")
      .eq("user_id", ctx.getUserId() ?? "")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const perfil = { email: ctx.getUserEmail() ?? null, ...(data ?? {}) };
    return {
      content: [{ type: "text", text: JSON.stringify(perfil) }],
      structuredContent: { perfil },
    };
  },
});
