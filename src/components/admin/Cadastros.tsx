import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Ban, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { CADASTRO_TIPOS, type CadastroRow, type CadastroTipo } from "@/lib/cadastros";
import {
  CampoSelect,
  FiltrosPainel,
  TODOS,
  useBuscaLocal,
  useEstadoFiltros,
  useUsuariosFiltro,
} from "@/components/admin/consulta";
import { EstadoVazio, MenuExportar, Paginacao, SkeletonLista, useConfirmacao } from "@/components/admin/ui-admin";

const PASSO = 20;

/** Cadastros mestres do sistema: setores, perfis, módulos, categorias e tipos. */
export function Cadastros() {
  return (
    <Tabs defaultValue={CADASTRO_TIPOS[0]!.id}>
      <TabsList className="flex w-full flex-wrap">
        {CADASTRO_TIPOS.map((c) => (
          <TabsTrigger key={c.id} value={c.id}>
            {c.titulo}
          </TabsTrigger>
        ))}
      </TabsList>
      {CADASTRO_TIPOS.map((c) => (
        <TabsContent key={c.id} value={c.id} className="pt-4">
          <CadastroCrud tipo={c.id} titulo={c.titulo} singular={c.singular} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

type Form = { id?: string; codigo: string; nome: string; descricao: string; ordem: number; ativo: boolean };

const FORM_VAZIO: Form = { codigo: "", nome: "", descricao: "", ordem: 0, ativo: true };

function CadastroCrud({ tipo, titulo, singular }: { tipo: CadastroTipo; titulo: string; singular: string }) {
  const qc = useQueryClient();
  const confirmacao = useConfirmacao();
  const { data: usuarios = [] } = useUsuariosFiltro();
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    situacao: TODOS,
    excluidos: "nao",
  });
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ campo: "nome" | "codigo" | "ordem" | "updated_at"; asc: boolean }>({
    campo: "ordem",
    asc: true,
  });
  const [limite, setLimite] = useState(PASSO);
  const [form, setForm] = useState<Form | null>(null);

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["cadastros", tipo],
    queryFn: async () => {
      const { data, error } = await db
        .from("cadastros_mestres")
        .select("*")
        .eq("tipo", tipo)
        .order("ordem")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as CadastroRow[];
    },
  });

  const nomeUsuario = (id: string | null) =>
    (id && usuarios.find((u) => u.user_id === id)?.nome) || (id ? `${id.slice(0, 8)}…` : "—");

  const salvar = useMutation({
    mutationFn: async (dados: Form) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      const payload = {
        tipo,
        codigo: dados.codigo.trim(),
        nome: dados.nome.trim(),
        descricao: dados.descricao.trim() || null,
        ordem: dados.ordem,
        ativo: dados.ativo,
        updated_by: uid,
      };
      if (dados.id) {
        const { error } = await db.from("cadastros_mestres").update(payload).eq("id", dados.id);
        if (error) throw new Error(error.message);
        return "editar" as const;
      }
      const { error } = await db.from("cadastros_mestres").insert({ ...payload, created_by: uid });
      if (error) throw new Error(error.message);
      return "criar" as const;
    },
    onSuccess: (modo, dados) => {
      void qc.invalidateQueries({ queryKey: ["cadastros", tipo] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: modo === "criar" ? "cadastro_criado" : "cadastro_editado",
        detalhe: `${singular}: ${dados.nome} (${dados.codigo})`,
        modulo: "ADMIN",
      });
      toast.success(modo === "criar" ? "Cadastro incluído." : "Cadastro atualizado.");
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alterarEstado = useMutation({
    mutationFn: async ({ row, patch }: { row: CadastroRow; patch: Partial<CadastroRow> }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await db
        .from("cadastros_mestres")
        .update({ ...patch, updated_by: auth.user?.id ?? null })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, { row, patch }) => {
      void qc.invalidateQueries({ queryKey: ["cadastros", tipo] });
      const acao =
        patch.excluido !== undefined
          ? patch.excluido
            ? "cadastro_excluido"
            : "cadastro_restaurado"
          : patch.ativo
            ? "cadastro_ativado"
            : "cadastro_inativado";
      void registrarAuditoria({
        tipo: "administracao",
        acao,
        detalhe: `${singular}: ${row.nome} (${row.codigo})`,
        modulo: "ADMIN",
      });
      toast.success("Cadastro atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = useMemo(() => {
    const lista = registros.filter((r) => {
      if (filtros.excluidos === "nao" && r.excluido) return false;
      if (filtros.excluidos === "somente" && !r.excluido) return false;
      if (filtros.situacao === "ativos" && !r.ativo) return false;
      if (filtros.situacao === "inativos" && r.ativo) return false;
      return true;
    });
    const dir = ordem.asc ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = a[ordem.campo];
      const vb = b[ordem.campo];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR") * dir;
    });
  }, [registros, filtros, ordem]);

  const buscados = useBuscaLocal(filtrados, busca, (r) => [r.nome, r.codigo, r.descricao]);
  const visiveis = buscados.slice(0, limite);

  const colunas = [
    { chave: "codigo", titulo: "Código", valor: (r: CadastroRow) => r.codigo },
    { chave: "nome", titulo: "Nome", valor: (r: CadastroRow) => r.nome },
    { chave: "descricao", titulo: "Descrição", valor: (r: CadastroRow) => r.descricao ?? "" },
    { chave: "ordem", titulo: "Ordem", valor: (r: CadastroRow) => String(r.ordem) },
    { chave: "situacao", titulo: "Situação", valor: (r: CadastroRow) => (r.excluido ? "Excluído" : r.ativo ? "Ativo" : "Inativo") },
    { chave: "created_at", titulo: "Criado em", valor: (r: CadastroRow) => fmtDateTime(r.created_at) },
    { chave: "updated_at", titulo: "Última alteração", valor: (r: CadastroRow) => fmtDateTime(r.updated_at) },
    { chave: "responsavel", titulo: "Responsável", valor: (r: CadastroRow) => nomeUsuario(r.updated_by ?? r.created_by) },
  ];

  return (
    <div className="space-y-3">
      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder={`Pesquisar em ${titulo.toLowerCase()}...`}
        onLimpar={() => {
          limpar();
          setBusca("");
        }}
      >
        <CampoSelect
          label="Situação"
          valor={filtros.situacao}
          onChange={(v) => set("situacao", v)}
          opcoes={[
            { valor: "ativos", label: "Ativos" },
            { valor: "inativos", label: "Inativos" },
          ]}
        />
        <div>
          <Label>Excluídos</Label>
          <div className="mt-2 flex gap-2">
            {[
              { v: "nao", l: "Ocultar" },
              { v: "somente", l: "Somente" },
              { v: TODOS, l: "Todos" },
            ].map((o) => (
              <Button
                key={o.v}
                size="sm"
                variant={filtros.excluidos === o.v ? "default" : "outline"}
                onClick={() => set("excluidos", o.v)}
              >
                {o.l}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <Label>Ordenar por</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["ordem", "nome", "codigo", "updated_at"] as const).map((c) => (
              <Button
                key={c}
                size="sm"
                variant={ordem.campo === c ? "default" : "outline"}
                onClick={() => setOrdem((o) => ({ campo: c, asc: o.campo === c ? !o.asc : true }))}
              >
                <ArrowUpDown className="mr-1 size-3.5" />
                {c === "updated_at" ? "Alteração" : c === "ordem" ? "Ordem" : c === "nome" ? "Nome" : "Código"}
              </Button>
            ))}
          </div>
        </div>
      </FiltrosPainel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{buscados.length} registro(s)</p>
        <div className="flex gap-2">
          <MenuExportar
            titulo={`Cadastro de ${titulo}`}
            subtitulo={`${buscados.length} registro(s)`}
            colunas={colunas}
            linhas={buscados}
            onExportado={(f) =>
              void registrarAuditoria({
                tipo: "exportacao",
                acao: "cadastro_exportado",
                detalhe: `${titulo} exportado em ${f.toUpperCase()}`,
                modulo: "ADMIN",
              })
            }
          />
          <Button size="sm" onClick={() => setForm({ ...FORM_VAZIO })}>
            <Plus className="mr-1 size-4" /> Novo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonLista />
      ) : !visiveis.length ? (
        <EstadoVazio
          titulo="Nenhum registro encontrado"
          descricao="Ajuste os filtros ou inclua um novo registro."
          acao={
            <Button size="sm" onClick={() => setForm({ ...FORM_VAZIO })}>
              <Plus className="mr-1 size-4" /> Incluir {singular.toLowerCase()}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visiveis.map((r) => (
            <Card key={r.id} className={r.excluido ? "opacity-60" : undefined}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{r.nome}</p>
                    <Badge variant="outline">{r.codigo}</Badge>
                    {r.excluido ? (
                      <Badge variant="destructive">Excluído</Badge>
                    ) : r.ativo ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
                    )}
                  </div>
                  {r.descricao && <p className="text-xs text-muted-foreground">{r.descricao}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Criado em {fmtDateTime(r.created_at)} · Alterado em {fmtDateTime(r.updated_at)} ·
                    Responsável: {nomeUsuario(r.updated_by ?? r.created_by)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Editar"
                    onClick={() =>
                      setForm({
                        id: r.id,
                        codigo: r.codigo,
                        nome: r.nome,
                        descricao: r.descricao ?? "",
                        ordem: r.ordem,
                        ativo: r.ativo,
                      })
                    }
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={r.ativo ? "Inativar" : "Ativar"}
                    onClick={() => alterarEstado.mutate({ row: r, patch: { ativo: !r.ativo } })}
                  >
                    {r.ativo ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={r.excluido ? "Restaurar" : "Excluir"}
                    onClick={() =>
                      r.excluido
                        ? alterarEstado.mutate({ row: r, patch: { excluido: false } })
                        : confirmacao.pedir(
                            "Excluir registro?",
                            `O registro "${r.nome}" será marcado como excluído e deixará de aparecer nas listas. A exclusão é lógica e pode ser revertida.`,
                            () => alterarEstado.mutate({ row: r, patch: { excluido: true, ativo: false } }),
                          )
                    }
                  >
                    {r.excluido ? <CheckCircle2 className="size-4" /> : <Trash2 className="size-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <Paginacao
            total={buscados.length}
            visiveis={visiveis.length}
            passo={PASSO}
            onMais={() => setLimite((l) => l + PASSO)}
          />
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Editar" : "Novo"} {singular.toLowerCase()}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Código</Label>
                  <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                </div>
                <div>
                  <Label>Nome</Label>
                  <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="w-28">
                  <Label>Ordem</Label>
                  <Input
                    type="number"
                    value={form.ordem}
                    onChange={(e) => setForm({ ...form, ordem: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch
                    id="ativo"
                    checked={form.ativo}
                    onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                  />
                  <Label htmlFor="ativo">Ativo</Label>
                </div>
              </div>
              <Button
                className="w-full"
                disabled={salvar.isPending}
                onClick={() => {
                  if (!form.codigo.trim() || !form.nome.trim())
                    return toast.error("Informe código e nome.");
                  salvar.mutate(form);
                }}
              >
                Salvar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmacao.elemento}
    </div>
  );
}
