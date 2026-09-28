import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  History,
  CreditCard,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { AdminShell } from "@/components/admin/AdminShell";
import { ADMIN_CATEGORIAS } from "@/lib/admin";
import { ResumoExecutivo } from "@/components/admin/ResumoExecutivo";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminHome,
});

const ICONES = {
  users: Users,
  clipboard: ClipboardList,
  settings: Settings,
  gauge: Gauge,
  target: Target,
  fileText: FileText,
  bell: Bell,
  shieldCheck: ShieldCheck,
  history: History,
  creditCard: CreditCard,
  building: Building2,
  boxes: Boxes,

} as const;

function AdminHome() {
  return (
    <AdminShell
      titulo="Central Administrativa"
      descricao="Gestão, inteligência e controle do sistema."
      trilha={[{ label: "Central Administrativa" }]}
    >
      <div className="space-y-6">
        <ResumoExecutivo />
        {ADMIN_CATEGORIAS.map((cat) => (
          <section key={cat.id} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {cat.emoji} {cat.titulo}
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {cat.itens.map((item) => {
                const Icone = ICONES[item.icone];
                return (
                  <Link key={item.slug} to="/admin/$secao" params={{ secao: item.slug }}>
                    <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                      <CardContent className="space-y-2 p-5">
                        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icone className="size-5" />
                        </div>
                        <p className="font-semibold">{item.titulo}</p>
                        <p className="text-xs text-muted-foreground">{item.descricao}</p>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AdminShell>
  );
}
