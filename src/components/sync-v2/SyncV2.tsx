/**
 * Liga o motor V2 à sessão: abre o banco local do usuário ao entrar e fecha ao sair
 * (apagando o banco só se não houver pendências). Montado com VITE_SYNC_V2=1 ou
 * VITE_CONFERENCE_V2=1.
 */
import { useEffect } from "react";
import { vigiarNotificacoes } from "@/components/conferencia-v2/notificacoes";
import { supabase } from "@/integrations/supabase/client";
import { empresaMemorizada } from "@/lib/offline/contexto";
import { aoTrocarMotor, encerrarMotor, motorDoUsuario } from "@/lib/sync-v2";
import { IndicadorSync } from "./IndicadorSync";

export function SyncV2() {
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "SIGNED_OUT") {
        void encerrarMotor({ apagarDados: true });
        return;
      }
      if (sessao?.user)
        void motorDoUsuario(sessao.user.id, empresaMemorizada()).catch(() => undefined);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Avisos de início/conclusão das conferências feitas na tela V2.
  useEffect(() => {
    let parar: (() => void) | null = null;
    const sair = aoTrocarMotor((m) => {
      parar?.();
      parar = m ? vigiarNotificacoes(m) : null;
    });
    return () => {
      sair();
      parar?.();
    };
  }, []);

  return <IndicadorSync />;
}
