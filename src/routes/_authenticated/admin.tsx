import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { ModuloGuard } from "@/components/ModuloGuard";
import { Reautenticar, reautenticado } from "@/components/Reautenticar";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

/**
 * Áreas de configuração da empresa: ficam liberadas mesmo sem assinatura,
 * pois é onde o cliente revisa e corrige o que preencheu no onboarding.
 * Sem isso o usuário entra em loop entre "assinatura necessária" e voltar.
 */
const SECOES_ONBOARDING = ["minha-empresa", "setores", "modulos", "assinaturas"];

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [ok, setOk] = useState(() => reautenticado("ADMIN"));
  const secao = pathname.split("/admin/")[1]?.split("/")[0] ?? "";
  const configuracao = SECOES_ONBOARDING.includes(secao);

  return (
    <ModuloGuard modulo="ADMIN" permitirSemAssinatura={configuracao}>
      {ok ? (
        <Outlet key={pathname} />
      ) : (
        <Reautenticar escopo="ADMIN" titulo="Central Administrativa" onOk={() => setOk(true)} />
      )}
    </ModuloGuard>
  );
}
