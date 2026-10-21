import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { registrarAuditoria } from "@/lib/audit";
import { MODULOS } from "@/lib/permissions";
import { useMaster } from "@/hooks/useMaster";
import { EstadoVazio, SkeletonLista } from "@/components/admin/ui-admin";

type Plano = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  ambiente: string;
  periodicidade: string | null;
  valor_centavos: number | null;
  moeda: string;
  dias_trial: number;
  modulos: string[] | null;
  max_usuarios: number | null;
  limites: Record<string, unknown> | null;
  ordem: number;
  ativo: boolean;
};

type Form = {
  codigo: string;
  nome: string;
  descricao: string;
  periodicidade: string;
  valor: string;
  dias_trial: string;
  max_usuarios: string;
  max_modulos: string;
  ordem: string;
  modulos: string[];
};

const VAZIO: Form = {
  codigo: "",
  nome: "",
  descricao: "",
  periodicidade: "mensal",
  valor: "",
  dias_trial: "14",
  max_usuarios: "",
  max_modulos: "",
  ordem: "1",
  modulos: [],
};

function reais(centavos: number | null) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Cadastro dos planos comercializados (nome, preço, teste grátis, limites e
 * módulos liberados). Como o catálogo vale para todas as empresas, apenas o
 * Proprietário do Sistema pode alterar — os demais apenas consultam.
 */
