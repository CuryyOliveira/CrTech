import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileDown,
  FileSpreadsheet,
  FileText,
  Pause,
  Play,
  Plus,

  Sun,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/app";
import { fmtDuracao, registrarAuditoria, type HistoricoRow } from "@/lib/audit";
import {
  CRITERIOS_RANKING,
  FAIXAS,
  faixaLabel,
  indicadores,
  intervalo,
  porDia,
  porMes,
  porModulo,
  porSemana,
  porSetor,
  porUsuario,
  ranking,
  type FaixaId,
  type Ponto,
} from "@/lib/gerencial";

import { Carregando, Vazio } from "@/components/admin/consulta";
import { agregadosAoVivo, useConferenciasAoVivo } from "@/hooks/useConferenciasAoVivo";
import { relatorioCSV, relatorioExcel, relatorioPDF, type Coluna } from "@/lib/relatorios";


const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Grafico({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function Indicador({
  icone: Icone,
  label,
  valor,
}: {
  icone: typeof Sun;
  label: string;
  valor: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icone className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const eixo = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

function barras(dados: Ponto[], chave: "conferencias" | "divergencias" | "tempoMedio", cor: string) {
  return (
    <BarChart data={dados}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
      <XAxis dataKey="label" tick={eixo} interval="preserveStartEnd" />
      <YAxis tick={eixo} allowDecimals={false} />
      <Tooltip
        formatter={(v: number) => (chave === "tempoMedio" ? fmtDuracao(v) : v)}
        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
      />
      <Bar dataKey={chave} fill={cor} radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}

/** Painel Gerencial: indicadores, gráficos, monitoramento e rankings. */
export function PainelGerencial() {
  const [faixa, setFaixa] = useState<FaixaId>("30d");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [criterio, setCriterio] = useState<(typeof CRITERIOS_RANKING)[number]["valor"]>("conferencias");

  const periodo = useMemo(() => intervalo(faixa, de, ate), [faixa, de, ate]);

  const qc = useQueryClient();
  const { ativas } = useConferenciasAoVivo();
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime: qualquer alteração nas conferências recarrega o período exibido.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["painel-gerencial"] });
  }, [qc, ativas]);

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ["painel-gerencial", periodo],
    refetchInterval: 30000,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("historico_conferencias")
        .select("*")
        .gte("data", periodo.de)
        .lte("data", periodo.ate)
        .order("hora_inicio", { ascending: false })
        .range(0, 4999);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoRow[];
    },
  });

  /**
   * Substitui os agregados do histórico pelos valores oficiais da conferência
   * ativa — o painel nunca calcula números próprios, apenas reflete a
   * conferência.
   */
  const rows = useMemo<HistoricoRow[]>(() => {
    if (!ativas.length) return historico;
    const porConferencia = new Map(ativas.map((c) => [c.id, c]));
    return historico.map((r) => {
      const c = r.conferencia_id ? porConferencia.get(r.conferencia_id) : undefined;
      if (!c) return r;
      return {
        ...r,
        status: c.status,
        quantidade_prevista: c.total,
        quantidade_conferida: c.corretos,
        divergencias: c.divergencias,
        percentual: c.pct,
        total_tempo_pausado: c.total_tempo_pausado,
        ultima_pausa: c.ultima_pausa,
        ultima_retomada: c.ultima_retomada,
        tempo_trabalhado: c.tempo_trabalhado,
        quantidade_pausas: c.quantidade_pausas,
      } as HistoricoRow;
    });
  }, [historico, ativas]);

  const aoVivo = useMemo(() => agregadosAoVivo(ativas, agora), [ativas, agora]);

  const ind = useMemo(() => {
    const base = indicadores(rows);
    // Status e contagens das conferências ativas vêm sempre da conferência.
    return { ...base, emAndamento: aoVivo.emAndamento, pausadas: aoVivo.pausadas };
  }, [rows, aoVivo]);

  const dias = useMemo(() => porDia(rows), [rows]);
  const semanas = useMemo(() => porSemana(rows), [rows]);
  const meses = useMemo(() => porMes(rows), [rows]);
  const modulos = useMemo(() => porModulo(rows), [rows]);
  const estoqueModulos = useMemo(() => {
    const previstos = new Map<string, number>();
    for (const r of rows) {
      const k = r.modulo || "—";
      previstos.set(k, (previstos.get(k) ?? 0) + Number(r.quantidade_prevista ?? 0));
    }
    return modulos.map((m) => ({ ...m, previsto: previstos.get(m.chave) ?? 0 }));
  }, [modulos, rows]);
  const setores = useMemo(() => porSetor(rows), [rows]);
  const usuarios = useMemo(() => porUsuario(rows), [rows]);

  const rankUsuarios = useMemo(() => ranking(usuarios, criterio), [usuarios, criterio]);
  const rankSetores = useMemo(() => ranking(setores, criterio), [setores, criterio]);
  const rankModulos = useMemo(() => ranking(modulos, criterio), [modulos, criterio]);

  const meta = {
    titulo: "Painel Gerencial",
    subtitulo: `Período: ${faixaLabel(faixa, periodo.de, periodo.ate)} — ${rows.length} conferência(s)`,
    geradoEm: new Date().toLocaleString("pt-BR"),
  };

  const colunas: Coluna<{ indicador: string; valor: string }>[] = [
    { chave: "indicador", titulo: "Indicador", valor: (r) => r.indicador },
    { chave: "valor", titulo: "Valor", valor: (r) => r.valor },
  ];

  const resumo = [
    { indicador: "Conferências hoje", valor: String(ind.hoje) },
    { indicador: "Conferências do mês", valor: String(ind.mes) },
    { indicador: "Em andamento", valor: String(ind.emAndamento) },
    { indicador: "Pausadas", valor: String(ind.pausadas) },
    { indicador: "Finalizadas", valor: String(ind.finalizadas) },
    { indicador: "Canceladas", valor: String(ind.canceladas) },
    { indicador: "Corretos", valor: String(ind.itens) },
    { indicador: "Divergências", valor: String(ind.divergencias) },
    { indicador: "Tempo médio", valor: fmtDuracao(ind.tempoMedio) },
    { indicador: "Percentual médio de conclusão", valor: `${ind.percentualMedio}%` },
    { indicador: "Usuários ativos", valor: String(ind.usuariosAtivos) },
    { indicador: "Corretos (conferências ativas)", valor: String(aoVivo.corretos) },
    { indicador: "Divergências (conferências ativas)", valor: String(aoVivo.divergencias) },
    { indicador: "Pendentes (conferências ativas)", valor: String(aoVivo.pendentes) },
    { indicador: "Concluído (conferências ativas)", valor: `${aoVivo.pct}%` },
    {
      indicador: "Materiais adicionados durante a conferência (ativas)",
      valor: String(aoVivo.adicionados),
    },
    ...ativas.map((c) => ({
      indicador: `Adicionados durante a conferência — ${c.unidade_nome ?? c.id}`,
      valor: String(c.adicionados),
    })),
    {
      indicador: "Tempo trabalhado (conferências ativas)",
      valor: fmtDuracao(aoVivo.tempoTrabalhado),
    },

    ...modulos.map((m) => ({ indicador: `Tempo médio — ${m.label}`, valor: fmtDuracao(m.tempoMedio) })),
    ...setores.map((s) => ({ indicador: `Conferências — ${s.label}`, valor: String(s.conferencias) })),
    ...rankUsuarios.map((u, i) => ({
      indicador: `Ranking ${i + 1} — ${u.label}`,
      valor: `${u.conferencias} conf. • ${u.produtividade} itens/conf. • ${fmtDuracao(u.tempoMedio)} • ${u.indiceDivergencia}% diverg.`,
    })),
  ];

  function exportar(formato: "pdf" | "excel" | "csv") {
    if (!resumo.length) return toast.error("Sem dados para exportar");
    if (formato === "pdf") relatorioPDF(colunas, resumo, meta);
    if (formato === "excel") relatorioExcel(colunas, resumo, meta);
    if (formato === "csv") relatorioCSV(colunas, resumo, meta);
    void registrarAuditoria({
      tipo: "exportacao",
      acao: "painel_exportado",
      detalhe: `Painel Gerencial exportado em ${formato.toUpperCase()} — ${meta.subtitulo}`,
      modulo: "ADMIN",
    });
    toast.success("Exportação gerada");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Período</Label>
            <Select value={faixa} onValueChange={(v) => setFaixa(v as FaixaId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FAIXAS.map((f) => (
                  <SelectItem key={f.valor} value={f.valor}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {faixa === "personalizado" && (
            <>
              <div>
                <Label>De</Label>
                <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              </div>
              <div>
                <Label>Até</Label>
                <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={() => exportar("pdf")}>
              <FileText className="mr-1.5 size-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportar("excel")}>
              <FileSpreadsheet className="mr-1.5 size-4" />
              Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportar("csv")}>
              <FileDown className="mr-1.5 size-4" />
              CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Carregando />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador icone={Sun} label="Conferências hoje" valor={ind.hoje} />
            <Indicador icone={CalendarDays} label="Conferências do mês" valor={ind.mes} />
            <Indicador icone={Play} label="Em andamento" valor={ind.emAndamento} />
            <Indicador icone={Pause} label="Pausadas" valor={ind.pausadas} />
            <Indicador icone={CheckCircle2} label="Finalizadas" valor={ind.finalizadas} />
            <Indicador icone={XCircle} label="Canceladas" valor={ind.canceladas} />
            <Indicador icone={Boxes} label="Corretos" valor={ind.itens} />
            <Indicador icone={AlertTriangle} label="Divergências" valor={ind.divergencias} />
            <Indicador icone={Clock} label="Tempo médio" valor={fmtDuracao(ind.tempoMedio)} />
            <Indicador icone={Users} label="Usuários ativos" valor={ind.usuariosAtivos} />
            <Indicador icone={CheckCircle2} label="Conclusão média" valor={`${ind.percentualMedio}%`} />
            <Indicador icone={CalendarDays} label="Total no período" valor={ind.total} />
          </div>

          {!!ativas.length && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Indicador icone={Boxes} label="📦 Total (ativas)" valor={aoVivo.total} />
              <Indicador icone={CheckCircle2} label="✅ Corretos (ativas)" valor={aoVivo.corretos} />
              <Indicador
                icone={AlertTriangle}
                label="⚠️ Divergências (ativas)"
                valor={aoVivo.divergencias}
              />
              <Indicador icone={Clock} label="⏳ Pendentes (ativas)" valor={aoVivo.pendentes} />
              <Indicador
                icone={Plus}
                label="➕ Adicionados durante a conferência"
                valor={aoVivo.adicionados}
              />
              <Indicador icone={CheckCircle2} label="Concluído (ativas)" valor={`${aoVivo.pct}%`} />
              <Indicador
                icone={Clock}
                label="Tempo trabalhado (ativas)"
                valor={fmtDuracao(aoVivo.tempoTrabalhado)}
              />
            </div>
          )}

          {/* Estoque total e divergência por módulo — atualizado em tempo real,
              pois `rows` já reflete os valores oficiais das conferências ativas. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Boxes className="size-4 text-primary" />
                Estoque total e divergência por módulo
                <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  tempo real
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!estoqueModulos.length ? (
                <Vazio texto="Nenhuma conferência no período para calcular o estoque por módulo." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {estoqueModulos.map((m) => {
                    const pctDiv = m.previsto
                      ? Math.min(100, Math.round((m.divergencias / m.previsto) * 100))
                      : 0;
                    return (
                      <div key={m.chave} className="rounded-lg border p-4">
                        <p className="truncate text-sm font-medium">{m.label}</p>
                        <div className="mt-3 space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Estoque previsto</span>
                            <span className="font-semibold">{m.previsto}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Conferido</span>
                            <span className="font-semibold">{m.itens}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Divergências</span>
                            <span className={m.divergencias ? "font-semibold text-destructive" : "font-semibold"}>
                              {m.divergencias}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-destructive transition-all"
                            style={{ width: `${pctDiv}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[11px] text-muted-foreground">
                          {pctDiv}% divergente
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Custo médio por módulo: divergências / estoque conferido,
              atualizado em tempo real pelos valores das conferências ativas. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-primary" />
                Custo médio por módulo
                <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  tempo real
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!modulos.length ? (
                <Vazio texto="Nenhuma conferência no período para calcular o custo médio por módulo." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {modulos
                    .map((m) => ({
                      ...m,
                      custoMedio: m.itens
                        ? Number(((m.divergencias / m.itens) * 100).toFixed(1))
                        : 0,
                    }))
                    .sort((a, b) => b.custoMedio - a.custoMedio)
                    .map((m) => (
                      <div key={m.chave} className="rounded-lg border p-4">
                        <p className="truncate text-sm font-medium">{m.label}</p>
                        <div className="mt-3 space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Estoque conferido</span>
                            <span className="font-semibold">{m.itens}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Divergências</span>
                            <span className={m.divergencias ? "font-semibold text-destructive" : "font-semibold"}>
                              {m.divergencias}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Custo médio</span>
                            <span className="font-semibold">{m.custoMedio}%</span>
                          </div>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-destructive transition-all"
                            style={{ width: `${Math.min(100, m.custoMedio)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-[11px] text-muted-foreground">
                          {m.custoMedio}% do conferido
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="volume">
            <TabsList>
              <TabsTrigger value="volume">Volume</TabsTrigger>
              <TabsTrigger value="divergencias">Divergências</TabsTrigger>
              <TabsTrigger value="tempo">Tempo</TabsTrigger>
              <TabsTrigger value="rankings">Rankings</TabsTrigger>
            </TabsList>

            <TabsContent value="volume" className="grid gap-3 lg:grid-cols-2">
              <Grafico titulo="Conferências por dia">
                <LineChart data={dias}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={eixo} interval="preserveStartEnd" />
                  <YAxis tick={eixo} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="conferencias" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                </LineChart>
              </Grafico>
              <Grafico titulo="Conferências por semana">
                {barras(semanas, "conferencias", "var(--chart-2)")}
              </Grafico>
              <Grafico titulo="Conferências por mês">
                {barras(meses, "conferencias", "var(--chart-3)")}
              </Grafico>
              <Grafico titulo="Conferências por módulo">
                {barras(modulos, "conferencias", "var(--chart-1)")}
              </Grafico>
              <Grafico titulo="Conferências por setor">
                <PieChart>
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Pie data={setores} dataKey="conferencias" nameKey="label" outerRadius={90} label>
                    {setores.map((s, i) => (
                      <Cell key={s.chave} fill={CORES[i % CORES.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </Grafico>
            </TabsContent>

            <TabsContent value="divergencias" className="grid gap-3 lg:grid-cols-2">
              <Grafico titulo="Divergências por período">
                {barras(dias, "divergencias", "var(--chart-3)")}
              </Grafico>
              <Grafico titulo="Divergências por módulo">
                {barras(modulos, "divergencias", "var(--chart-3)")}
              </Grafico>
            </TabsContent>

            <TabsContent value="tempo" className="grid gap-3 lg:grid-cols-2">
              <Grafico titulo="Tempo médio por módulo">
                {barras(modulos, "tempoMedio", "var(--chart-5)")}
              </Grafico>
              <Grafico titulo="Tempo médio por dia">
                {barras(dias, "tempoMedio", "var(--chart-5)")}
              </Grafico>
            </TabsContent>

            <TabsContent value="rankings" className="space-y-3">
              <div className="max-w-sm">
                <Label>Critério do ranking</Label>
                <Select value={criterio} onValueChange={(v) => setCriterio(v as typeof criterio)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRITERIOS_RANKING.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <RankingCard titulo="Usuários" linhas={rankUsuarios} />
                <RankingCard titulo="Setores" linhas={rankSetores} />
                <RankingCard titulo="Módulos" linhas={rankModulos} />
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function RankingCard({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: ReturnType<typeof ranking>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Ranking — {titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!linhas.length ? (
          <Vazio texto="Sem dados no período." />
        ) : (
          linhas.slice(0, 10).map((l, i) => (
            <div key={l.chave} className="flex items-center gap-3 rounded-lg border p-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.label}</p>
                <p className="text-xs text-muted-foreground">
                  {l.conferencias} conf. • {l.produtividade} itens/conf. • {fmtDuracao(l.tempoMedio)} •{" "}
                  {l.indiceDivergencia}% diverg.
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
