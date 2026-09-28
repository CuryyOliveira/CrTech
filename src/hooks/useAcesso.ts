import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { contextoAcesso, type ContextoAcesso } from "@/lib/acesso.functions";
import { memorizarLegado } from "@/lib/modulos";
import { acessoMemorizado, memorizarAcesso } from "@/lib/offline/contexto";
import { useOffline } from "@/hooks/useOffline";
import { MODULOS, type ModuloId } from "@/lib/permissions";

/**
 * Acesso resolvido no servidor: empresa, assinatura, plano, limite e módulos.
 * O frontend apenas exibe o resultado — a decisão é sempre do backend.
 *
 * Sem internet reaproveitamos a última resposta autorizada pelo servidor
 * (guardada localmente): é ela que define a empresa do usuário e mantém o
 * isolamento dos dados offline. Nada é liberado por decisão do cliente.
 */
export function useAcesso() {
  const offline = useOffline();
  const carregar = useServerFn(contextoAcesso);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["contexto-acesso"],
    queryFn: async () => {
      const ctx = (await carregar({})) as ContextoAcesso;
      memorizarAcesso(ctx);
      return ctx;
    },
    enabled: !offline,
    staleTime: 60_000,
    retry: 1,
  });

  const local = offline || (!data && error) ? acessoMemorizado() : null;
  const atual = data ?? local;

  useEffect(() => {
    if (atual) memorizarLegado(Boolean(atual.legado));
  }, [atual]);

  const modulosIds = (atual?.modulos ?? []) as ModuloId[];

  return {
    carregando: offline ? false : isLoading,
    erro: offline ? null : error,
    acesso: atual ?? null,
    // Offline nunca redireciona por assinatura: a decisão exige o servidor.
    bloqueio: offline ? null : (data?.bloqueio ?? null),
    legado: atual?.legado ?? false,
    modulos: MODULOS.filter((m) => modulosIds.includes(m.id)),
    pode: (m: ModuloId) => modulosIds.includes(m),
    recarregar: refetch,
  };
}
