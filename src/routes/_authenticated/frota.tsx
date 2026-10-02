import { createFileRoute } from "@tanstack/react-router";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/frota")({
  head: () => ({
    meta: [
      { title: "Frota de Caminhões — Conferência de Materiais" },
      { name: "description", content: "Cadastro e conferência dos materiais de cada caminhão da frota." },
      { property: "og:title", content: "Frota de Caminhões — Conferência de Materiais" },
      { property: "og:description", content: "Cadastro e conferência dos materiais de cada caminhão da frota." },
    ],
  }),
  component: () => (
    <ModuloGuard modulo="FROTA">
      <UnidadesPage modulo="FROTA" />
    </ModuloGuard>
  ),
});
