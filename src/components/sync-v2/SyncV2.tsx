/**
 * Liga o motor V2 à sessão: abre o banco local do usuário ao entrar e fecha ao sair
 * (apagando o banco só se não houver pendências). Montado com VITE_SYNC_V2=1 ou
 * VITE_CONFERENCE_V2=1.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { empresaMemorizada } from "@/lib/offline/contexto";
import { encerrarMotor, motorDoUsuario } from "@/lib/sync-v2";
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

  // Avisos de início/conclusão: disparados pelo servidor quando a conferência é confirmada
  // no banco (migration 20260930120000_notificacoes_servidor.sql), sem depender do aparelho.

  return <IndicadorSync />;
}
