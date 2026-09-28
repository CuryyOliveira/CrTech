import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import { sessaoOffline } from "@/lib/offline/cofre";
import { estaOffline } from "@/lib/offline/estado";
import {
  ehAdministrativo,
  ehGestor,
  ehProprietario,
  modulosDoPerfil,
  nivelDe,
  podeAcessar,
  podeAcessarTipo,
  type ModuloId,
  type Perfil,
} from "@/lib/permissions";


type PerfilRow = {
  perfil: Perfil;
  nome: string | null;
  setor: string | null;
  bloqueado: boolean;
};

/** Carrega o perfil de acesso do usuário logado e expõe as regras de permissão. */
export function usePermissoes() {
  const { data, isLoading } = useQuery({
    queryKey: ["perfil-atual"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Offline: o perfil e o setor vêm do cofre local, sem chamada de rede.
      if (estaOffline()) {
        const local = sessaoOffline();
        if (!local) return null;
        return {
          perfil: (local.perfil ?? "agricola") as Perfil,
          nome: local.nome,
          setor: local.setor,
          bloqueado: false,
        } as PerfilRow;
      }
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const user = auth.user;
      if (!user) {
        // Login offline: perfil e setor vêm do cofre local criptografado.
        const local = sessaoOffline();
        if (!local) return null;
        return {
          perfil: (local.perfil ?? "agricola") as Perfil,
          nome: local.nome,
          setor: local.setor,
          bloqueado: false,
        } as PerfilRow;
      }
      const { data: row } = await db
        .from("user_profiles")
        .select("perfil,nome,setor,bloqueado")
        .eq("user_id", user.id)
        .maybeSingle();
      if (row) return row as PerfilRow;

      // Primeiro acesso: o setor pertence à empresa e é definido no onboarding.
      const meta = user.user_metadata ?? {};
      const escolhido = meta['perfil'] === "industria" ? "industria" : "agricola";
      const setorInicial = (meta['setor'] as string | undefined) ?? null;
      const nome = (meta['nome'] as string | undefined) ?? user.email?.split("@")[0] ?? null;
      const { data: criado } = await db
        .from("user_profiles")
        .insert({ user_id: user.id, nome, perfil: escolhido, setor: setorInicial })
        .select("perfil,nome,setor,bloqueado")
        .maybeSingle();
      return (criado as PerfilRow | null) ?? null;
    },
  });

  const bloqueado = data?.bloqueado ?? false;
  const perfil = (bloqueado ? null : (data?.perfil ?? null)) as Perfil | null;
  const nivel = nivelDe(perfil);

  return {
    carregando: isLoading,
    perfil,
    nivel,
    temNivel: (minimo: number) => nivel >= minimo,
    proprietario: ehProprietario(perfil),
    administrativo: ehAdministrativo(perfil),
    gestor: ehGestor(perfil),
    bloqueado,
    setor: data?.setor ?? null,
    nome: data?.nome ?? null,
    modulos: modulosDoPerfil(perfil),
    pode: (m: ModuloId) => podeAcessar(perfil, m),
    podeTipo: (t?: string | null) => podeAcessarTipo(perfil, t),
  };
}

