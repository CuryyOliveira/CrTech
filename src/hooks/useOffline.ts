import { useEffect, useState } from "react";
import { assinarConexao, estaOffline } from "@/lib/offline/estado";

/**
 * Estado de conexão reativo: a interface reage imediatamente à queda ou ao
 * retorno da internet, sem depender de recarregar a página.
 */
export function useOffline() {
  const [offline, setOffline] = useState(() => estaOffline());

  useEffect(() => {
    const atualizar = () => setOffline(estaOffline());
    atualizar();
    const sair = assinarConexao(atualizar);
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      sair();
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  return offline;
}
