import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { encerrarSessaoOffline, sessaoOffline } from "@/lib/offline/cofre";
import { erroDeRede, estaOffline } from "@/lib/offline/estado";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const local = sessaoOffline();
    // Sem internet nenhuma chamada de rede é feita: o acesso usa o cofre local
    // e, na sua falta, a sessão já guardada no próprio dispositivo.
    if (estaOffline()) {
      if (local) return { user: { id: local.userId, email: local.email } as never };
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const u = data.session?.user;
      if (u) return { user: u };
      throw redirect({ to: "/entrar" });
    }
    const { data, error } = await Promise.race([
      supabase.auth.getUser().catch(() => ({ data: { user: null }, error: new Error("offline") })),
      new Promise<{ data: { user: null }; error: Error }>((r) =>
        setTimeout(() => r({ data: { user: null }, error: new Error("timeout") }), 6000),
      ),
    ]);
    if (error || !data.user) {
      // A sessão local (login offline) só vale quando o servidor não pôde ser consultado.
      // Se o servidor respondeu que a sessão é inválida/expirada/revogada, não há acesso.
      const semRede =
        !!error &&
        (error.message === "offline" ||
          error.message === "timeout" ||
          error.name === "AuthRetryableFetchError" ||
          erroDeRede(error));
      if (local && semRede) return { user: { id: local.userId, email: local.email } as never };
      if (local) encerrarSessaoOffline();
      throw redirect({ to: "/entrar" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
