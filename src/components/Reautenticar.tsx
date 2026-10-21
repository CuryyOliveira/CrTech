import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const CHAVE = "reauth-ok";

/** Marca de reautenticação válida na sessão atual do navegador. */
export function reautenticado(escopo: string) {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(`${CHAVE}:${escopo}`) === "1";
}

/** Pede apenas a senha do usuário logado antes de liberar uma área restrita. */
export function Reautenticar({
  escopo,
  titulo = "Área restrita",
  onOk,
}: {
  escopo: string;
  titulo?: string;
  onOk: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function confirmar() {
    if (!senha) return toast.error("Informe sua senha.");
    setCarregando(true);
    const { data: auth } = await supabase.auth.getUser();
    const email = auth.user?.email;
    if (!email) {
      setCarregando(false);
      return toast.error("Sessão expirada. Entre novamente.");
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) return toast.error("Senha incorreta.");
    window.sessionStorage.setItem(`${CHAVE}:${escopo}`, "1");
    onOk();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-7" />
            </div>
            <h1 className="text-lg font-bold">{titulo}</h1>
            <p className="text-sm text-muted-foreground">
              Confirme sua senha para continuar.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Senha</Label>
            <Input
              type="password"
              value={senha}
              autoFocus
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmar()}
            />
          </div>
          <Button className="w-full" size="lg" disabled={carregando} onClick={confirmar}>
            Confirmar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
