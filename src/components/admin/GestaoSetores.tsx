import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAcesso } from "@/hooks/useAcesso";
import { useSetoresEmpresa } from "@/hooks/useSetores";
import { registrarAuditoria } from "@/lib/audit";
import { codigoSetor, setoresSugeridos, type SetorEmpresa } from "@/lib/setores";
import { EstadoVazio, SkeletonLista } from "@/components/admin/ui-admin";

type Form = { nome: string; descricao: string };

const VAZIO: Form = { nome: "", descricao: "" };

/**
 * Setores da própria empresa. Cada empresa monta sua estrutura organizacional;
 * a empresa legada mantém Agrícola e Indústria como setores normais.
 */
export function GestaoSetores() {
  const qc = useQueryClient();
  const { acesso } = useAcesso();
  const empresaId = acesso?.empresaId ?? null;
  const { data: setores = [], isLoading } = useSetoresEmpresa(empresaId);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<SetorEmpresa | null>(null);
  const [form, setForm] = useState<Form>(VAZIO);

  const sugestoes = useMemo(() => {
    const existentes = new Set(setores.map((s) => s.nome.trim().toLowerCase()));
    return setoresSugeridos(acesso?.segmento ?? null).filter(
      (s) => !existentes.has(s.trim().toLowerCase()),
    );
  }, [acesso?.segmento, setores]);

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["empresa-setores-admin", empresaId] });
    qc.invalidateQueries({ queryKey: ["empresa-setores", empresaId] });
  }

  const salvar = useMutation({
    mutationFn: async (dados: Form & { id?: string }) => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      const nome = dados.nome.trim();
      if (nome.length < 2) throw new Error("Informe o nome do setor.");
      const descricao = dados.descricao.trim() || null;
      if (dados.id) {
        const { error } = await supabase
          .from("empresa_setores")
          .update({ nome, descricao })
          .eq("id", dados.id);
        if (error) throw error;
        return "editado" as const;
      }
      const { error } = await supabase.from("empresa_setores").insert({
        empresa_id: empresaId,
        nome,
        descricao,
        codigo: codigoSetor(nome) || `setor_${Date.now()}`,
        ordem: setores.length + 1,
      });
      if (error) throw error;
      return "criado" as const;
    },
    onSuccess: async (acao, dados) => {
      invalidar();
      setAberto(false);
      setEditando(null);
      setForm(VAZIO);
      toast.success(acao === "criado" ? "Setor criado" : "Setor atualizado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: acao === "criado" ? "criar_setor" : "editar_setor",
        modulo: "ADMIN",
        detalhe: `Setor "${dados.nome.trim()}" ${acao}`,
      });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o setor."),
  });

  const alternar = useMutation({
    mutationFn: async (setor: SetorEmpresa) => {
      const { error } = await supabase
        .from("empresa_setores")
        .update({ ativo: !setor.ativo })
        .eq("id", setor.id);
      if (error) throw error;
      return !setor.ativo;
    },
    onSuccess: async (ativo, setor) => {
      invalidar();
      toast.success(ativo ? "Setor ativado" : "Setor desativado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: ativo ? "ativar_setor" : "desativar_setor",
        modulo: "ADMIN",
        detalhe: `Setor "${setor.nome}" ${ativo ? "ativado" : "desativado"}`,
      });
    },
    onError: () => toast.error("Não foi possível alterar o setor."),
  });

  if (isLoading) return <SkeletonLista />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">Setores da sua empresa</p>
            <p className="text-xs text-muted-foreground">
              Crie os setores que fazem parte da sua operação. Eles ficam disponíveis no cadastro
              de usuários.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditando(null);
              setForm(VAZIO);
              setAberto(true);
            }}
          >
            <Plus className="mr-1.5 size-4" /> Adicionar setor
          </Button>
        </CardContent>
      </Card>

      {sugestoes.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-xs text-muted-foreground">Sugestões para o seu segmento</p>
            <div className="flex flex-wrap gap-2">
              {sugestoes.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate({ nome: s, descricao: "" })}
                >
                  <Plus className="mr-1 size-3.5" /> {s}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {setores.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum setor cadastrado"
          descricao="Crie o primeiro setor da sua empresa para organizar os usuários."
        />
      ) : (
        <div className="space-y-2">
          {setores.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{s.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.descricao ?? `Código: ${s.codigo}`}
                    </p>
                  </div>
                  {!s.ativo && <Badge variant="secondary">Inativo</Badge>}
                  {s.origem === "legado" && <Badge variant="outline">Legado</Badge>}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Editar setor ${s.nome}`}
                    onClick={() => {
                      setEditando(s);
                      setForm({ nome: s.nome, descricao: s.descricao ?? "" });
                      setAberto(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`${s.ativo ? "Desativar" : "Ativar"} setor ${s.nome}`}
                    onClick={() => alternar.mutate(s)}
                  >
                    <Power className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? "Editar setor" : "Novo setor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="setor-nome">Nome do setor *</Label>
              <Input
                id="setor-nome"
                value={form.nome}
                maxLength={60}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Almoxarifado"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setor-descricao">Descrição</Label>
              <Textarea
                id="setor-descricao"
                value={form.descricao}
                maxLength={200}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={salvar.isPending || form.nome.trim().length < 2}
              onClick={() => salvar.mutate({ ...form, id: editando?.id })}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
