import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import { useAcesso } from "@/hooks/useAcesso";
import { SETORES_LEGADO, type SetorEmpresa } from "@/lib/setores";

/** Todos os setores da empresa (inclui inativos) — usado na administração. */
export function useSetoresEmpresa(empresaId?: string | null) {
  return useQuery({
    queryKey: ["empresa-setores-admin", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_setores")
        .select("*")
        .eq("empresa_id", empresaId as string)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as SetorEmpresa[];
    },
  });
}

/**
 * Setores ativos disponíveis para escolha (cadastro/edição de usuários).
 * A RLS garante que só chegam setores da própria empresa. Quando a empresa
 * ainda não está resolvida (legado sem vínculo), usamos os setores legados.
 */
export function useSetoresDisponiveis() {
  const { acesso } = useAcesso();
  const empresaId = acesso?.empresaId ?? null;

  const { data = [], isLoading } = useQuery({
    queryKey: ["empresa-setores", empresaId],
    staleTime: 60_000,
    queryFn: async () => {
      // Offline: os setores vêm do cache local (mesma empresa).
      const consulta = db.from("empresa_setores").select("*").eq("ativo", true);
      const { data: rows, error } = await (empresaId
        ? consulta.eq("empresa_id", empresaId)
        : consulta
      )
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (rows ?? []) as unknown as SetorEmpresa[];
    },
  });

  const opcoes = data.length
    ? data.map((s) => ({ valor: s.codigo, label: s.nome }))
    : SETORES_LEGADO.map((s) => ({ valor: s.codigo, label: s.nome }));

  return { carregando: isLoading, setores: data, opcoes, empresaId };
}
