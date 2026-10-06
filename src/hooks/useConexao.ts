import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assinarConexao, definirEstado, estadoConexao, type EstadoConexao } from "@/lib/offline/estado";
import { pendencias, resumoFila } from "@/lib/offline/fila";
import { sincronizar } from "@/lib/offline/sync";
import { avisarSincronizado } from "@/lib/offline/aviso";
import {
  assinarProgresso,
  precarregarDadosOffline,
  progressoOffline,
  type ProgressoOffline,
} from "@/lib/offline/precarregar";
import { registrarAuditoria } from "@/lib/audit";
import { sessaoOffline } from "@/lib/offline/cofre";
import { hidratarOffline } from "@/lib/offline/idb";
import {
  despacharNotificacoesPendentes,
  enviosPendentes,
} from "@/lib/offline/notificacoes-pendentes";

/**
 * Monitora o estado da conexão, dispara a sincronização automática ao voltar a
 * internet, renova o token de autenticação e atualiza as permissões do usuário.
 */
export function useConexao() {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<EstadoConexao>(estadoConexao());
  const [fila, setFila] = useState(0);
  const [progresso, setProgresso] = useState<ProgressoOffline>(progressoOffline());

  useEffect(() => {
    const sair = assinarConexao(setEstado);
    const sairProgresso = assinarProgresso(setProgresso);
    const atualizarFila = () => setFila(pendencias());
    void hidratarOffline().then(atualizarFila);

    async function reconectou() {
      definirEstado("sincronizando");
      try {
        await hidratarOffline();
        // Renova o token e as permissões antes de enviar as pendências.
        await supabase.auth.refreshSession().catch(() => null);
        const { enviadas } = await sincronizar();
        if (enviadas) avisarSincronizado(enviadas);
        // Só depois de gravar as pendências no banco os e-mails de início e
        // conclusão (com o relatório) são enviados.
        const notificados = await despacharNotificacoesPendentes().catch(() => 0);
        if (notificados)
          void registrarAuditoria({
            tipo: "operacao",
            acao: "notificacoes_offline_enviadas",
            detalhe: `${notificados} notificação(ões) registrada(s) offline enviada(s) por e-mail`,
          });
        // Baixa tudo o que os módulos precisam para funcionar sem internet.
        await precarregarDadosOffline().catch(() => 0);
        await queryClient.invalidateQueries();
        if (enviadas)
          void registrarAuditoria({
            tipo: "operacao",
            acao: "sincronizacao_offline",
            detalhe: `${enviadas} operação(ões) offline sincronizada(s) com o servidor`,
          });
      } finally {
        atualizarFila();
        definirEstado(navigator.onLine ? "online" : "offline");
      }
    }

    function ficouOffline() {
      definirEstado("offline");
      void registrarAuditoria({
        tipo: "autenticacao",
        acao: "modo_offline",
        detalhe: "Aplicativo entrou em modo offline",
      });
    }

    definirEstado(navigator.onLine ? "online" : "offline");
    if (navigator.onLine) void reconectou();

    window.addEventListener("online", reconectou);
    window.addEventListener("offline", ficouOffline);
    const timer = setInterval(() => {
      atualizarFila();
      if (navigator.onLine && (pendencias() || enviosPendentes().length)) void reconectou();
    }, 30_000);

    return () => {
      sair();
      sairProgresso();
      clearInterval(timer);
      window.removeEventListener("online", reconectou);
      window.removeEventListener("offline", ficouOffline);
    };
  }, [queryClient]);

  return {
    estado,
    progresso,
    pendentes: fila,
    offline: estado === "offline",
    sessaoLocal: sessaoOffline(),
    resumo: resumoFila(),
    /** Notificações registradas offline aguardando envio do e-mail/relatório. */
    notificacoesPendentes: enviosPendentes().length,
    sincronizar: async () => {
      const { enviadas } = await sincronizar();
      if (enviadas) avisarSincronizado(enviadas);
      await despacharNotificacoesPendentes().catch(() => 0);
      setFila(pendencias());
      await queryClient.invalidateQueries();
    },
  };
}
