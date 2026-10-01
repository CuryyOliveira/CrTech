/**
 * Tela de um grupo da Central Administrativa (Gestão, Inteligência, Controle): lista os módulos
 * do grupo. Só navegação — o acesso continua protegido pelo layout /admin (ModuloGuard ADMIN +
 * reautenticação) e cada módulo mantém as próprias verificações.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { CartaoModulo } from "@/components/admin/CartaoModulo";
import { Button } from "@/components/ui/button";
import { adminCategoria } from "@/lib/admin";

export const Route = createFileRoute("/_authenticated/admin/grupo/$grupo")({
  component: Grupo,
});

function Grupo() {
  const { grupo } = Route.useParams();
  const cat = adminCategoria(grupo);

  if (!cat) {
    return (
      <AdminShell
        titulo="Área não encontrada"
        trilha={[{ label: "Central Administrativa", to: "/admin" }, { label: "Não encontrada" }]}
      >
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">Este grupo não existe.</p>
          <Button className="mt-4" asChild>
            <Link to="/admin">Voltar para a Central Administrativa</Link>
          </Button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      titulo={`${cat.emoji} ${cat.titulo}`}
      descricao={cat.descricao}
      trilha={[{ label: "Central Administrativa", to: "/admin" }, { label: cat.titulo }]}
      voltar={{ to: "/admin", label: "Voltar para a Central" }}
    >
      <div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="modulos-do-grupo">
          {cat.itens.map((item) => (
            <CartaoModulo key={item.slug} item={item} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}
