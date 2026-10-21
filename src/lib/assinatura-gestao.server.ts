/**
 * Auxiliares somente-servidor da gestão de assinatura.
 */
export type ContextoAuth = {
  supabase: any;
  userId: string;
};

export type AmbienteCobranca = "sandbox" | "live";

export async function exigirAdministrador(context: ContextoAuth) {
  const { data: diag } = await context.supabase.rpc("diagnostico_permissoes", {
    _user_id: context.userId,
  });
  const info = (diag as { eh_administrador?: boolean } | null) ?? {};
  if (!info.eh_administrador) throw new Error("Acesso não autorizado");
}

export async function empresaDoUsuario(context: ContextoAuth): Promise<string | null> {
  const { data } = await context.supabase.rpc("empresa_do_usuario", {
    _user_id: context.userId,
  });
  return typeof data === "string" && data ? data : null;
}

export async function assinaturaVigente(context: ContextoAuth, ambiente: AmbienteCobranca) {
  const empresaId = await empresaDoUsuario(context);
  if (!empresaId) return { empresaId: null, linha: null as any };
  const { data } = await context.supabase
    .from("assinaturas")
    .select("*, planos(nome, max_usuarios, modulos, limites)")
    .eq("empresa_id", empresaId)
    .eq("ambiente", ambiente)
    // Registros de provedores descontinuados nunca representam a assinatura vigente.
    .eq("provider", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { empresaId, linha: data as any };
}

