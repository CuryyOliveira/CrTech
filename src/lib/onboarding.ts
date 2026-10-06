/**
 * Regras de onboarding SaaS.
 *
 * A identificação de usuário legado NÃO depende da ausência de vínculo em
 * `empresa_usuarios`. São usadas duas fontes independentes:
 *  1. a lista explícita `public.usuarios_legados` (checada pela função
 *     `eh_usuario_legado`, que ignora RLS de forma segura);
 *  2. a data de criação da conta — qualquer conta criada antes do corte abaixo
 *     existia antes do onboarding comercial e é preservada.
 *
 * Assim, os 5 usuários atuais (inclusive os 4 sem empresa) nunca são enviados
 * ao onboarding nem bloqueados por assinatura.
 */
import { supabase } from "@/integrations/supabase/client";

/** Momento em que o onboarding SaaS passou a valer. Contas anteriores são legadas. */
export const CORTE_LEGADO = "2026-08-10T00:00:00.000Z";

export type SituacaoOnboarding =
  /** Usuário anterior ao SaaS: mantém acesso, módulos e permissões atuais. */
  | "legado"
  /** Convidado/vinculado a uma empresa existente: herda assinatura e permissões. */
  | "empresa"
  /** Novo usuário sem empresa: deve iniciar uma nova empresa. */
  | "nova_empresa"
  /** Sem sessão identificada. */
  | "desconhecido";

/** Retorna a situação de onboarding do usuário logado. */
export async function situacaoOnboarding(): Promise<SituacaoOnboarding> {
  const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const user = auth.user;
  if (!user) return "desconhecido";

  // 1) Lista explícita de legados.
  try {
    const { data: legado } = await supabase.rpc("eh_usuario_legado", { _user_id: user.id });
    if (legado === true) return "legado";
  } catch {
    /* sem rede: segue para as demais verificações */
  }

  // 2) Conta anterior ao início do onboarding comercial.
  if (user.created_at && new Date(user.created_at) < new Date(CORTE_LEGADO)) return "legado";

  // 3) Vínculo ativo com empresa existente.
  try {
    const { data: vinculo } = await supabase
      .from("empresa_usuarios")
      .select("empresa_id")
      .eq("user_id", user.id)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();
    if (vinculo) return "empresa";
  } catch {
    // Falha de consulta nunca envia um usuário existente ao onboarding.
    return "legado";
  }


  return "nova_empresa";
}

/** Conveniência: o usuário deve ver a tela de boas-vindas de nova empresa? */
export async function precisaOnboarding() {
  return (await situacaoOnboarding()) === "nova_empresa";
}
