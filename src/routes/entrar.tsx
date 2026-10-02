import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RodapeLegal } from "@/components/publico/RodapeLegal";

import { ClipboardCheck, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { limparContextoUsuario, registrarAuditoria } from "@/lib/audit";
import { registrarTentativaLogin } from "@/lib/audit.functions";
import { abrirSessaoOffline, cofreExiste, encerrarSessaoOffline, salvarCofre, validarCofre } from "@/lib/offline/cofre";
import { encerrarSessaoLocal } from "@/hooks/useSessao";
import { prepararCacheParaUsuario } from "@/lib/offline/dono";
import { precarregarDadosOffline } from "@/lib/offline/precarregar";
import { db } from "@/lib/app";
import { erroDeRede } from "@/lib/offline/estado";

export const Route = createFileRoute("/entrar")({
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s['next'] === "string" ? { next: s['next'] } : {},

  head: () => ({
    meta: [
      { title: "Entrar — Conferência Rápida | C.R Tech" },
      {
        name: "description",
        content:
          "Acesse sua conta do Conferência Rápida para iniciar conferências de estoque, ferramentas e frota.",
      },
      { property: "og:title", content: "Entrar — Conferência Rápida" },
      {
        property: "og:description",
        content: "Acesso ao sistema Conferência Rápida da C.R Tech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: Login,
});


function Login() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // Só aceita caminho relativo do próprio app (usado pelo consentimento OAuth).
  const destino = next && next.startsWith("/") && !next.startsWith("//") ? next : "/menu";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function recuperarSenha() {
    const alvo = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alvo)) {
      toast.error("Informe seu e-mail no campo acima para receber o link de redefinição");
      return;
    }
    setCarregando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(alvo, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setCarregando(false);
    if (error) {
      toast.error("Não foi possível enviar o link agora. Tente novamente em alguns minutos.");
      return;
    }
    toast.success("Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.");
  }
  // Evita que a navegação automática interrompa a gravação do cofre offline.
  const entrando = useRef(false);
  // Login automático desativado: quem já tem sessão vê uma confirmação manual.
  const [sessaoEmail, setSessaoEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !entrando.current) setSessaoEmail(data.session.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, session) => {
      if (entrando.current) return;
      if (evento === "SIGNED_OUT") return setSessaoEmail(null);
      if (session) setSessaoEmail(session.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sair() {
    await encerrarSessaoLocal();
    limparContextoUsuario();
    encerrarSessaoOffline();
    await supabase.auth.signOut().catch(() => null);
    setSessaoEmail(null);
  }


  /** Valida as credenciais no cofre local e libera o acesso sem internet. */
  async function entrarOffline(motivo: string) {
    const dados = await validarCofre(email, senha);
    if (!dados) {
      toast.error(
        cofreExiste(email)
          ? "Senha incorreta para o acesso offline."
          : "Sem internet e sem acesso salvo neste dispositivo. Faça o primeiro login online.",
      );
      return false;
    }
    await prepararCacheParaUsuario(dados.userId);
    abrirSessaoOffline(dados);
    limparContextoUsuario();
    void registrarAuditoria({
      tipo: "autenticacao",
      acao: "login_offline",
      detalhe: `Acesso offline autorizado para ${email} (${motivo})`,
    });
    toast.success("Acesso offline autorizado. As alterações serão sincronizadas depois.");
    navigate({ href: destino });
    return true;
  }

  /**
   * Guarda localmente (criptografado) os dados do usuário para uso offline.
   * Grava primeiro o essencial (id, e-mail e hash da senha) para que o
   * acesso offline exista imediatamente, e depois enriquece com perfil, setor e
   * unidades — assim uma falha de consulta nunca deixa o dispositivo sem cofre.
   */
  async function guardarAcessoLocal(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const base = {
      userId: user.id,
      email: (user.email ?? email).toLowerCase(),
      nome: (meta['nome'] as string | undefined) ?? null,
      matricula: (meta['matricula'] as string | undefined) ?? null,
      perfil: (meta['perfil'] as string | undefined) ?? null,
      setor: (meta['setor'] as string | undefined) ?? null,
      unidades: [] as string[],
      token: null as string | null,
      refreshToken: null as string | null,
      validadoEm: new Date().toISOString(),
    };

    // Tokens de acesso NÃO vão para o cofre (a sessão online fica com o cliente do Supabase).
    await prepararCacheParaUsuario(user.id);

    const criado = await salvarCofre(senha, base);
    if (!criado) toast.error("Não foi possível preparar o acesso offline neste dispositivo.");

    // Enriquecimento (perfil/setor/unidades) — nunca bloqueia o login.
    try {
      const { data: perfil } = await db
        .from("user_profiles")
        .select("nome,perfil,setor")
        .eq("user_id", user.id)
        .maybeSingle();
      const { data: unidades } = await db.from("unidades").select("id").eq("ativo", true);
      await salvarCofre(senha, {
        ...base,
        nome: perfil?.nome ?? base.nome,
        perfil: perfil?.perfil ?? base.perfil,
        setor: perfil?.setor ?? base.setor,
        unidades: ((unidades ?? []) as { id: string }[]).map((u) => u.id),
        validadoEm: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[cofre] Cofre salvo sem perfil/unidades (consulta falhou)", e);
    }

    // Baixa em segundo plano todas as listas/materiais para uso offline.
    void precarregarDadosOffline().catch(() => 0);
  }

  async function entrar() {
    if (!email || !senha) return toast.error("Informe e-mail e senha.");
    setCarregando(true);
    entrando.current = true;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await entrarOffline("sem conexão");
      entrando.current = false;
      setCarregando(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) {
        entrando.current = false;
        setCarregando(false);
        // Mensagem única: não revela se a conta existe nem o motivo exato da recusa.
        toast.error(
          error.status === 429
            ? "Muitas tentativas. Aguarde alguns minutos e tente novamente."
            : "E-mail ou senha inválidos.",
        );
        // A senha nunca é enviada: o servidor só registra que o login foi recusado.
        const motivo = /not confirmed/i.test(error.message)
          ? "email_nao_confirmado"
          : /invalid/i.test(error.message)
            ? "credenciais_invalidas"
            : "recusado";
        void registrarTentativaLogin({ data: { email, motivo } }).catch(() => {});
        return;
      }
      limparContextoUsuario();
      void registrarAuditoria({ tipo: "autenticacao", acao: "login", detalhe: `Acesso realizado por ${email}` });
      if (data.user) await guardarAcessoLocal(data.user);
      setCarregando(false);
      entrando.current = false;
      navigate({ href: destino });
    } catch (e) {
      // Servidor inacessível: tenta a validação local antes de recusar o acesso.
      if (erroDeRede(e)) await entrarOffline("servidor inacessível");
      else toast.error("Não foi possível entrar. Tente novamente.");
      entrando.current = false;
      setCarregando(false);
    }
  }


  async function cadastrar() {
    if (!nome.trim()) return toast.error("Informe seu nome.");
    setCarregando(true);
    entrando.current = true;
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        // O setor pertence à empresa e é definido depois, no onboarding.
        data: { nome: nome.trim() },
        emailRedirectTo: `${window.location.origin}/entrar`,
      },
    });
    if (error) {
      entrando.current = false;
      setCarregando(false);
      return toast.error(error.message);
    }
    limparContextoUsuario();
    if (data.session) {
      void registrarAuditoria({
        tipo: "usuarios",
        acao: "cadastro_usuario",
        detalhe: `Conta criada para ${email}`,
      });
      // Já prepara o acesso offline no primeiro acesso.
      if (data.user) await guardarAcessoLocal(data.user);
    }
    setCarregando(false);
    entrando.current = false;
    if (!data.session) toast.success("Confira seu e-mail para confirmar o cadastro.");
    else navigate({ href: destino });
  }


  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-8 px-4 py-10 md:grid-cols-2">
        <section className="space-y-5">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ClipboardCheck className="size-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Acesso ao Conferência Rápida
          </h1>
          <p className="text-muted-foreground">
            O Conferência Rápida, da C.R Tech, te ajuda a organizar a contagem de estoques e itens
            diversos, e cada conferência fica registrada com responsável, tempo trabalhado,
            divergências e assinatura digital.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Importe a lista de materiais em Excel e confira item por item</li>
            <li>• Funciona offline no celular e sincroniza ao voltar a conexão</li>
            <li>• Histórico, auditoria e relatórios em Excel e PDF</li>
            <li>• Módulos, setores e permissões configuráveis por empresa</li>
            <li>• Notificações por e-mail ao concluir cada conferência</li>
          </ul>
          <p className="text-sm">
            <Link to="/" className="font-medium text-primary hover:underline">
              Conhecer o sistema
            </Link>{" "}
            <span className="text-muted-foreground">ou</span>{" "}
            <Link to="/precos" className="font-medium text-primary hover:underline">
              ver planos e preços
            </Link>
          </p>
        </section>

      <Card className="w-full max-w-sm md:justify-self-end">
        <CardContent className="space-y-5 p-6">
          {sessaoEmail ? (
            <>
              <div className="space-y-2 text-center">
                <h2 className="text-xl font-bold tracking-tight">Você já está conectado</h2>
                <p className="text-sm text-muted-foreground">
                  Sessão ativa como <span className="font-medium text-foreground">{sessaoEmail}</span>
                </p>
              </div>
              <Button className="w-full" size="lg" onClick={() => navigate({ href: destino })}>
                Continuar para o sistema
              </Button>
              <Button variant="outline" className="w-full" size="lg" onClick={() => void sair()}>
                <LogOut className="size-4" /> Sair e trocar de conta
              </Button>
            </>
          ) : (
            <>
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-bold tracking-tight">Acesso ao sistema C.R</h2>
            <p className="text-sm text-muted-foreground">Acesse para iniciar suas conferências</p>
          </div>


          <Tabs defaultValue="entrar">
            <TabsList className="w-full">
              <TabsTrigger value="entrar" className="flex-1">Entrar</TabsTrigger>
              <TabsTrigger value="criar" className="flex-1">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="entrar" className="space-y-3 pt-4">
              <div>
                <Label htmlFor="login-email">E-mail</Label>
                <Input id="login-email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </div>
              <div>
                <Label htmlFor="login-senha">Senha</Label>
                <Input id="login-senha" name="senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} type="password" />
              </div>
              <Button className="w-full" size="lg" disabled={carregando} onClick={entrar}>
                Entrar
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                disabled={carregando}
                onClick={recuperarSenha}
              >
                Esqueci minha senha
              </button>
            </TabsContent>

            <TabsContent value="criar" className="space-y-3 pt-4">
              <div>
                <Label htmlFor="cadastro-nome">Nome</Label>
                <Input id="cadastro-nome" name="nome" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cadastro-email">E-mail</Label>
                <Input id="cadastro-email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </div>
              <div>
                <Label htmlFor="cadastro-senha">Senha</Label>
                <Input id="cadastro-senha" name="senha" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} type="password" />
              </div>
              <Button className="w-full" size="lg" disabled={carregando} onClick={cadastrar}>
                Criar conta
              </Button>
            </TabsContent>

          </Tabs>

          {/* Login com Google: ative o provedor no Supabase e defina VITE_LOGIN_GOOGLE="true". */}
          {import.meta.env.VITE_LOGIN_GOOGLE === "true" && (
            <Button
              variant="outline"
              className="w-full"
              size="lg"
              onClick={async () => {
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: `${window.location.origin}${destino}` },
                });
                if (error) toast.error("Não foi possível entrar com o Google");
              }}
            >
              Entrar com Google
            </Button>
          )}
            </>
          )}
        </CardContent>
      </Card>
      </main>
      <RodapeLegal />
    </div>

  );
}
