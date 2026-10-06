import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { AdminShell } from "@/components/admin/AdminShell";
import { ADMIN_CATEGORIAS } from "@/lib/admin";
import { ResumoExecutivo } from "@/components/admin/ResumoExecutivo";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <AdminShell
      titulo="Central Administrativa"
      descricao="Gestão, inteligência e controle do sistema."
      trilha={[{ label: "Central Administrativa" }]}
    >
      <div className="space-y-6">
        {/* Visão operacional: indicadores, contagens em andamento, alertas, metas e monitor. */}
        <ResumoExecutivo />

        {/* Acesso aos módulos: cada grupo abre a própria tela. */}
        <section className="space-y-3" aria-labelledby="titulo-modulos">
          <h3
            id="titulo-modulos"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Módulos
          </h3>
          <Card className="divide-y overflow-hidden p-0">
            {ADMIN_CATEGORIAS.map((cat) => (
              <Link
                key={cat.id}
                to="/admin/grupo/$grupo"
                params={{ grupo: cat.id }}
                data-testid={`grupo-${cat.id}`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl"
                  aria-hidden
                >
                  {cat.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold uppercase tracking-wide">{cat.titulo}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {cat.descricao}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {cat.itens.length} {cat.itens.length === 1 ? "módulo" : "módulos"}
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </Card>
        </section>
      </div>
    </AdminShell>
  );
}
