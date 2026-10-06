import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  acharColuna,
  acharColunaQuantidade,
  db,
  fmtDate,
  listarColunas,
  log,
  normalize,
  ordenarPorLocacao,
  pick,
  salvarMateriais,
  toNumero,
  type Unidade,
} from "@/lib/app";
import { readSheet } from "@/lib/export";
import { resolverLegado, type ModuloResolvido } from "@/lib/modulos";
import { type ModuloId } from "@/lib/permissions";



type Stats = Record<string, { total: number; ultima?: string; conferidos: number; diverg: number }>;

type ResumoImportacao = {
  arquivo: string;
  origem: string;
  colunasPlanilha: string[];
  mapeamento: { campo: string; coluna: string | null }[];
  linhas: number;
  importados: number;
  ignorados: number;
  grupos?: number;
  lista?: string;
};

/**
 * Motor universal de listas: funciona igual para módulos legados
 * (resolvidos por `unidades.tipo`) e módulos criados pela empresa
 * (resolvidos por `unidades.modulo_id`).
 */
export function UnidadesPage({ modulo, alvo }: { modulo?: ModuloId; alvo?: ModuloResolvido }) {
  const resolvido = alvo ?? resolverLegado(modulo as ModuloId)!;
  const { titulo, familia, tipoUnidade: tipo, moduloId, chave } = resolvido;
  const escopo = moduloId ? { modulo_id: moduloId } : {};
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [alvoExcluir, setAlvoExcluir] = useState<Unidade | null>(null);
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [destinoResumo, setDestinoResumo] = useState<string | null>(null);



  const { data: unidades = [] } = useQuery({
    queryKey: ["unidades", chave],
    queryFn: async () => {
      let consulta = db.from("unidades").select("*");
      consulta = moduloId ? consulta.eq("modulo_id", moduloId) : consulta.eq("tipo", tipo);
      const { data, error } = await consulta.order("created_at", { ascending: false });
      if (error) throw error;
      return data as Unidade[];
    },
  });

  const { data: stats = {} as Stats } = useQuery({
    queryKey: ["unidades-stats", chave, unidades.map((u) => u.id).join(",")],

    enabled: unidades.length > 0,
    queryFn: async () => {
      const ids = unidades.map((u) => u.id);
      const [mats, confs] = await Promise.all([
        db.from("materiais").select("id,unidade_id").in("unidade_id", ids),
        db
          .from("conferencias")
          .select("id,unidade_id,data,status")
          .in("unidade_id", ids)
          .order("created_at", { ascending: false }),
      ]);
      const out: Stats = {};
      for (const id of ids) out[id] = { total: 0, conferidos: 0, diverg: 0 };
      for (const m of (mats.data ?? []) as { unidade_id: string }[]) out[m.unidade_id].total++;
      for (const c of (confs.data ?? []) as { unidade_id: string; data: string }[]) {
        if (!out[c.unidade_id].ultima) out[c.unidade_id].ultima = c.data;
      }
      return out;
    },
  });

  const criar = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await db
        .from("unidades")
        .insert({ tipo, ...escopo, ...payload })
        .select()
        .single();
      if (error) throw error;
      return data as Unidade;
    },
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["unidades", chave] });
      log("cadastro", `Unidade ${u.nome}`);
      setNovo(false);
      setForm({});
      toast.success("Cadastrado com sucesso");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("unidades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unidades", chave] });
      log("exclusao", "Unidade excluída");
      toast.success("Excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ERRO_COLUNA =
    "Não foi encontrada a coluna Quantidade Esperada na planilha. Importação cancelada.";

  async function importarPlanilhaCaixas(file: File) {
    let rows: Record<string, unknown>[];
    try {
      rows = await readSheet(file);
    } catch (e) {
      return toast.error(`Não foi possível ler a planilha: ${(e as Error).message}`);
    }
    if (!rows.length) return toast.error("Planilha vazia");
    const colQtd = acharColunaQuantidade(rows);
    if (!colQtd) return toast.error(ERRO_COLUNA);

    const grupos = new Map<string, { codigo: string; itens: Record<string, unknown>[] }>();
    let ignorados = 0;
    for (const r of rows) {
      const nome = pick(r, ["funcionario", "colaborador", "nome"]);
      if (!nome) continue;
      const qtd = toNumero(r[colQtd]);
      if (qtd === null) {
        ignorados++;
        continue;
      }
      const codFunc = pick(r, ["matricula", "codigo funcionario", "cod func"]);
      const g = grupos.get(nome) ?? { codigo: codFunc, itens: [] };
      g.itens.push({
        codigo: pick(r, ["codigo material", "cod material", "codigo", "cod"]),
        descricao: pick(r, ["descricao", "material", "item"]),
        quantidade: qtd,
      });
      grupos.set(nome, g);
    }
    if (!grupos.size) return toast.error("Nenhum funcionário com quantidade válida na planilha");
    let mescladas = 0;
    let atualizadas = 0;
    for (const [nome, g] of grupos) {
      const existente = unidades.find((u) => normalize(u.nome) === normalize(nome));
      let unidadeId = existente?.id;
      if (!unidadeId) {
        const { data, error } = await db
          .from("unidades")
          .insert({ tipo, ...escopo, nome, matricula: g.codigo })
          .select()
          .single();
        if (error) return toast.error(error.message);
        unidadeId = (data as Unidade).id;
      }
      let res;
      try {
        res = await salvarMateriais(
          unidadeId,
          g.itens.map((i) => ({
            codigo: String(i.codigo || "—"),
            descricao: String(i.descricao ?? ""),
            quantidade_esperada: i.quantidade as number,
            funcionario_nome: nome,
            funcionario_codigo: g.codigo,
          })),
        );
      } catch (e) {
        return toast.error((e as Error).message);
      }
      mescladas += res.mesclados;
      atualizadas += res.atualizados;
    }
    qc.invalidateQueries({ queryKey: ["unidades", chave] });
    const importados = [...grupos.values()].reduce((s, g) => s + g.itens.length, 0);
    log("importacao", `Planilha de caixas (${grupos.size} funcionários, coluna "${colQtd}")`);
    setResumo({
      arquivo: file.name,
      origem: "Planilha de caixas",
      colunasPlanilha: listarColunas(rows),
      mapeamento: [
        { campo: "Funcionário", coluna: acharColuna(rows, ["funcionario", "colaborador", "nome"]) },
        {
          campo: "Matrícula",
          coluna: acharColuna(rows, ["matricula", "codigo funcionario", "cod func"]),
        },
        {
          campo: "Código",
          coluna: acharColuna(rows, ["codigo material", "cod material", "codigo", "cod"]),
        },
        { campo: "Descrição", coluna: acharColuna(rows, ["descricao", "material", "item"]) },
        { campo: "Qtd. esperada", coluna: colQtd },
      ],
      linhas: rows.length,
      importados,
      ignorados,
      grupos: grupos.size,
    });
    toast.success(
      `${grupos.size} funcionário(s) importado(s)` +
        (atualizadas ? ` — ${atualizadas} material(is) atualizado(s) sem duplicar` : "") +
        (mescladas ? ` — ${mescladas} linha(s) repetida(s) mesclada(s)` : "") +
        (ignorados ? ` — ${ignorados} linha(s) sem quantidade ignorada(s)` : ""),
    );
  }


  async function importarPrateleira(file: File, nomeLista: string) {
    let rows: Record<string, unknown>[];
    try {
      rows = await readSheet(file);
    } catch (e) {
      return toast.error(`Não foi possível ler a planilha: ${(e as Error).message}`);
    }
    if (!rows.length) return toast.error("Planilha vazia");
    const colQtd = acharColunaQuantidade(rows);
    if (!colQtd) return toast.error(ERRO_COLUNA);

    let ignorados = 0;
    const brutos = rows
      .map((r) => {
        const qtd = toNumero(r[colQtd]);
        return {
          codigo: pick(r, ["codigo", "cod"]) || "—",
          descricao: pick(r, ["descricao", "material", "item"]),
          locacao: pick(r, ["locacao", "local", "endereco"]),
          quantidade_esperada: qtd,
        };
      })
      .filter((i) => {
        if (!i.descricao && i.codigo === "—") return false;
        if (i.quantidade_esperada === null) {
          ignorados++;
          return false;
        }
        return true;
      });
    if (!brutos.length) return toast.error(ERRO_COLUNA);

    const jaExiste = unidades.find((u) => normalize(u.nome) === normalize(nomeLista));
    let unidadeId = jaExiste?.id;
    if (!unidadeId) {
      const { data, error } = await db
        .from("unidades")
        .insert({ tipo, ...escopo, nome: nomeLista })
        .select()
        .single();
      if (error) return toast.error(error.message);
      unidadeId = (data as Unidade).id;
    }
    const itens = ordenarPorLocacao(
      brutos.map((i) => ({
        codigo: i.codigo,
        descricao: i.descricao,
        locacao: i.locacao,
        quantidade_esperada: i.quantidade_esperada as number,
      })),
    );
    let res;
    try {
      res = await salvarMateriais(unidadeId, itens);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ["unidades", chave] });
    log("importacao", `Prateleira ${nomeLista} (${itens.length} itens, coluna "${colQtd}")`);
    setNovo(false);
    setResumo({
      arquivo: file.name,
      origem: "Lista de prateleira",
      colunasPlanilha: listarColunas(rows),
      mapeamento: [
        { campo: "Código", coluna: acharColuna(rows, ["codigo", "cod"]) },
        { campo: "Descrição", coluna: acharColuna(rows, ["descricao", "material", "item"]) },
        { campo: "Locação", coluna: acharColuna(rows, ["locacao", "local", "endereco"]) },
        { campo: "Qtd. esperada", coluna: colQtd },
      ],
      linhas: rows.length,
      importados: itens.length,
      ignorados,
      lista: nomeLista,
    });
    toast.success(
      `${res.inseridos} item(ns) novo(s)` +
        (res.atualizados ? `, ${res.atualizados} atualizado(s)` : "") +
        (res.mesclados ? `, ${res.mesclados} repetido(s) mesclado(s)` : "") +
        (ignorados ? ` — ${ignorados} sem quantidade ignorada(s)` : ""),
    );
    setDestinoResumo(unidadeId);
  }



  const lista = unidades.filter(
    (u) =>
      normalize(u.nome).includes(normalize(busca)) ||
      normalize(u.placa).includes(normalize(busca)) ||
      normalize(u.matricula).includes(normalize(busca)),
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/menu" aria-label="Voltar ao menu">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <h1 className="flex-1 truncate text-lg font-bold">{titulo}</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <Dialog open={novo} onOpenChange={setNovo}>
            <DialogTrigger asChild>
              <Button size="lg" className="gap-2">
                <Plus className="size-5" /> Novo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {familia === "prateleira" ? "Nova lista de prateleira" : "Novo cadastro"}
                </DialogTitle>
              </DialogHeader>

              {familia === "prateleira" ? (
                <div className="space-y-3">
                  <div>
                    <Label>Título da lista</Label>
                    <Input
                      value={form.nome ?? ""}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      placeholder="Ex.: Prateleira A1"
                    />
                  </div>
                  <div>
                    <Label>Importar planilha (descrição, locação, código, qtd. do sistema)</Label>
                    <Input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (!form.nome) return toast.error("Informe o título antes de importar");
                        importarPrateleira(f, form.nome);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(familia === "caminhao"
                    ? [
                        ["nome", "Nome"],
                        ["placa", "Placa"],
                        ["modelo", "Modelo"],
                        ["frota", "Frota"],
                        ["ano", "Ano"],
                        ["setor", "Setor"],
                      ]
                    : [
                        ["nome", "Nome do funcionário"],
                        ["matricula", "Matrícula (código)"],
                        ["gestor", "Gestor responsável"],
                      ]
                  ).map(([k, label]) => (
                    <div key={k}>
                      <Label>{label}</Label>
                      <Input
                        value={form[k] ?? ""}
                        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div>
                    <Label>Observações</Label>
                    <Textarea
                      value={form.observacoes ?? ""}
                      onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNovo(false)}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        if (!form.nome) return toast.error("Informe o nome");
                        criar.mutate(form);
                      }}
                    >
                      Salvar
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {familia === "caixa" && (
            <Button variant="secondary" size="lg" className="gap-2" asChild>
              <label>
                <FileSpreadsheet className="size-5" /> Importar planilha
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importarPlanilhaCaixas(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          )}

          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-9"
              placeholder={familia === "caixa" ? "Filtrar funcionário" : "Pesquisar"}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {lista.map((u) => {
            const s = stats[u.id] ?? { total: 0, conferidos: 0, diverg: 0 };
            return (
              <Card key={u.id} className="transition-shadow hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <Link
                    to="/unidade/$id"
                    params={{ id: u.id }}
                    className="block space-y-1"
                    aria-label={`Abrir ${u.nome}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-base font-semibold">{u.nome}</span>
                      <Badge variant={u.ativo ? "default" : "secondary"}>
                        {u.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {u.placa || u.matricula || u.gestor || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Última conferência: {s.ultima ? fmtDate(s.ultima) : "nenhuma"}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Progress value={s.total ? 100 : 0} className="h-2" />
                      <span className="text-xs text-muted-foreground">{s.total} itens</span>
                    </div>
                  </Link>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setAlvoExcluir(u)}
                    >
                      <Trash2 className="mr-1 size-4" /> Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!lista.length && (
            <p className="text-sm text-muted-foreground">Nenhum registro cadastrado ainda.</p>
          )}
        </div>
      </main>

      <AlertDialog open={!!alvoExcluir} onOpenChange={(o) => !o && setAlvoExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{alvoExcluir?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os materiais, conferências e históricos vinculados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (alvoExcluir) excluir.mutate(alvoExcluir.id);
                setAlvoExcluir(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!resumo}
        onOpenChange={(o) => {
          if (!o) {
            setResumo(null);
            setDestinoResumo(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resumo da importação</DialogTitle>
          </DialogHeader>
          {resumo && (
            <div className="space-y-4 text-sm">
              <div className="space-y-1 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Arquivo:</span> {resumo.arquivo}
                </p>
                <p>
                  <span className="font-medium text-foreground">Origem:</span> {resumo.origem}
                  {resumo.lista ? ` — ${resumo.lista}` : ""}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Linhas lidas", resumo.linhas],
                  ["Itens carregados", resumo.importados],
                  ["Ignorados", resumo.ignorados],
                  ...(resumo.grupos != null
                    ? ([["Funcionários", resumo.grupos]] as [string, number][])
                    : []),
                ].map(([label, valor]) => (
                  <div key={String(label)} className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold">{valor as number}</p>
                    <p className="text-xs text-muted-foreground">{label as string}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="font-medium">Colunas reconhecidas</p>
                <div className="divide-y rounded-lg border">
                  {resumo.mapeamento.map((m) => (
                    <div key={m.campo} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="text-muted-foreground">{m.campo}</span>
                      {m.coluna ? (
                        <Badge variant="secondary" className="font-mono">
                          {m.coluna}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive">
                          não encontrada
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-medium">Cabeçalhos da planilha</p>
                <div className="flex flex-wrap gap-1">
                  {resumo.colunasPlanilha.map((c) => (
                    <Badge key={c} variant="outline" className="font-mono text-xs">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>

              {resumo.ignorados > 0 && (
                <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {resumo.ignorados} linha(s) foram ignoradas por não ter quantidade numérica válida
                  na coluna detectada.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResumo(null);
                setDestinoResumo(null);
              }}
            >
              Fechar
            </Button>
            {destinoResumo && (
              <Button
                onClick={() => {
                  const id = destinoResumo;
                  setResumo(null);
                  setDestinoResumo(null);
                  navigate({ to: "/unidade/$id", params: { id } });
                }}
              >
                Abrir lista
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