export function GestaoPlanos() {
  const qc = useQueryClient();
  const { master, carregando: verificando } = useMaster();
  const [ambiente, setAmbiente] = useState<"live" | "sandbox">("live");
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Plano | null>(null);
  const [form, setForm] = useState<Form>(VAZIO);

  const { data: planos = [], isLoading } = useQuery({
    queryKey: ["planos-admin", ambiente],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("ambiente", ambiente)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Plano[];
    },
  });

  const podeEditar = master;

  function abrirNovo() {
    setEditando(null);
    setForm({ ...VAZIO, ordem: String(planos.length + 1) });
    setAberto(true);
  }

  function abrirEdicao(p: Plano) {
    setEditando(p);
    setForm({
      codigo: p.codigo,
      nome: p.nome,
      descricao: p.descricao ?? "",
      periodicidade: p.periodicidade ?? "mensal",
      valor: p.valor_centavos != null ? String(p.valor_centavos / 100) : "",
      dias_trial: String(p.dias_trial ?? 0),
      max_usuarios: p.max_usuarios != null ? String(p.max_usuarios) : "",
      max_modulos:
        p.limites && p.limites['max_modulos'] != null ? String(p.limites['max_modulos']) : "",
      ordem: String(p.ordem ?? 1),
      modulos: p.modulos ?? [],
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async (dados: Form) => {
      const codigo = dados.codigo.trim().toUpperCase().replace(/\s+/g, "_");
      const nome = dados.nome.trim();
      if (codigo.length < 2) throw new Error("Informe o código do plano.");
      if (nome.length < 2) throw new Error("Informe o nome do plano.");
      const valor = Number(dados.valor.replace(",", "."));
      if (dados.valor && (!Number.isFinite(valor) || valor < 0))
        throw new Error("Informe um valor válido.");

      const limites: Record<string, number | string | boolean> = {
        ...((editando?.limites ?? {}) as Record<string, number | string | boolean>),
      };
      if (dados.max_modulos.trim()) limites['max_modulos'] = Number(dados.max_modulos);
      else delete limites['max_modulos'];

      const payload = {
        codigo,
        nome,
        descricao: dados.descricao.trim() || null,
        ambiente,
        periodicidade: dados.periodicidade,
        valor_centavos: dados.valor.trim() ? Math.round(valor * 100) : null,
        dias_trial: Number(dados.dias_trial) || 0,
        max_usuarios: dados.max_usuarios.trim() ? Number(dados.max_usuarios) : null,
        modulos: dados.modulos,
        limites: limites as unknown as Json,
        ordem: Number(dados.ordem) || 1,
      };

      if (editando) {
        const { error } = await supabase.from("planos").update(payload).eq("id", editando.id);
        if (error) throw error;
        return "atualizado" as const;
      }
      const { error } = await supabase.from("planos").insert({ ...payload, ativo: true });
      if (error)
        throw new Error(
          error.code === "23505"
            ? "Já existe um plano com este código neste ambiente."
            : error.message,
        );
      return "criado" as const;
    },
    onSuccess: async (acao, dados) => {
      void qc.invalidateQueries({ queryKey: ["planos-admin", ambiente] });
      void qc.invalidateQueries({ queryKey: ["planos-publicos"] });
      setAberto(false);
      setEditando(null);
      setForm(VAZIO);
      toast.success(acao === "criado" ? "Plano criado" : "Plano atualizado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: acao === "criado" ? "criar_plano" : "editar_plano",
        modulo: "ADMIN",
        detalhe: `Plano "${dados.nome.trim()}" (${ambiente}) ${acao}`,
      });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o plano."),
  });

  const alternar = useMutation({
    mutationFn: async (p: Plano) => {
      const { error } = await supabase.from("planos").update({ ativo: !p.ativo }).eq("id", p.id);
      if (error) throw error;
      return !p.ativo;
    },
    onSuccess: async (ativo, p) => {
      void qc.invalidateQueries({ queryKey: ["planos-admin", ambiente] });
      void qc.invalidateQueries({ queryKey: ["planos-publicos"] });
      toast.success(ativo ? "Plano publicado" : "Plano despublicado");
      await registrarAuditoria({
        tipo: "administracao",
        acao: ativo ? "ativar_plano" : "desativar_plano",
        modulo: "ADMIN",
        detalhe: `Plano "${p.nome}" ${ativo ? "publicado" : "despublicado"}`,
      });
    },
    onError: () => toast.error("Não foi possível alterar o plano."),
  });

  const modulosDisponiveis = useMemo(
    () => MODULOS.filter((m) => m.id !== "ADMIN").map((m) => ({ id: m.id, titulo: m.titulo })),
    [],
  );

  function alternarModulo(id: string) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.includes(id) ? f.modulos.filter((m) => m !== id) : [...f.modulos, id],
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={ambiente} onValueChange={(v) => setAmbiente(v as "live" | "sandbox")}>
          <TabsList>
            <TabsTrigger value="live">Produção</TabsTrigger>
            <TabsTrigger value="sandbox">Testes</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto">
          {podeEditar ? (
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="mr-1 size-4" /> Novo plano
            </Button>
          ) : (
            <Badge variant="secondary">
              {verificando ? "Verificando permissão…" : "Somente leitura"}
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonLista />
      ) : planos.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum plano cadastrado"
          descricao="Cadastre os planos que serão oferecidos aos clientes."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {planos.map((p) => (
            <Card key={p.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.nome}</p>
                    <p className="text-xs text-muted-foreground">{p.codigo}</p>
                  </div>
                  <Badge variant={p.ativo ? "default" : "secondary"}>
                    {p.ativo ? "Publicado" : "Rascunho"}
                  </Badge>
                </div>
                <p className="text-lg font-bold tabular-nums">
                  {reais(p.valor_centavos)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    /{p.periodicidade ?? "mensal"}
                  </span>
                </p>
                {p.descricao && <p className="text-sm text-muted-foreground">{p.descricao}</p>}
                <p className="text-xs text-muted-foreground">
                  Teste grátis: {p.dias_trial} dia(s) · Usuários: {p.max_usuarios ?? "ilimitado"} ·
                  Módulos: {String(p.limites?.['max_modulos'] ?? "ilimitado")}
                </p>
                {(p.modulos?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.modulos!.map((m) => (
                      <Badge key={m} variant="outline" className="text-[10px]">
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
                {podeEditar && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => abrirEdicao(p)}>
                      <Pencil className="mr-1 size-3.5" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => alternar.mutate(p)}
                      disabled={alternar.isPending}
                    >
                      <Power className="mr-1 size-3.5" />
                      {p.ativo ? "Despublicar" : "Publicar"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar plano" : "Novo plano"}</DialogTitle>
            <DialogDescription>
              Ambiente {ambiente === "live" ? "de produção" : "de testes"}. O valor é usado na
              cobrança e na página de preços.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plano-codigo">Código</Label>
                <Input
                  id="plano-codigo"
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  placeholder="ESSENCIAL"
                  disabled={!!editando}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plano-nome">Nome</Label>
                <Input
                  id="plano-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Essencial"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plano-descricao">Descrição</Label>
              <Textarea
                id="plano-descricao"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Para operações que estão começando"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plano-valor">Valor (R$)</Label>
                <Input
                  id="plano-valor"
                  value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: e.target.value })}
                  placeholder="79,00"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plano-periodicidade">Cobrança</Label>
                <Select
                  value={form.periodicidade}
                  onValueChange={(v) => setForm({ ...form, periodicidade: v })}
                >
                  <SelectTrigger id="plano-periodicidade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mensal">Mensal</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plano-trial">Teste grátis (dias)</Label>
                <Input
                  id="plano-trial"
                  value={form.dias_trial}
                  onChange={(e) => setForm({ ...form, dias_trial: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plano-usuarios">Máx. usuários</Label>
                <Input
                  id="plano-usuarios"
                  value={form.max_usuarios}
                  onChange={(e) => setForm({ ...form, max_usuarios: e.target.value })}
                  placeholder="ilimitado"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plano-modulos">Máx. módulos</Label>
                <Input
                  id="plano-modulos"
                  value={form.max_modulos}
                  onChange={(e) => setForm({ ...form, max_modulos: e.target.value })}
                  placeholder="ilimitado"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plano-ordem">Ordem</Label>
                <Input
                  id="plano-ordem"
                  value={form.ordem}
                  onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Módulos incluídos</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {modulosDisponiveis.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{m.titulo}</span>
                    <Switch
                      checked={form.modulos.includes(m.id)}
                      onCheckedChange={() => alternarModulo(m.id)}
                      aria-label={`Incluir ${m.titulo}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate(form)} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar plano"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
