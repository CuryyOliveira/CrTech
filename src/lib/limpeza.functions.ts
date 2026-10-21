import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { anteriorAoCorte } from "@/lib/onboarding-regras";
import { NIVEL_ADMIN, ehProprietario, temNivel, type Perfil } from "@/lib/permissions";

type Ctx = { supabase: any; userId: string };

async function exigirAdmin(context: Ctx): Promise<Perfil> {
  const { data, error } = await context.supabase
    .from("user_profiles")
    .select("perfil,bloqueado")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível validar suas permissões: ${error.message}`);
  if (!data) throw new Error("Perfil de acesso não encontrado para o seu usuário");
  if (data.bloqueado) throw new Error("Seu acesso está bloqueado");
  if (!temNivel(data.perfil as Perfil, NIVEL_ADMIN))
    throw new Error(
      "Acesso não autorizado: a limpeza exige nível Administrador, Super Administrador ou Proprietário",
    );
  return data.perfil as Perfil;
}

/**
 * Escopo da limpeza. Empresas SaaS só apagam os próprios dados. Proprietário do
 * Sistema e contas legadas (anteriores ao SaaS, sem vínculo de empresa) mantêm
 * a visão global que já possuíam. `null` = sem restrição de empresa.
 */
async function escopoEmpresa(context: Ctx): Promise<string | null> {
  const perfil = await exigirAdmin(context);
  const [{ data: perfilRow }, { data: legado }, { data: empresaId }] = await Promise.all([
    context.supabase.from("user_profiles").select("created_at").eq("user_id", context.userId).maybeSingle(),
    context.supabase.rpc("eh_usuario_legado", { _user_id: context.userId }),
    context.supabase.rpc("empresa_do_usuario", { _user_id: context.userId }),
  ]);
  if (ehProprietario(perfil)) return null;
  if (legado === true || anteriorAoCorte(perfilRow?.created_at)) return null;
  if (!empresaId)
    throw new Error("Sua conta não está vinculada a uma empresa: limpeza indisponível");
  return empresaId as string;
}



export type ResultadoLimpeza = {
  corte: string;
  conferencias: number;
  itens: number;
  pausas: number;
  historicos: number;
  divergencias: number;
  notificacoes: number;
  preservadas: number;
  historicosPreservados: number;
};

/**
 * Remove definitivamente conferências e históricos de teste iniciados ANTES do
 * horário de corte. Nada a partir do corte é alterado (inclusive conferências
 * em andamento ou pausadas).
 */
export const limparDadosTeste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { corte: string; simular?: boolean }) => {
    if (!d?.corte || Number.isNaN(new Date(d.corte).getTime()))
      throw new Error("Horário de corte inválido");
    return { corte: new Date(d.corte).toISOString(), simular: !!d.simular };
  })
  .handler(async ({ data, context }): Promise<ResultadoLimpeza> => {
    const empresa = await escopoEmpresa(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const corte = data.corte;

    // Escopo de unidades da empresa do solicitante (null = visão global).
    let unidadeIds: string[] | null = null;
    if (empresa) {
      const un = await supabaseAdmin.from("unidades").select("id").eq("empresa_id", empresa);
      if (un.error) throw new Error(un.error.message);
      unidadeIds = (un.data ?? []).map((u: { id: string }) => u.id);
      if (!unidadeIds.length) unidadeIds = ["00000000-0000-0000-0000-000000000000"];
    }

    const escopoConferencias = <T extends { in: any }>(q: T): T =>
      unidadeIds ? (q.in("unidade_id", unidadeIds) as T) : q;
    const escopoEmpresaCol = <T extends { eq: any }>(q: T): T =>
      empresa ? (q.eq("empresa_id", empresa) as T) : q;

    const antigas = await escopoConferencias(
      supabaseAdmin.from("conferencias").select("id").lt("hora_inicio", corte),
    );
    if (antigas.error) throw new Error(antigas.error.message);
    const ids = (antigas.data ?? []).map((c: { id: string }) => c.id);

    const itensQtd = ids.length
      ? (await supabaseAdmin
          .from("conferencia_itens")
          .select("id", { count: "exact", head: true })
          .in("conferencia_id", ids)).count ?? 0
      : 0;

    const divergencias = ids.length
      ? (await supabaseAdmin
          .from("conferencia_itens")
          .select("id,quantidade_esperada,quantidade_contada")
          .in("conferencia_id", ids)).data?.filter(
          (i: any) => i.quantidade_contada != null && Number(i.quantidade_contada) !== Number(i.quantidade_esperada),
        ).length ?? 0
      : 0;
    const pausas = ids.length
      ? (await supabaseAdmin
          .from("conferencia_pausas")
          .select("id", { count: "exact", head: true })
          .in("conferencia_id", ids)).count ?? 0
      : 0;
    const historicos =
      (await escopoEmpresaCol(
        supabaseAdmin
          .from("historico_conferencias")
          .select("id", { count: "exact", head: true })
          .lt("hora_inicio", corte),
      )).count ?? 0;

    const notificacoes =
      ((ids.length
        ? (await supabaseAdmin
            .from("notificacoes_conferencia")
            .select("id", { count: "exact", head: true })
            .in("conferencia_id", ids)).count ?? 0
        : 0) +
        ((await escopoEmpresaCol(
          supabaseAdmin
            .from("notificacoes_conferencia")
            .select("id", { count: "exact", head: true })
            .is("conferencia_id", null)
            .lt("created_at", corte),
        )).count ?? 0));

    if (!data.simular && ids.length) {
      // Itens, pausas, histórico, notificações e e-mails são removidos em
      // cascata pelo banco ao excluir a conferência.
      const del = await supabaseAdmin.from("conferencias").delete().in("id", ids);
      if (del.error) throw new Error(del.error.message);
    }

    if (!data.simular) {
      // Notificações órfãs de execuções de limpeza anteriores.
      await escopoEmpresaCol(
        supabaseAdmin
          .from("notificacoes_conferencia")
          .delete()
          .is("conferencia_id", null)
          .lt("created_at", corte),
      );
      const delHist = await escopoEmpresaCol(
        supabaseAdmin.from("historico_conferencias").delete().lt("hora_inicio", corte),
      );
      if (delHist.error) throw new Error(delHist.error.message);
    }

    const preservadas =
      (await escopoConferencias(
        supabaseAdmin.from("conferencias").select("id", { count: "exact", head: true }).gte("hora_inicio", corte),
      )).count ?? 0;
    const historicosPreservados =
      (await escopoEmpresaCol(
        supabaseAdmin
          .from("historico_conferencias")
          .select("id", { count: "exact", head: true })
          .gte("hora_inicio", corte),
      )).count ?? 0;


    return {
      corte,
      conferencias: ids.length,
      itens: itensQtd,
      pausas,
      historicos,
      divergencias,
      notificacoes,
      preservadas,
      historicosPreservados,
    };
  });
