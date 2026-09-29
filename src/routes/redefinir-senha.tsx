import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Conferência Rápida" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: RedefinirSenha,
});

/**
 * Destino do link "Esqueci minha senha" enviado por e-mail. O Supabase abre esta página já com a
 * sessão de recuperação; aqui o usuário define a nova senha.
 */
function RedefinirSenha() {
  const navigate = useNavigate();
  const [pronto, setPronto] = useState(false);
  const [semSessao, setSemSessao] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    const { data } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (!ativo) return;
      if (evento === "PASSWORD_RECOVERY" || sessao) {
        setPronto(true);
        setSemSessao(false);
      }
    });
    // O link pode já ter sido processado antes do listener ser registrado.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!ativo) return;
      if (session) setPronto(true);
      else {
        const temToken = /access_token|type=recovery|code=/.test(
          window.location.hash + window.location.search,
        );
        if (!temToken) setSemSessao(true);
      }
    });
    return () => {
      ativo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function salvar() {
    if (senha.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres");
      return;
    }
    if (senha !== confirmacao) {
      toast.error("As senhas não conferem");
      return;
    }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar a nova senha. Solicite um novo link.");
      return;
    }
    toast.success("Senha atualizada!");
    void navigate({ to: "/menu" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ClipboardCheck className="size-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Criar nova senha</h1>
          </div>

          {semSessao ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Este link é inválido ou já expirou. Na tela de acesso, informe seu e-mail e toque em
                “Esqueci minha senha” para receber um novo link.
              </p>
              <Button asChild className="w-full" size="lg">
                <Link to="/entrar">Voltar para o acesso</Link>
              </Button>
            </div>
          ) : !pronto ? (
            <p className="text-center text-sm text-muted-foreground">Validando o link…</p>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="nova-senha">Nova senha</Label>
                <Input
                  id="nova-senha"
                  type="password"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
                <Input
                  id="confirmar-senha"
                  type="password"
                  autoComplete="new-password"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                />
              </div>
              <Button className="w-full" size="lg" disabled={salvando} onClick={salvar}>
                Salvar nova senha
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
