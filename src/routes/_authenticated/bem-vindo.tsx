import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Building2, Users, ShieldCheck, ArrowRight, ArrowLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { situacaoOnboarding } from "@/lib/onboarding";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria, limparContextoUsuario } from "@/lib/audit";
import { encerrarSessaoLocal } from "@/hooks/useSessao";
import { encerrarSessaoOffline } from "@/lib/offline/cofre";

export const Route = createFileRoute("/_authenticated/bem-vindo")({
  head: () => ({
    meta: [
      { title: "Bem-vindo ao Conferência Rápida" },
      {
        name: "description",
        content:
          "Comece a usar o Conferência Rápida: cadastre sua empresa, escolha um plano e convide sua equipe.",
      },
      { property: "og:title", content: "Bem-vindo ao Conferência Rápida" },
      {
        property: "og:description",
        content: "Cadastre sua empresa, escolha um plano e convide sua equipe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BemVindo,
});

const PASSOS = [
  {
    icone: Building2,
    titulo: "Cadastre sua empresa",
    texto: "Nome, CNPJ e contato — é o espaço onde ficam suas conferências.",
  },
  {
    icone: ShieldCheck,
    titulo: "Escolha um plano",
    texto: "14 dias de teste em qualquer plano, sem compromisso.",
  },
  {
    icone: Users,
    titulo: "Convide sua equipe",
    texto: "Cada usuário recebe módulos e permissões conforme o perfil.",
  },
];

function BemVindo() {
  const navigate = useNavigate();
  const { data: situacao } = useQuery({
    queryKey: ["situacao-onboarding"],
    queryFn: situacaoOnboarding,
    staleTime: 60_000,
  });

  // Usuários legados ou já vinculados a uma empresa nunca ficam nesta tela.
  useEffect(() => {
    if (situacao === "legado" || situacao === "empresa") navigate({ to: "/menu", replace: true });
  }, [situacao, navigate]);

  async function sair() {
    await registrarAuditoria({
      tipo: "autenticacao",
      acao: "logout",
      detalhe: "Saída na tela de boas-vindas",
    });
    await encerrarSessaoLocal();
    limparContextoUsuario();
    encerrarSessaoOffline();
    await supabase.auth.signOut().catch(() => null);
    window.location.href = "/entrar";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/" aria-label="Voltar para a página inicial">
              <ArrowLeft className="size-4" /> Voltar
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void sair()} aria-label="Sair da conta">
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ClipboardCheck className="size-7" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              Bem-vindo ao Conferência Rápida 👋🏻
            </h1>
            <p className="text-sm text-muted-foreground">
              Vamos preparar sua empresa em poucos passos para você começar a conferir materiais
              hoje mesmo.
            </p>
          </div>

          <ul className="space-y-3">
            {PASSOS.map(({ icone: Icone, titulo, texto }, i) => (
              <li key={titulo} className="flex gap-3 rounded-xl border bg-card p-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icone className="size-5" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">
                    {i + 1}. {titulo}
                  </p>
                  <p className="text-xs text-muted-foreground">{texto}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <Button className="w-full" size="lg" asChild>
              <Link to="/empresa-nova" aria-label="Começar o cadastro da minha empresa">
                Começar configuração
                <ArrowRight className="size-4" />
              </Link>
            </Button>

            <Button variant="ghost" className="w-full" asChild>
              <Link to="/menu" aria-label="Ir para os módulos de conferência">
                Já faço parte de uma empresa
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
