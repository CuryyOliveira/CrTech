import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, ShieldCheck, CreditCard, Users, Crown, Receipt, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GerenciarPerfis } from "@/components/GerenciarPerfis";
import { supabase } from "@/integrations/supabase/client";
import { encerrarSessaoOffline } from "@/lib/offline/cofre";
import { usePermissoes } from "@/hooks/usePermissoes";
import { useAcesso } from "@/hooks/useAcesso";
import { useModulos } from "@/hooks/useModulos";
import { IconeModulo } from "@/components/IconeModulo";
import { useMaster } from "@/hooks/useMaster";
import { PERFIL_LABEL } from "@/lib/permissions";
import { limparContextoUsuario, registrarAuditoria } from "@/lib/audit";
import { AvisosMural } from "@/components/AvisosMural";
import { AvisoNovaVersao } from "@/components/AvisoNovaVersao";
import { encerrarSessaoLocal, useSessaoAtiva } from "@/hooks/useSessao";
import { useOffline } from "@/hooks/useOffline";

export const Route = createFileRoute("/_authenticated/menu")({
  component: Menu,
});

function Menu() {
  const offline = useOffline();
  const { carregando: carregandoPerfil, perfil, modulos: modulosPerfil, administrativo } =
    usePermissoes();
  const { carregando, acesso, bloqueio, pode } = useAcesso();
  const { modulos, carregando: carregandoModulos } = useModulos();
  const navigate = useNavigate();
  const { master } = useMaster();
  useSessaoAtiva();
  const labelPerfil = perfil ? PERFIL_LABEL[perfil] : undefined;

  // Novo usuário sem empresa vai ao onboarding; empresa sem assinatura, ao bloqueio.
  useEffect(() => {
    if (offline || carregando) return;
    if (bloqueio === "sem_empresa") navigate({ to: "/bem-vindo", replace: true });
    else if (bloqueio === "sem_assinatura")
      navigate({ to: "/assinatura-necessaria", replace: true });
    else if (bloqueio === "empresa_bloqueada" || bloqueio === "empresa_desativada")
      navigate({ to: "/empresa-bloqueada", replace: true });
  }, [offline, carregando, bloqueio, navigate]);

  const podeAdmin = offline ? modulosPerfil.length > 0 && administrativo : pode("ADMIN");
  const usados = acesso?.usuariosUsados;
  const limite = acesso?.usuariosLimite;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <h1 className="flex-1 text-lg font-bold tracking-tight">Módulos de Conferência de Materiais</h1>
          {labelPerfil && <Badge variant="secondary">{labelPerfil}</Badge>}
          {administrativo && <GerenciarPerfis />}

          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sair"
            onClick={async () => {
              await registrarAuditoria({
                tipo: "autenticacao",
                acao: "logout",
                detalhe: "Saída do sistema",
              });
              await encerrarSessaoLocal();
              limparContextoUsuario();
              encerrarSessaoOffline();
              await supabase.auth.signOut().catch(() => null);
              window.location.href = "/entrar";
            }}
          >
            <LogOut className="size-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <AvisosMural />
        <AvisoNovaVersao />

        {administrativo && acesso?.empresaNome && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <ShieldCheck className="size-5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-semibold">{acesso.empresaNome}</p>
                <p className="text-xs text-muted-foreground">
                  {acesso.legado
                    ? "Empresa existente — acesso preservado"
                    : (acesso.plano?.plano_codigo ?? "Sem plano contratado")}
                </p>
              </div>
              {usados != null && (
                <Badge variant="secondary" className="gap-1">
                  <Users className="size-3" />
                  {usados}
                  {limite != null ? ` / ${limite}` : ""} usuários
                </Badge>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-sm text-muted-foreground">Selecione o módulo que deseja conferir.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {modulos.map((m) => {
            return (
              <Link key={m.chave} to={m.rota}>
                <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                  <CardContent className="space-y-3 p-6 text-center">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <IconeModulo nome={m.icone} className="size-7" />
                    </div>
                    <h2 className="font-semibold">{m.titulo}</h2>
                    <p className="text-xs text-muted-foreground">{m.descricao}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          <Link to="/conferencia-unica">
            <Card className="h-full border-dashed border-primary/40 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
              <CardContent className="space-y-3 p-6 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ClipboardList className="size-7" />
                </div>
                <h2 className="font-semibold">Conferência Única</h2>
                <p className="text-xs text-muted-foreground">
                  Abrir uma conferência avulsa com itens de um módulo
                </p>
              </CardContent>
            </Card>
          </Link>

          {podeAdmin && (
            <Link to="/admin">
              <Card className="h-full border-primary/40 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                <CardContent className="space-y-3 p-6 text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <ShieldCheck className="size-7" />
                  </div>
                  <h2 className="font-semibold">Central Administrativa</h2>
                  <p className="text-xs text-muted-foreground">
                    Gestão, inteligência e controle do sistema
                  </p>
                </CardContent>
              </Card>
            </Link>
          )}

          {podeAdmin && (
            <Link to="/planos">
              <Card className="h-full border-primary/40 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                <CardContent className="space-y-3 p-6 text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <CreditCard className="size-7" />
                  </div>
                  <h2 className="font-semibold">Planos e Assinaturas</h2>
                  <p className="text-xs text-muted-foreground">
                    Contratar ou alterar o plano da empresa
                  </p>
                </CardContent>
              </Card>
            </Link>
          )}

          {podeAdmin && (
            <Link to="/faturas">
              <Card className="h-full border-primary/40 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
                <CardContent className="space-y-3 p-6 text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Receipt className="size-7" />
                  </div>
                  <h2 className="font-semibold">Faturas e recibos</h2>
                  <p className="text-xs text-muted-foreground">
                    Histórico de cobranças e comprovantes de pagamento
                  </p>
                </CardContent>
              </Card>
            </Link>
          )}

          {/* Exclusivo do proprietário do sistema (validado no servidor). */}
          {master && (
            <Link to="/master">
              <Card className="h-full border-amber-500/50 transition-all hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-lg">
                <CardContent className="space-y-3 p-6 text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-500 text-black">
                    <Crown className="size-7" />
                  </div>
                  <h2 className="font-semibold">Painel Master</h2>
                  <p className="text-xs text-muted-foreground">
                    Empresas, assinaturas e controle global do SaaS
                  </p>
                </CardContent>
              </Card>
            </Link>
          )}




        </div>
        {/* A configuração da empresa vive na Central Administrativa →
            Gestão de Módulos. A tela inicial é apenas operacional. */}


        {!carregandoPerfil && !carregando && !carregandoModulos && !modulos.length && (
          <p className="text-sm text-muted-foreground">
            Nenhum módulo liberado para o seu perfil. Procure o administrador do sistema.
          </p>
        )}
      </main>
    </div>
  );
}
