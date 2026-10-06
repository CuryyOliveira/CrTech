import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/ferramentas-industria")({
  head: () => ({
    meta: [
      { title: "Ferramentas Indústria — Conferência de Materiais" },
      { name: "description", content: "Conferência das caixas de ferramentas do setor Indústria por funcionário e gestor." },
      { property: "og:title", content: "Ferramentas Indústria — Conferência de Materiais" },
      { property: "og:description", content: "Conferência das caixas de ferramentas do setor Indústria por funcionário e gestor." },
    ],
  }),
  component: () => (
    <ModuloGuard modulo="FERRAMENTAS_INDUSTRIA">
      <UnidadesPage modulo="FERRAMENTAS_INDUSTRIA" />
    </ModuloGuard>
  ),
});
