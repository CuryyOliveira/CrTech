import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnidadesPage } from "@/components/UnidadesPage";
import { ModuloGuard } from "@/components/ModuloGuard";
import { db } from "@/lib/app";
import { empresaMemorizada } from "@/lib/offline/contexto";
import { resolverEmpresa, type ModuloEmpresa } from "@/lib/modulos";

export const Route = createFileRoute("/_authenticated/m/$modulo")({
  head: () => ({
    meta: [
      { title: "Módulo de Conferência — Conferência Rápida" },
      {
        name: "description",
        content: "Conferência de materiais do módulo configurado pela sua empresa.",
      },
      { property: "og:title", content: "Módulo de Conferência — Conferência Rápida" },
      {
        property: "og:description",
        content: "Conferência de materiais do módulo configurado pela sua empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModuloDinamico,
});

function ModuloDinamico() {
  const { modulo } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["modulo", modulo],
    queryFn: async () => {
      // `db` resolve online pelo Supabase e, sem internet, pelo cache local.
      const { data, error } = await db
        .from("empresa_modulos")
        .select("*")
        .eq("id", modulo)
        .eq("excluido", false)
        .maybeSingle();
      if (error) throw error;
      const linha = (data ?? null) as unknown as ModuloEmpresa | null;
      // Isolamento: um módulo do cache só abre para a empresa do usuário.
      const empresa = empresaMemorizada();
      if (linha && empresa && linha.empresa_id && linha.empresa_id !== empresa) return null;
      return linha;
    },
  });

  if (isLoading) return <div className="min-h-screen bg-background" />;

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-lg font-bold">Módulo não encontrado</h1>
        <p className="text-sm text-muted-foreground">
          Este módulo não existe, foi removido ou não pertence à sua empresa.
        </p>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/menu">
            <ArrowLeft className="size-4" /> Voltar ao menu
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <ModuloGuard modulo={data.id}>
      <UnidadesPage alvo={resolverEmpresa(data)} />
    </ModuloGuard>
  );
}
