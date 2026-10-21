import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/app";
import type { AuditoriaRow, HistoricoRow } from "@/lib/audit";
import {
  CONFIG_ALERTAS_PADRAO,
  consolidar,
  type ConfigAlertas,
  type Notificacao,
} from "@/lib/notificacoes";

const LIMITE = 2000;

/** Limites configurados usados na geração dos alertas. */
export function useConfigAlertas() {
  return useQuery({
    queryKey: ["config-alertas"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ConfigAlertas> => {
      const { data } = await db
        .from("configuracoes_sistema")
        .select("valor")
        .eq("chave", "alertas")
        .maybeSingle();
      return { ...CONFIG_ALERTAS_PADRAO, ...((data?.valor ?? {}) as Partial<ConfigAlertas>) };
    },
  });
}

/**
 * Notificações consolidadas: sempre derivadas do Histórico Operacional e do
 * Log de Auditoria (fonte única), com o estado de leitura vindo do banco.
 */
export function useNotificacoes() {
  const qc = useQueryClient();
  const { data: config = CONFIG_ALERTAS_PADRAO } = useConfigAlertas();

  const historico = useQuery({
    queryKey: ["notif-historico"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await db
        .from("historico_conferencias")
        .select("*")
        .order("hora_inicio", { ascending: false })
        .range(0, LIMITE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoRow[];
    },
  });

  const auditoria = useQuery({
    queryKey: ["notif-auditoria"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await db
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, LIMITE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditoriaRow[];
    },
  });

  const leituras = useQuery({
    queryKey: ["notif-leituras"],
    queryFn: async () => {
      const { data, error } = await db.from("notificacao_leituras").select("chave");
      if (error) throw new Error(error.message);
      return new Set(((data ?? []) as { chave: string }[]).map((l) => l.chave));
    },
  });

  const notificacoes: (Notificacao & { lida: boolean })[] = useMemo(() => {
    const lidas = leituras.data ?? new Set<string>();
    return consolidar(historico.data ?? [], auditoria.data ?? [], config).map((n) => ({
      ...n,
      lida: lidas.has(n.chave),
    }));
  }, [historico.data, auditoria.data, leituras.data, config]);

  const marcarLidas = async (chaves: string[]) => {
    const novas = chaves.filter((c) => !(leituras.data ?? new Set()).has(c));
    if (!novas.length) return;
    await db.from("notificacao_leituras").insert(novas.map((chave) => ({ chave })));
    await qc.invalidateQueries({ queryKey: ["notif-leituras"] });
  };

  return {
    notificacoes,
    naoLidas: notificacoes.filter((n) => !n.lida).length,
    carregando: historico.isLoading || auditoria.isLoading || leituras.isLoading,
    marcarLidas,
  };
}
