import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/estoque-industria")({
  head: () => ({
    meta: [
      { title: "Estoque Indústria — Conferência de Materiais" },
      { name: "description", content: "Listas de prateleiras e contagem de estoque do setor Indústria." },
      { property: "og:title", content: "Estoque Indústria — Conferência de Materiais" },
      { property: "og:description", content: "Listas de prateleiras e contagem de estoque do setor Indústria." },
    ],
  }),
  component: () => (
    <ModuloGuard modulo="ESTOQUE_INDUSTRIA">
      <UnidadesPage modulo="ESTOQUE_INDUSTRIA" />
    </ModuloGuard>
  ),
});
