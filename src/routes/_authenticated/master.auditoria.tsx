import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { MasterShell } from "@/components/master/MasterShell";
import { fmtDataHoraLocal } from "@/lib/datas";
import { auditoriaMasterLista } from "@/lib/master.functions";

const ACAO_LABEL: Record<string, string> = {
  empresa_bloqueada: "Empresa bloqueada",
  empresa_desbloqueada: "Bloqueio removido",
  empresa_desativada: "Empresa desativada",
  empresa_reativada: "Empresa reativada",
};

export const Route = createFileRoute("/_authenticated/master/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria do Painel Master — Conferência Rápida" },
      {
        name: "description",
        content:
          "Registro completo das ações administrativas realizadas pelo proprietário do sistema.",
      },
      { property: "og:title", content: "Auditoria do Painel Master" },
      {
        property: "og:description",
        content: "Histórico de bloqueios, desativações e reativações de empresas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuditoriaMasterPage,
});

function AuditoriaMasterPage() {
  const carregar = useServerFn(auditoriaMasterLista);
  const { data, isLoading } = useQuery({
    queryKey: ["master-auditoria"],
    queryFn: () => carregar({ data: { limite: 100 } }),
  });

  return (
    <MasterShell
      titulo="Auditoria do Painel Master"
      descricao="Cada ação registra data, hora, responsável, empresa afetada e motivo."
    >
      {isLoading ? (
        <SkeletonLista />
      ) : !data?.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma ação administrativa registrada até agora.
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <Badge variant="secondary">{ACAO_LABEL[l.acao] ?? l.acao}</Badge>
                <span className="min-w-40 flex-1">{l.detalhe ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{l.usuario ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {fmtDataHoraLocal(l.created_at)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </MasterShell>
  );
}
