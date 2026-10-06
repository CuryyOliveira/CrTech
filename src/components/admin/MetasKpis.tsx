import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/lib/app";
import { fmtDuracao, registrarAuditoria, type HistoricoRow } from "@/lib/audit";
import { MODULOS } from "@/lib/permissions";
import {
  ESCOPOS,
  PERIODOS,
  SITUACAO_LABEL,
  avaliarMeta,
  escopoLabel,
  moduloLabel,
  periodoLabel,
  setorLabel,
  type MetaRow,
} from "@/lib/gerencial";
import { Carregando, Vazio, useSetoresFiltro, useUsuariosFiltro } from "@/components/admin/consulta";

const CORES_SITUACAO: Record<string, string> = {
  atingida: "bg-emerald-600 text-white hover:bg-emerald-600",
  atencao: "bg-amber-500 text-white hover:bg-amber-500",
  abaixo: "bg-destructive text-destructive-foreground",
  sem_dados: "bg-muted text-muted-foreground hover:bg-muted",
};

const VAZIO = {
  escopo: "usuario",
  alvo: "",
  periodo: "mensal",
  min_conferencias: "",
  tempo_max_segundos: "",
  percentual_min: "",
  max_divergencias: "",
};

/** Metas e KPIs: definição por usuário, setor ou módulo e acompanhamento do atingimento. */
export function MetasKpis() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const { data: usuarios = [] } = useUsuariosFiltro();
  const setoresFiltro = useSetoresFiltro();

  const { data: metas = [], isLoading } = useQuery({
    queryKey: ["metas"],
    queryFn: async () => {
      const { data, error } = await db.from("metas").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as MetaRow[];
    },
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["metas-historico"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await db
        .from("historico_conferencias")
        .select("*")
        .order("hora_inicio", { ascending: false })
        .range(0, 4999);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoRow[];
    },
  });

  const alvos = useMemo(() => {
    if (form.escopo === "usuario")
      return usuarios.map((u) => ({ valor: u.user_id, label: u.nome ?? u.user_id.slice(0, 8) }));
    if (form.escopo === "setor") return setoresFiltro;
    return MODULOS.map((m) => ({ valor: m.id, label: m.titulo }));
  }, [form.escopo, usuarios, setoresFiltro]);

  const criar = useMutation({
    mutationFn: async () => {
      if (!form.alvo) throw new Error("Selecione o alvo da meta");
      const num = (v: string) => (v === "" ? null : Number(v));
      const { error } = await db.from("metas").insert({
        escopo: form.escopo,
        alvo: form.alvo,
        alvo_nome: alvos.find((a) => a.valor === form.alvo)?.label ?? form.alvo,
        periodo: form.periodo,
        min_conferencias: num(form.min_conferencias),
        tempo_max_segundos: form.tempo_max_segundos === "" ? null : Number(form.tempo_max_segundos) * 60,
        percentual_min: num(form.percentual_min),
        max_divergencias: num(form.max_divergencias),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["metas"] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "meta_criada",
        detalhe: `Meta ${escopoLabel(form.escopo)} — ${alvos.find((a) => a.valor === form.alvo)?.label ?? form.alvo}`,
        modulo: "ADMIN",
      });
      setForm(VAZIO);
      setAberto(false);
      toast.success("Meta criada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (m: MetaRow) => {
      const { error } = await db.from("metas").delete().eq("id", m.id);
      if (error) throw new Error(error.message);
      return m;
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["metas"] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "meta_excluida",
        detalhe: `Meta ${escopoLabel(m.escopo)} — ${m.alvo_nome ?? m.alvo}`,
        modulo: "ADMIN",
      });
      toast.success("Meta excluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function nomeAlvo(m: MetaRow) {
    if (m.alvo_nome) return m.alvo_nome;
    if (m.escopo === "setor") return setorLabel(m.alvo);
    if (m.escopo === "modulo") return moduloLabel(m.alvo);
    return m.alvo.slice(0, 8);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          As metas são apuradas automaticamente com base no Histórico Operacional.
        </p>
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Nova meta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova meta</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Escopo</Label>
                <Select
                  value={form.escopo}
                  onValueChange={(v) => setForm((f) => ({ ...f, escopo: v, alvo: "" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCOPOS.map((e) => (
                      <SelectItem key={e.valor} value={e.valor}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{escopoLabel(form.escopo)}</Label>
                <Select value={form.alvo} onValueChange={(v) => setForm((f) => ({ ...f, alvo: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {alvos.map((a) => (
                      <SelectItem key={a.valor} value={a.valor}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Período de apuração</Label>
                <Select value={form.periodo} onValueChange={(v) => setForm((f) => ({ ...f, periodo: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODOS.map((p) => (
                      <SelectItem key={p.valor} value={p.valor}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mínimo de conferências</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.min_conferencias}
                  onChange={(e) => setForm((f) => ({ ...f, min_conferencias: e.target.value }))}
                />
              </div>
              <div>
                <Label>Tempo máximo por conferência (min)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.tempo_max_segundos}
                  onChange={(e) => setForm((f) => ({ ...f, tempo_max_segundos: e.target.value }))}
                />
              </div>
              <div>
                <Label>Percentual mínimo de conclusão (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.percentual_min}
                  onChange={(e) => setForm((f) => ({ ...f, percentual_min: e.target.value }))}
                />
              </div>
              <div>
                <Label>Limite máximo de divergências</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.max_divergencias}
                  onChange={(e) => setForm((f) => ({ ...f, max_divergencias: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button disabled={criar.isPending} onClick={() => criar.mutate()}>
                Salvar meta
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Carregando />
      ) : !metas.length ? (
        <Vazio texto="Nenhuma meta cadastrada. Crie a primeira meta para acompanhar os KPIs." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {metas.map((m) => {
            const a = avaliarMeta(m, historico);
            return (
              <Card key={m.id}>
                <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Target className="size-4 text-primary" />
                    {escopoLabel(m.escopo)}: {nomeAlvo(m)}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{periodoLabel(m.periodo)}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => excluir.mutate(m)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge className={CORES_SITUACAO[a.situacao]!}>{SITUACAO_LABEL[a.situacao]}</Badge>
                    <span className="text-sm font-semibold">{a.atingido}% atingido</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      {a.evolucao >= 0 ? (
                        <TrendingUp className="size-3.5 text-emerald-600" />
                      ) : (
                        <TrendingDown className="size-3.5 text-destructive" />
                      )}
                      {a.evolucao >= 0 ? "+" : ""}
                      {a.evolucao}% vs período anterior
                    </span>
                  </div>
                  <Progress className="h-2" value={Math.min(100, a.atingido)} />
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>
                      Conferências: {a.conferencias}
                      {m.min_conferencias ? ` / ${m.min_conferencias}` : ""}
                    </span>
                    <span>
                      Tempo médio: {fmtDuracao(a.tempoMedio)}
                      {m.tempo_max_segundos ? ` / máx ${fmtDuracao(m.tempo_max_segundos)}` : ""}
                    </span>
                    <span>
                      Conclusão média: {a.percentualMedio}%
                      {m.percentual_min ? ` / mín ${m.percentual_min}%` : ""}
                    </span>
                    <span>
                      Divergências: {a.divergencias}
                      {m.max_divergencias != null ? ` / máx ${m.max_divergencias}` : ""}
                    </span>
                    <span>Período anterior: {a.anterior} conferência(s)</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
