import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { sessaoOffline } from "@/lib/offline/cofre";
import { estaOffline } from "@/lib/offline/estado";

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
      if (local) return { user: { id: local.userId, email: local.email } as never };
      throw redirect({ to: "/entrar" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
