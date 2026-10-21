import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAcesso } from "@/hooks/useAcesso";
import { usePermissoes } from "@/hooks/usePermissoes";
import { db } from "@/lib/app";
import { useOffline } from "@/hooks/useOffline";
import {
  legadoMemorizado,
  resolverEmpresa,
  resolverLegado,
  type ModuloEmpresa,
  type ModuloResolvido,
} from "@/lib/modulos";
import type { ModuloId } from "@/lib/permissions";

/**
 * Fonte única dos módulos disponíveis para o usuário:
 * módulos da própria empresa (empresa_modulos) e, exclusivamente para a
 * estrutura legada, os módulos históricos. Nenhuma empresa nova herda
 * módulos legados nem usa lista global como fallback.
 */
export function useModulos() {
  const offline = useOffline();
  const { carregando: carregandoPerfil, modulos: modulosPerfil } = usePermissoes();
  const { carregando, acesso, modulos: modulosAcesso } = useAcesso();
  const empresaId = acesso?.empresaId ?? null;

  // Offline os módulos da empresa vêm do cache local (isolados por empresa_id).
  const { data: doBanco = [], isLoading: carregandoEmpresa } = useQuery({
    queryKey: ["empresa-modulos", empresaId, offline],
    enabled: Boolean(empresaId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("empresa_modulos")
        .select("*")
        .eq("empresa_id", empresaId as string)
        .eq("excluido", false)
        .eq("ativo", true)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ModuloEmpresa[];
    },
  });

  // Offline não há servidor para decidir: só a marca de legado libera os
  // módulos históricos, evitando que uma empresa nova os veja pelo perfil.
  const legadoOffline = legadoMemorizado();
  const origemLegados = offline ? (legadoOffline ? modulosPerfil : []) : modulosAcesso;

  const legados = origemLegados
    .map((m) => resolverLegado(m.id as ModuloId))
    .filter((m): m is ModuloResolvido => Boolean(m));

  const dinamicos = doBanco.map(resolverEmpresa);


  return {
    carregando: offline ? carregandoPerfil : carregando || carregandoEmpresa,
    modulos: [...dinamicos, ...legados],
    legados,
    dinamicos,
    empresaId,
  };
}

/** Lista completa de módulos da empresa para a administração (inclui inativos). */
export function useModulosEmpresa(empresaId?: string | null) {
  return useQuery({
    queryKey: ["empresa-modulos-admin", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_modulos")
        .select("*")
        .eq("empresa_id", empresaId as string)
        .eq("excluido", false)
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ModuloEmpresa[];
    },
  });
}
