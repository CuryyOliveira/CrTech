import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Plus, Power, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconeModulo } from "@/components/IconeModulo";
import { supabase } from "@/integrations/supabase/client";
import { useAcesso } from "@/hooks/useAcesso";
import { useModulosEmpresa } from "@/hooks/useModulos";
import { registrarAuditoria } from "@/lib/audit";
import {
  ICONES_MODULO,
  SEGMENTOS,
  TIPOS_MODULO,
  codigoDoNome,
  getSegmento,
  type ModuloEmpresa,
  type TipoModulo,
} from "@/lib/modulos";

type Form = {
  nome: string;
  descricao: string;
  tipo: TipoModulo;
  icone: string;
};

const VAZIO: Form = { nome: "", descricao: "", tipo: "lista", icone: "package" };

/**
 * Motor Universal: o administrador monta os módulos da própria empresa.
 * Os módulos legados continuam funcionando e não aparecem aqui.
 */
export function GestaoModulos() {
  const qc = useQueryClient();
  const { acesso } = useAcesso();
  const empresaId = acesso?.empresaId ?? null;
  const { data: modulos = [], isLoading } = useModulosEmpresa(empresaId);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<ModuloEmpresa | null>(null);
  const [form, setForm] = useState<Form>(VAZIO);
  const [alvoExcluir, setAlvoExcluir] = useState<ModuloEmpresa | null>(null);

  const sugestoes = useMemo(() => {
    const seg = getSegmento(acesso?.segmento ?? null);
    const existentes = new Set(modulos.map((m) => m.nome.trim().toLowerCase()));
    return (seg?.modulos ?? []).filter((s) => !existentes.has(s.nome.trim().toLowerCase()));
  }, [acesso?.segmento, modulos]);

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["empresa-modulos-admin", empresaId] });
    qc.invalidateQueries({ queryKey: ["empresa-modulos", empresaId] });
  }

  const salvar = useMutation({
    mutationFn: async (dados: Form & { id?: string }) => {
      if (!empresaId) throw new Error("Empresa não identificada.");
      const nome = dados.nome.trim();
      if (nome.length < 2) throw new Error("Informe o nome do módulo.");
      const payload = {
        empresa_id: empresaId,
        nome,
        descricao: dados.descricao.trim() || null,
        tipo: dados.tipo,
        icone: dados.icone,
        codigo: codigoDoNome(nome) || `MOD_${Date.now()}`,
        ordem: modulos.length,
        origem: "personalizado" as const,
      };
      if (dados.id) {
        const { error } = await supabase
          .from("empresa_modulos")
          .update({
            nome: payload.nome,
            descricao: payload.descricao,
            tipo: payload.tipo,
            icone: payload.icone,
          })
          .eq("id", dados.id);
        if (error) throw error;
        return "editado" as const;
      }
      const { error } = await supabase.from("empresa_modulos").insert(payload);
      if (error) throw error;
      return "criado" as const;
    },
    onSuccess: async (acao, dados) => {
      invalidar();
      setAberto(false);
      setEditando(null);
      setForm(VAZIO);
      toast.success(acao === "criado" ? "Módulo criado" : "Módulo atualizado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: acao === "criado" ? "criar_modulo" : "editar_modulo",
        detalhe: `Módulo ${dados.nome}`,
        modulo: "ADMIN",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: async (m: ModuloEmpresa) => {
      const { error } = await supabase
        .from("empresa_modulos")
        .update({ ativo: !m.ativo })
        .eq("id", m.id);
      if (error) throw error;
      return m;
    },
    onSuccess: async (m) => {
      invalidar();
      toast.success(m.ativo ? "Módulo desativado" : "Módulo ativado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: m.ativo ? "desativar_modulo" : "ativar_modulo",
        detalhe: `Módulo ${m.nome}`,
        modulo: "ADMIN",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (m: ModuloEmpresa) => {
      const { error } = await supabase
        .from("empresa_modulos")
        .update({ excluido: true, ativo: false })
        .eq("id", m.id);
      if (error) throw error;
      return m;
    },
    onSuccess: async (m) => {
      invalidar();
      setAlvoExcluir(null);
      toast.success("Módulo removido");
      await registrarAuditoria({
        tipo: "administracao",
        acao: "excluir_modulo",
        detalhe: `Módulo ${m.nome}`,
        modulo: "ADMIN",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function abrirNovo() {
    setEditando(null);
    setForm(VAZIO);
    setAberto(true);
  }

  function abrirEdicao(m: ModuloEmpresa) {
    setEditando(m);
    setForm({
      nome: m.nome,
      descricao: m.descricao ?? "",
      tipo: m.tipo,
      icone: m.icone || "package",
    });
    setAberto(true);
  }

  // Limite de módulos ativos conforme o plano contratado (o banco também barra).
  const limiteModulos = acesso?.modulosLimite ?? null;
  const ativosAgora = modulos.filter((m) => m.ativo).length;
  const limiteAtingido = limiteModulos != null && ativosAgora >= limiteModulos;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Cada módulo é uma área de conferência da sua empresa. O funcionamento é o mesmo em todos:
          listas, materiais, contagem, divergências e histórico.
          {limiteModulos != null && (
            <>
              {" "}
              Seu plano permite <strong>{limiteModulos}</strong> módulo(s) ativo(s) — {ativosAgora} em
              uso.
            </>
          )}
        </p>
        <Button
          className="gap-2"
          onClick={abrirNovo}
          disabled={limiteAtingido}
          title={
            limiteAtingido
              ? "Limite de módulos do plano atingido. Desative um módulo ou faça upgrade."
              : undefined
          }
        >
          <Plus className="size-4" /> Novo módulo
        </Button>
      </div>

      {limiteAtingido && (
        <Card className="border-amber-500/50 bg-amber-500/10">
          <CardContent className="p-4 text-sm">
            Você atingiu o limite de {limiteModulos} módulo(s) ativo(s) do seu plano. Desative um
            módulo existente ou altere o plano em “Planos e assinaturas” para criar novos.
          </CardContent>
        </Card>
      )}


      {sugestoes.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">
              Sugestões para {getSegmento(acesso?.segmento ?? null)?.nome ?? "o seu segmento"}
            </p>
            <div className="flex flex-wrap gap-2">
              {sugestoes.map((s) => (
                <Button
                  key={s.nome}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={salvar.isPending}
                  onClick={() =>
                    salvar.mutate({
                      nome: s.nome,
                      descricao: s.descricao,
                      tipo: s.tipo,
                      icone: s.icone,
                    })
                  }
                >
                  <IconeModulo nome={s.icone} className="size-4" /> {s.nome}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando módulos…</p>
      ) : modulos.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum módulo criado ainda. Use as sugestões ou crie o primeiro módulo.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {modulos.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <GripVertical className="size-4 text-muted-foreground" />
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IconeModulo nome={m.icone} className="size-5" />
                </div>
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-semibold">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.descricao || TIPOS_MODULO.find((t) => t.valor === m.tipo)?.descricao}
                  </p>
                </div>
                <Badge variant="secondary">
                  {TIPOS_MODULO.find((t) => t.valor === m.tipo)?.label ?? m.tipo}
                </Badge>
                {!m.ativo && <Badge variant="outline">Inativo</Badge>}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Editar módulo"
                  onClick={() => abrirEdicao(m)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={m.ativo ? "Desativar módulo" : "Ativar módulo"}
                  onClick={() => alternar.mutate(m)}
                >
                  <Power className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remover módulo"
                  onClick={() => setAlvoExcluir(m)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar módulo" : "Novo módulo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome do módulo</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Medicamentos, Almoxarifado, Frota"
              />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="O que é conferido neste módulo"
              />
            </div>
            <div>
              <Label>Como a conferência funciona</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => setForm({ ...form, tipo: v as TipoModulo })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MODULO.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {TIPOS_MODULO.find((t) => t.valor === form.tipo)?.descricao}
              </p>
            </div>
            <div>
              <Label>Ícone</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ICONES_MODULO.map((i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Ícone ${i}`}
                    onClick={() => setForm({ ...form, icone: i })}
                    className={`flex size-10 items-center justify-center rounded-xl border transition-colors ${
                      form.icone === i
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <IconeModulo nome={i} className="size-5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={salvar.isPending}
              onClick={() => salvar.mutate({ ...form, id: editando?.id })}
            >
              {editando ? "Salvar" : "Criar módulo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!alvoExcluir} onOpenChange={(o) => !o && setAlvoExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover “{alvoExcluir?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O módulo deixa de aparecer no menu. As listas e conferências já realizadas continuam
              guardadas no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => alvoExcluir && excluir.mutate(alvoExcluir)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!empresaId && (
        <p className="text-sm text-muted-foreground">
          Cadastre a sua empresa para criar módulos.{" "}
          {SEGMENTOS.length > 0 ? "As sugestões aparecem depois de escolher o segmento." : ""}
        </p>
      )}
    </div>
  );
}
