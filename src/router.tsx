import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // O aplicativo tem seu próprio cache/fila offline: o React Query nunca deve
  // pausar leituras e gravações por falta de internet ("networkMode: always").
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always", retry: 1 },
      mutations: { networkMode: "always" },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Pré-carrega o código das telas visíveis enquanto há internet, para que
    // elas continuem abrindo quando a conexão cair.
    defaultPreload: "render",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
