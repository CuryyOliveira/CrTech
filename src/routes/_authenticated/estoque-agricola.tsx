import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/estoque-agricola")({
  head: () => ({
    meta: [
      { title: "Estoque Agrícola — Conferência de Materiais" },
      { name: "description", content: "Listas de prateleiras e contagem de estoque do setor Agrícola." },
      { property: "og:title", content: "Estoque Agrícola — Conferência de Materiais" },
      { property: "og:description", content: "Listas de prateleiras e contagem de estoque do setor Agrícola." },
    ],
  }),
  component: () => (
    <ModuloGuard modulo="ESTOQUE_AGRICOLA">
      <UnidadesPage modulo="ESTOQUE_AGRICOLA" />
    </ModuloGuard>
  ),
});
