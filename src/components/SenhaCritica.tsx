import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validarSenhaAtual } from "@/lib/admin-users.functions";
import type { AcaoCritica } from "@/lib/permissions";

type Pedido = {
  acao: AcaoCritica;
  titulo: string;
  descricao: string;
  executar: () => void;
};

/**
 * Proteção adicional das ações críticas: confirma novamente a senha da conta
 * antes de executar (exclusões, permissões, limpeza, integrações, governança).
 */
export function useSenhaCritica() {
  const validar = useServerFn(validarSenhaAtual);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);

  function fechar() {
    setPedido(null);
    setSenha("");
    setCarregando(false);
  }

  async function confirmar() {
    if (!pedido) return;
    if (!senha) return toast.error("Informe sua senha.");
    setCarregando(true);
    try {
      await validar({ data: { senha, acao: pedido.acao } });
      const executar = pedido.executar;
      fechar();
      executar();
    } catch (e) {
      setCarregando(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível validar a senha.");
    }
  }

  return {
    pedir: (p: Pedido) => {
      setSenha("");
      setPedido(p);
    },
    elemento: (
      <Dialog open={!!pedido} onOpenChange={(v) => !v && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-destructive" />
              {pedido?.titulo ?? "Ação protegida"}
            </DialogTitle>
            <DialogDescription>{pedido?.descricao}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Senha da sua conta</Label>
              <Input
                type="password"
                value={senha}
                autoFocus
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void confirmar()}
              />
            </div>
            <Button className="w-full" disabled={carregando} onClick={() => void confirmar()}>
              Confirmar e executar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    ),
  };
}
