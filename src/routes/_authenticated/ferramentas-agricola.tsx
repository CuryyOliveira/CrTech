import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/ferramentas-agricola")({
  head: () => ({
    meta: [
      { title: "Ferramentas Agrícola — Conferência de Materiais" },
      { name: "description", content: "Conferência das caixas de ferramentas do setor Agrícola por funcionário e gestor." },
      { property: "og:title", content: "Ferramentas Agrícola — Conferência de Materiais" },
      { property: "og:description", content: "Conferência das caixas de ferramentas do setor Agrícola por funcionário e gestor." },
    ],
  }),
  component: () => (
    <ModuloGuard modulo="FERRAMENTAS_AGRICOLA">
      <UnidadesPage modulo="FERRAMENTAS_AGRICOLA" />
    </ModuloGuard>
  ),
});
