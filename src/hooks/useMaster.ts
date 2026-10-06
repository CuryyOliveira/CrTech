import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { souMaster } from "@/lib/master.functions";

/**
 * Identidade Master confirmada pelo servidor. O frontend nunca decide isso
 * sozinho: mesmo que este valor seja forçado no navegador, todas as funções do
 * painel revalidam a identidade antes de ler ou gravar qualquer dado.
 */
export function useMaster() {
  const verificar = useServerFn(souMaster);
  const { data, isLoading } = useQuery({
    queryKey: ["sou-master"],
    queryFn: () => verificar({}),
    staleTime: 300_000,
    retry: 1,
  });
  return { carregando: isLoading, master: data?.master === true };
}
