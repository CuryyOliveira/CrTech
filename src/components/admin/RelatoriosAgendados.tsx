import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { MODULOS } from "@/lib/permissions";
import {
  FORMATOS,
  FREQUENCIAS,
  formatoLabel,
  frequenciaLabel,
  type AgendamentoRow,
} from "@/lib/notificacoes";
import {
  Carregando,
  useSetoresFiltro,
  TODOS,
  Vazio,
  useUsuariosFiltro,
} from "@/components/admin/consulta";

const FONTES = [
  { valor: "historico", label: "Histórico Operacional" },
  { valor: "auditoria", label: "Log de Auditoria" },
];

const VAZIO = {
  nome: "",
  fonte: "historico",
  frequencia: "diario",
  hora: "08:00",
  formato: "pdf",
  usuario: TODOS,
  setor: TODOS,
  modulo: TODOS,
  periodo: "7d",
  destinatarios: "",
};

const PERIODOS = [
  { valor: "1d", label: "Último dia" },
  { valor: "7d", label: "Últimos 7 dias" },
  { valor: "30d", label: "Últimos 30 dias" },
];

/** Agendamento automático dos relatórios já existentes (Fase 2). */
export function RelatoriosAgendados() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const { data: usuarios = [] } = useUsuariosFiltro();
  const setoresFiltro = useSetoresFiltro();

  const { data: agendas = [], isLoading } = useQuery({
    queryKey: ["relatorios-agendados"],
    queryFn: async () => {
      const { data, error } = await db
        .from("relatorios_agendados")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AgendamentoRow[];
    },
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["relatorios-agendados"] });

  const criar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do agendamento");
      const { error } = await db.from("relatorios_agendados").insert({
        nome: form.nome.trim(),
        fonte: form.fonte,
        frequencia: form.frequencia,
        hora: form.hora,
        formato: form.formato,
        destinatarios: form.destinatarios.trim(),
        filtros: {
          usuario: form.usuario,
          setor: form.setor,
          modulo: form.modulo,
          periodo: form.periodo,
        },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void invalidar();
      void registrarAuditoria({
        tipo: "administracao",
        acao: "relatorio_agendado",
        detalhe: `Agendamento ${form.nome} (${frequenciaLabel(form.frequencia)})`,
        modulo: "ADMIN",
      });
      setForm(VAZIO);
      setAberto(false);
      toast.success("Agendamento criado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternar = useMutation({
    mutationFn: async (a: AgendamentoRow) => {
      const { error } = await db
        .from("relatorios_agendados")
        .update({ ativo: !a.ativo })
        .eq("id", a.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void invalidar(),
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("relatorios_agendados").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void invalidar();
      toast.success("Agendamento removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Carregando />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Envio automático dos relatórios do módulo Relatórios, sem duplicar dados.
        </p>
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 size-4" />
              Novo agendamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo agendamento</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="ag-nome">Nome</Label>
                <Input
                  id="ag-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Resumo diário das conferências"
                />
              </div>
              <Campo
                label="Fonte"
                valor={form.fonte}
                onChange={(v) => setForm({ ...form, fonte: v })}
                opcoes={FONTES}
              />
              <Campo
                label="Frequência"
                valor={form.frequencia}
                onChange={(v) => setForm({ ...form, frequencia: v })}
                opcoes={FREQUENCIAS}
              />
              <div>
                <Label htmlFor="ag-hora">Hora do envio</Label>
                <Input
                  id="ag-hora"
                  type="time"
                  value={form.hora}
                  onChange={(e) => setForm({ ...form, hora: e.target.value })}
                />
              </div>
              <Campo
                label="Formato"
                valor={form.formato}
                onChange={(v) => setForm({ ...form, formato: v })}
                opcoes={FORMATOS}
              />
              <Campo
                label="Período"
                valor={form.periodo}
                onChange={(v) => setForm({ ...form, periodo: v })}
                opcoes={PERIODOS}
              />
              <Campo
                label="Usuário"
                valor={form.usuario}
                onChange={(v) => setForm({ ...form, usuario: v })}
                opcoes={[
                  { valor: TODOS, label: "Todos" },
                  ...usuarios.map((u) => ({
                    valor: u.user_id,
                    label: u.nome ?? u.user_id.slice(0, 8),
                  })),
                ]}
              />
              <Campo
                label="Setor"
                valor={form.setor}
                onChange={(v) => setForm({ ...form, setor: v })}
                opcoes={[{ valor: TODOS, label: "Todos" }, ...setoresFiltro]}
              />
              <Campo
                label="Módulo"
                valor={form.modulo}
                onChange={(v) => setForm({ ...form, modulo: v })}
                opcoes={[
                  { valor: TODOS, label: "Todos" },
                  ...MODULOS.map((m) => ({ valor: m.id, label: m.titulo })),
                ]}
              />
              <div className="sm:col-span-2">
                <Label htmlFor="ag-dest">Destinatários (e-mails separados por vírgula)</Label>
                <Input
                  id="ag-dest"
                  value={form.destinatarios}
                  onChange={(e) => setForm({ ...form, destinatarios: e.target.value })}
                  placeholder="gestor@empresa.com, coordenacao@empresa.com"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
                Salvar agendamento
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!agendas.length ? (
        <Vazio texto="Nenhum relatório agendado." />
      ) : (
        <ul className="space-y-2">
          {agendas.map((a) => (
            <li key={a.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <CalendarClock className="size-5 text-primary" />
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold">{a.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {FONTES.find((f) => f.valor === a.fonte)?.label ?? a.fonte} ·{" "}
                      {frequenciaLabel(a.frequencia)} às {a.hora} · {formatoLabel(a.formato)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.destinatarios || "sem destinatários"} · último envio:{" "}
                      {a.ultima_execucao ? fmtDateTime(a.ultima_execucao) : "—"}
                    </p>
                  </div>
                  <Badge variant={a.ativo ? "default" : "outline"}>
                    {a.ativo ? "Ativo" : "Pausado"}
                  </Badge>
                  <Switch
                    checked={a.ativo}
                    aria-label="Ativar agendamento"
                    onCheckedChange={() => alternar.mutate(a)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Excluir agendamento"
                    onClick={() => excluir.mutate(a.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Campo({
  label,
  valor,
  onChange,
  opcoes,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; label: string }[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
