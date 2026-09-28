import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Ban, Power, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { MasterShell } from "@/components/master/MasterShell";
import { STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { visaoGeralMaster } from "@/lib/master.functions";

export const Route = createFileRoute("/_authenticated/master/")({
  head: () => ({
    meta: [
      { title: "Painel Master — Conferência Rápida" },
      {
        name: "description",
        content:
          "Área exclusiva do proprietário do sistema para acompanhar empresas, assinaturas e situação de acesso.",
      },
      { property: "og:title", content: "Painel Master — Conferência Rápida" },
      {
        property: "og:description",
        content: "Gestão global de empresas e assinaturas do Conferência Rápida.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VisaoGeral,
});

function VisaoGeral() {
  const carregar = useServerFn(visaoGeralMaster);
  const { data, isLoading } = useQuery({ queryKey: ["master-visao-geral"], queryFn: () => carregar({}) });

  return (
    <MasterShell
      titulo="Visão geral do SaaS"
      descricao="Situação das empresas cadastradas e das assinaturas do sistema."
      acoes={
        <Button asChild>
          <Link to="/master/empresas">Gerenciar empresas</Link>
        </Button>
      }
    >
      {isLoading || !data ? (
        <SkeletonLista linhas={3} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { icone: Building2, label: "Empresas", valor: data.total },
              { icone: ShieldCheck, label: "Ativas", valor: data.ativas },
              { icone: Ban, label: "Bloqueadas", valor: data.bloqueadas },
              { icone: Power, label: "Desativadas", valor: data.desativadas },
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="space-y-1 p-4">
                  <c.icone className="size-5 text-primary" />
                  <p className="text-2xl font-bold">{c.valor}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="space-y-2 p-4">
              <h3 className="font-semibold">Assinaturas por situação</h3>
              {Object.keys(data.porStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma assinatura registrada.</p>
              ) : (
                <div className="text-sm">
                  {Object.entries(data.porStatus).map(([status, qtd]) => (
                    <div key={status} className="flex justify-between border-b py-1.5 last:border-0">
                      <span className="text-muted-foreground">
                        {STATUS_ASSINATURA_LABEL[status] ?? status}
                      </span>
                      <span className="font-medium">{qtd}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </MasterShell>
  );
}
