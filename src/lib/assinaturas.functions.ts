/**
 * Consultas de assinatura — sempre validadas no servidor.
 * O frontend nunca decide se um plano está ativo.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AmbienteCobranca = "sandbox" | "live";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type PlanoVigente = {
  assinatura_id: string | null;
  status: string;
  plano_codigo: string | null;
  periodicidade: string | null;
  valor_centavos: number | null;
  moeda: string | null;
  periodo_atual_fim: string | null;
  proxima_cobranca: string | null;
  trial_fim: string | null;
  modulos: string[];
  max_usuarios: number | null;
  recursos: Record<string, Json>;
  limites: Record<string, Json>;
};


/** Assinatura da empresa do usuário autenticado (fonte de verdade do backend). */
export const minhaAssinatura = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: empresaId } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });
    if (!empresaId) {
      return { empresaId: null, ativa: false, plano: null as PlanoVigente | null };
    }

    const [{ data: ativa }, { data: plano }] = await Promise.all([
      supabase.rpc("assinatura_ativa_empresa", {
        _empresa_id: empresaId as string,
        _ambiente: data.ambiente,
      }),
      supabase.rpc("plano_da_empresa", {
        _empresa_id: empresaId as string,
        _ambiente: data.ambiente,
      }),
    ]);

    return {
      empresaId: empresaId as string,
      ativa: Boolean(ativa),
      plano: (plano as PlanoVigente | null) ?? null,
    };
  });

/** Visão administrativa: empresas, planos, assinaturas e pagamentos. */
export const painelAssinaturas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ambiente: AmbienteCobranca }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: diag } = await supabase.rpc("diagnostico_permissoes", { _user_id: userId });
    const info = (diag as { eh_administrador?: boolean; nivel?: number } | null) ?? {};
    const ehAdmin = Boolean(info.eh_administrador);
    if (!ehAdmin) throw new Error("Acesso não autorizado");

    // Somente o Proprietário do Sistema vê todas as empresas cadastradas.
    const proprietario = (info.nivel ?? 0) >= 6;
    const { data: minhaEmpresa } = proprietario
      ? { data: null }
      : await supabase.rpc("empresa_do_usuario", { _user_id: userId });

    let queryAssinaturas = supabase
      .from("assinaturas")
      .select("*, empresas(nome)")
      .eq("ambiente", data.ambiente);
    if (!proprietario) queryAssinaturas = queryAssinaturas.eq("empresa_id", (minhaEmpresa as string) ?? "");

    let queryPagamentos = supabase
      .from("assinatura_pagamentos")
      .select("*")
      .eq("ambiente", data.ambiente);
    if (!proprietario) queryPagamentos = queryPagamentos.eq("empresa_id", (minhaEmpresa as string) ?? "");

    const [empresas, assinaturas, pagamentos, planos] = await Promise.all([
      supabase.from("empresas").select("*").order("nome"),
      queryAssinaturas.order("created_at", { ascending: false }),
      queryPagamentos.order("ocorrido_em", { ascending: false }).limit(200),
      supabase.from("planos").select("*").eq("ambiente", data.ambiente).order("ordem"),
    ]);

    const listaEmpresas = empresas.data ?? [];

    return {
      proprietario,
      // A lista de empresas cadastradas é exclusiva do Proprietário do Sistema.
      empresas: proprietario ? listaEmpresas : listaEmpresas.slice(0, 0),
      assinaturas: assinaturas.data ?? [],
      pagamentos: pagamentos.data ?? [],
      planos: planos.data ?? [],
    };
  });


