import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import { dispositivoAtual } from "@/lib/cadastros";

const CHAVE = "sessao_id";
const INTERVALO = 60_000;

/**
 * Registra a sessão do usuário logado (dispositivo, navegador, IP e último sinal)
 * e mantém o sinal de presença para o status Online/Offline e o logout remoto.
 */
export function useSessaoAtiva() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const { data: auth } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null } }));
      const user = auth.user;
      if (!user || cancelado) return;

      const { dispositivo, navegador } = dispositivoAtual();
      let ip: string | null = null;
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        ip = ((await r.json()) as { ip?: string }).ip ?? null;
      } catch {
        ip = null;
      }

      let id = sessionStorage.getItem(CHAVE);
      if (!id) {
        const { data } = await db
          .from("sessoes_usuario")
          .insert({ user_id: user.id, dispositivo, navegador, ip })
          .select("id")
          .maybeSingle();
        id = (data as { id?: string } | null)?.id ?? null;
        if (id) sessionStorage.setItem(CHAVE, id);
      }
      if (!id || cancelado) return;

      await db
        .from("user_profiles")
        .update({ ultimo_acesso: new Date().toISOString() })
        .eq("user_id", user.id);

      const ping = async () => {
        const { data } = await db
          .from("sessoes_usuario")
          .update({ ultimo_ping: new Date().toISOString() })
          .eq("id", id)
          .is("encerrada_em", null)
          .select("id")
          .maybeSingle();
        if (!data) {
          // Sessão encerrada remotamente por um administrador.
          sessionStorage.removeItem(CHAVE);
          await supabase.auth.signOut();
          window.location.assign("/entrar");
        }
      };

      timer.current = setInterval(() => void ping(), INTERVALO);
    }

    void iniciar();

    return () => {
      cancelado = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);
}

/** Encerra a sessão local ao sair do sistema. */
export async function encerrarSessaoLocal() {
  const id = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(CHAVE) : null;
  if (!id) return;
  sessionStorage.removeItem(CHAVE);
  try {
    await db
      .from("sessoes_usuario")
      .update({ encerrada_em: new Date().toISOString(), motivo_encerramento: "logout" })
      .eq("id", id);
  } catch {
    /* não bloqueia o logout */
  }
}
