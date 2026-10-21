import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/app";
import { PERFIS, type Perfil } from "@/lib/permissions";

type Row = { id: string; nome: string | null; perfil: Perfil };

/** Painel do administrador para definir o perfil de acesso de cada usuário. */
export function GerenciarPerfis() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const { data: usuarios = [] } = useQuery({
    queryKey: ["user-profiles"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await db
        .from("user_profiles")
        .select("id,nome,perfil")
        .order("nome");
      if (error) throw error;
      return data as Row[];
    },
  });

  const salvar = useMutation({
    mutationFn: async ({
      id,
      valores,
    }: {
      id: string;
      valores: { perfil?: Perfil; nome?: string };
    }) => {
      const { error } = await db.from("user_profiles").update(valores).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-profiles"] });
      qc.invalidateQueries({ queryKey: ["perfil-atual"] });
      toast.success("Usuário atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Gerenciar perfis de acesso">
          <Users className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Perfis de acesso</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <Input
                className="min-w-0 flex-1"
                defaultValue={u.nome ?? ""}
                placeholder="Nome"
                onBlur={(e) => {
                  const nome = e.target.value.trim();
                  if (nome && nome !== (u.nome ?? "")) salvar.mutate({ id: u.id, valores: { nome } });
                }}
              />
              <Select
                value={u.perfil}
                onValueChange={(v) => salvar.mutate({ id: u.id, valores: { perfil: v as Perfil } })}
              >
                <SelectTrigger className="w-[150px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERFIS.map((p) => (
                    <SelectItem key={p.valor} value={p.valor}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {!usuarios.length && (
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
