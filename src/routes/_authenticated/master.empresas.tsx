import { createFileRoute } from "@tanstack/react-router";
import { MasterShell } from "@/components/master/MasterShell";
import { EmpresasMaster } from "@/components/master/EmpresasMaster";

export const Route = createFileRoute("/_authenticated/master/empresas")({
  head: () => ({
    meta: [
      { title: "Empresas do SaaS — Painel Master" },
      {
        name: "description",
        content:
          "Pesquise empresas, consulte plano e usuários e aplique bloqueio ou desativação administrativa.",
      },
      { property: "og:title", content: "Empresas do SaaS — Painel Master" },
      {
        property: "og:description",
        content: "Gestão de empresas, planos e situação de acesso do Conferência Rápida.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmpresasPage,
});

function EmpresasPage() {
  return (
    <MasterShell
      titulo="Empresas"
      descricao="Pesquise por nome ou CNPJ, consulte os detalhes e gerencie o acesso de cada empresa."
    >
      <EmpresasMaster />
    </MasterShell>
  );
}
