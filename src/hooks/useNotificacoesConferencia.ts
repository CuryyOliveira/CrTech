import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import {
  CHAVE_CONFIG_EMAILS,
  CONFIG_EMAILS_PADRAO,
  indicadores,
  type ConfigEmails,
  type NotificacaoConferenciaRow,
  type NotificacaoEmailRow,
} from "@/lib/notificacoes-conferencia";

const LIMITE = 500;

/** Destinatários e domínio remetente configurados na Central Administrativa. */
export function useConfigEmails() {
  return useQuery({
    queryKey: ["config", CHAVE_CONFIG_EMAILS],
    staleTime: 60000,
    queryFn: async (): Promise<ConfigEmails> => {
      const { data } = await db
        .from("configuracoes_sistema")
        .select("valor")
        .eq("chave", CHAVE_CONFIG_EMAILS)
        .maybeSingle();
      return { ...CONFIG_EMAILS_PADRAO, ...((data?.valor ?? {}) as Partial<ConfigEmails>) };
    },
  });
}

/**
 * Notificações de conferência (todos os eventos) com atualização em tempo real
 * e o histórico de envios de e-mail.
 */
export function useNotificacoesConferencia() {
  const qc = useQueryClient();

  const notificacoes = useQuery({
    queryKey: ["notif-conferencia"],
    queryFn: async () => {
      const { data, error } = await db
        .from("notificacoes_conferencia")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, LIMITE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as NotificacaoConferenciaRow[];
    },
  });

  const emails = useQuery({
    queryKey: ["notif-conferencia-emails"],
    queryFn: async () => {
      const { data, error } = await db
        .from("notificacao_emails")
        .select("*")
        .order("enviado_em", { ascending: false })
        .range(0, LIMITE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as NotificacaoEmailRow[];
    },
  });

  useEffect(() => {
    const canal = supabase
      .channel("notificacoes-conferencia")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificacoes_conferencia" },
        () => {
          void qc.invalidateQueries({ queryKey: ["notif-conferencia"] });
          void qc.invalidateQueries({ queryKey: ["notif-conferencia-emails"] });
        },
      )

      // Os registros de envio de e-mail não são transmitidos em tempo real
      // (contêm endereços de destinatários); são recarregados junto das
      // notificações, que sim disparam eventos.
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);

  const lista = notificacoes.data ?? [];
  const envios = emails.data ?? [];

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["notif-conferencia"] });
    void qc.invalidateQueries({ queryKey: ["notif-conferencia-emails"] });
  };

  return {
    notificacoes: lista,
    emails: envios,
    indicadores: indicadores(lista, envios),
    carregando: notificacoes.isLoading || emails.isLoading,
    recarregar,
  };
}
