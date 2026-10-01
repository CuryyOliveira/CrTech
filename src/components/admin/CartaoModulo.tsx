/** Card de um módulo da Central Administrativa (usado na tela de cada grupo). */
import { Link } from "@tanstack/react-router";
import {
  Bell,
  Boxes,
  Building2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  History,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AdminItem } from "@/lib/admin";

export const ICONES_ADMIN = {
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

export function CartaoModulo({ item }: { item: AdminItem }) {
  const Icone = ICONES_ADMIN[item.icone];
  return (
    <Link
      to="/admin/$secao"
      params={{ secao: item.slug }}
      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`modulo-${item.slug}`}
    >
      <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
        <CardContent className="flex h-full flex-col gap-2 p-4 sm:p-5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icone className="size-5" aria-hidden />
          </div>
          <p className="font-semibold leading-snug">{item.titulo}</p>
          <p className="flex-1 text-xs text-muted-foreground">{item.descricao}</p>
          <p className="flex items-center gap-1 text-xs font-medium text-primary">
            Acessar <ChevronRight className="size-3.5" aria-hidden />
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
