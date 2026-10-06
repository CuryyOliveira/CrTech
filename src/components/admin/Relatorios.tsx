import { duracaoRegistrada } from "@/lib/gerencial";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db, fmtDate, fmtDateTime, fmtTime } from "@/lib/app";
import { MODULOS, PERFIS } from "@/lib/permissions";
import {
  STATUS_HISTORICO,
  fmtDuracao,
  registrarAuditoria,
  statusLabel,
  tipoAcaoLabel,
  TIPOS_ACAO,
  type AuditoriaRow,
  type HistoricoRow,
} from "@/lib/audit";
import {
  CampoPeriodo,
  CampoSelect,
  Carregando,
  PAGINA,
  useSetoresFiltro,
  TODOS,
  Vazio,
  useEstadoFiltros,
  useListasFiltro,
  useUsuariosFiltro,
} from "@/components/admin/consulta";
import {
  relatorioCSV,
  relatorioExcel,
  relatorioImprimir,
  relatorioPDF,
  type Coluna,
} from "@/lib/relatorios";

const FONTES = [
  { valor: "historico", label: "Histórico Operacional" },
  { valor: "auditoria", label: "Log de Auditoria" },
];

const LIMITE_MAX = 5000;

const COLUNAS_HIST: Coluna<HistoricoRow>[] = [
  { chave: "data", titulo: "Data", valor: (r) => fmtDate(r.hora_inicio) },
  { chave: "usuario", titulo: "Usuário", valor: (r) => r.nome ?? r.usuario_email ?? "—" },
  {
    chave: "perfil",
    titulo: "Perfil",
    valor: (r) => PERFIS.find((p) => p.valor === r.perfil)?.label ?? r.perfil ?? "—",
  },
  { chave: "setor", titulo: "Setor", valor: (r) => r.setor ?? "—" },
  { chave: "modulo", titulo: "Módulo", valor: (r) => r.modulo_titulo ?? r.modulo ?? "—" },
  { chave: "lista", titulo: "Lista", valor: (r) => r.lista ?? "—" },
  { chave: "inicio", titulo: "Início", valor: (r) => fmtTime(r.hora_inicio) },
  { chave: "fim", titulo: "Término", valor: (r) => (r.hora_fim ? fmtTime(r.hora_fim) : "—") },
  { chave: "tempo", titulo: "Tempo total", valor: (r) => fmtDuracao(duracaoRegistrada(r)) },
  { chave: "prevista", titulo: "Prevista", valor: (r) => String(Number(r.quantidade_prevista)) },
  { chave: "conferida", titulo: "Corretos", valor: (r) => String(Number(r.quantidade_conferida)) },
  { chave: "diverg", titulo: "Divergências", valor: (r) => String(Number(r.divergencias)) },
  { chave: "pct", titulo: "% concluído", valor: (r) => `${Number(r.percentual)}%` },
  { chave: "status", titulo: "Status", valor: (r) => statusLabel(r.status) },
];

const COLUNAS_AUD: Coluna<AuditoriaRow>[] = [
  { chave: "data", titulo: "Data", valor: (r) => fmtDate(r.created_at) },
  { chave: "hora", titulo: "Hora", valor: (r) => fmtTime(r.created_at) },
  { chave: "usuario", titulo: "Usuário", valor: (r) => r.nome ?? r.usuario ?? "—" },
  {
    chave: "perfil",
    titulo: "Perfil",
    valor: (r) => PERFIS.find((p) => p.valor === r.perfil)?.label ?? r.perfil ?? "—",
  },
  { chave: "setor", titulo: "Setor", valor: (r) => r.setor ?? "—" },
  { chave: "tipo", titulo: "Tipo da ação", valor: (r) => tipoAcaoLabel(r.tipo_acao) },
  { chave: "acao", titulo: "Ação", valor: (r) => r.acao },
  { chave: "detalhe", titulo: "Descrição", valor: (r) => r.detalhe ?? "—" },
  {
    chave: "modulo",
    titulo: "Módulo",
    valor: (r) => MODULOS.find((m) => m.id === r.modulo)?.titulo ?? r.modulo ?? "—",
  },
  { chave: "lista", titulo: "Lista", valor: (r) => r.lista ?? "—" },
  { chave: "resultado", titulo: "Resultado", valor: (r) => r.resultado },
];

/** Relatórios: gerador baseado no Histórico Operacional e no Log de Auditoria. */
export function Relatorios() {
  const [fonte, setFonte] = useState("historico");
  const { filtros, set, limpar } = useEstadoFiltros({
    usuario: TODOS,
    setor: TODOS,
    perfil: TODOS,
    modulo: TODOS,
    lista: TODOS,
    status: TODOS,
    de: "",
    ate: "",
  });
  const [limite, setLimite] = useState(PAGINA);
  const { data: usuarios = [] } = useUsuariosFiltro();
  const setoresFiltro = useSetoresFiltro();
  const { data: listas = [] } = useListasFiltro();

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["relatorio", fonte, filtros, limite],
    queryFn: async () => {
      if (fonte === "historico") {
        let q = db.from("historico_conferencias").select("*");
        if (filtros.usuario !== TODOS) q = q.eq("user_id", filtros.usuario);
        if (filtros.setor !== TODOS) q = q.eq("setor", filtros.setor);
        if (filtros.perfil !== TODOS) q = q.eq("perfil", filtros.perfil);
        if (filtros.modulo !== TODOS) q = q.eq("modulo", filtros.modulo);
        if (filtros.lista !== TODOS) q = q.eq("lista", filtros.lista);
        if (filtros.status !== TODOS) q = q.eq("status", filtros.status);
        if (filtros.de) q = q.gte("data", filtros.de);
        if (filtros.ate) q = q.lte("data", filtros.ate);
        const { data, error } = await q
          .order("hora_inicio", { ascending: false })
          .range(0, limite - 1);
        if (error) throw new Error(error.message);
        return (data ?? []) as HistoricoRow[];
      }
      let q = db.from("auditoria").select("*");
      if (filtros.usuario !== TODOS) q = q.eq("user_id", filtros.usuario);
      if (filtros.setor !== TODOS) q = q.eq("setor", filtros.setor);
      if (filtros.perfil !== TODOS) q = q.eq("perfil", filtros.perfil);
      if (filtros.modulo !== TODOS) q = q.eq("modulo", filtros.modulo);
      if (filtros.lista !== TODOS) q = q.eq("lista", filtros.lista);
      if (filtros.status !== TODOS) q = q.eq("tipo_acao", filtros.status);
      if (filtros.de) q = q.gte("created_at", `${filtros.de}T00:00:00`);
      if (filtros.ate) q = q.lte("created_at", `${filtros.ate}T23:59:59`);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .range(0, limite - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditoriaRow[];
    },
  });

  const ehHist = fonte === "historico";
  const colunas = (ehHist ? COLUNAS_HIST : COLUNAS_AUD) as Coluna<unknown>[];
  const linhas = registros as unknown[];

  const meta = useMemo(() => {
    const partes: string[] = [];
    if (filtros.usuario !== TODOS)
      partes.push(`Usuário: ${usuarios.find((u) => u.user_id === filtros.usuario)?.nome ?? "—"}`);
    if (filtros.setor !== TODOS) partes.push(`Setor: ${filtros.setor}`);
    if (filtros.perfil !== TODOS) partes.push(`Perfil: ${filtros.perfil}`);
    if (filtros.modulo !== TODOS)
      partes.push(`Módulo: ${MODULOS.find((m) => m.id === filtros.modulo)?.titulo ?? filtros.modulo}`);
    if (filtros.lista !== TODOS) partes.push(`Lista: ${filtros.lista}`);
    if (filtros.status !== TODOS)
      partes.push(ehHist ? `Status: ${statusLabel(filtros.status)}` : `Tipo: ${tipoAcaoLabel(filtros.status)}`);
    if (filtros.de || filtros.ate)
      partes.push(`Período: ${filtros.de || "início"} a ${filtros.ate || "hoje"}`);
    return {
      titulo: ehHist ? "Relatório do Histórico Operacional" : "Relatório do Log de Auditoria",
      subtitulo: partes.length ? partes.join(" • ") : "Sem filtros aplicados",
      geradoEm: fmtDateTime(new Date().toISOString()),
    };
  }, [filtros, usuarios, ehHist]);

  function exportar(formato: "pdf" | "xlsx" | "csv" | "print") {
    if (!linhas.length) return toast.error("Nenhum registro para exportar");
    if (formato === "pdf") relatorioPDF(colunas, linhas, meta);
    else if (formato === "xlsx") relatorioExcel(colunas, linhas, meta);
    else if (formato === "csv") relatorioCSV(colunas, linhas, meta);
    else if (!relatorioImprimir(colunas, linhas, meta))
      return toast.error("Permita pop-ups para imprimir o relatório");
    registrarAuditoria({
      tipo: "exportacao",
      acao: formato === "print" ? "relatorio_impresso" : `relatorio_${formato}`,
      detalhe: `${meta.titulo} — ${linhas.length} registro(s) — ${meta.subtitulo}`,
    });
    toast.success(formato === "print" ? "Relatório enviado para impressão" : "Relatório exportado");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Fonte de dados</Label>
            <Select
              value={fonte}
              onValueChange={(v) => {
                setFonte(v);
                set("status", TODOS);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTES.map((f) => (
                  <SelectItem key={f.valor} value={f.valor}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CampoSelect
            label="Usuário"
            valor={filtros.usuario}
            onChange={(v) => set("usuario", v)}
            opcoes={usuarios.map((u) => ({ valor: u.user_id, label: u.nome ?? u.user_id.slice(0, 8) }))}
          />
          <CampoSelect
            label="Setor"
            valor={filtros.setor}
            onChange={(v) => set("setor", v)}
            opcoes={setoresFiltro}
          />
          <CampoSelect
            label="Perfil"
            valor={filtros.perfil}
            onChange={(v) => set("perfil", v)}
            opcoes={PERFIS.map((p) => ({ valor: p.valor, label: p.label }))}
          />
          <CampoSelect
            label="Módulo"
            valor={filtros.modulo}
            onChange={(v) => set("modulo", v)}
            opcoes={MODULOS.map((m) => ({ valor: m.id, label: m.titulo }))}
          />
          <CampoSelect
            label="Lista conferida"
            valor={filtros.lista}
            onChange={(v) => set("lista", v)}
            opcoes={listas}
          />
          <CampoSelect
            label={ehHist ? "Status" : "Tipo da ação"}
            valor={filtros.status}
            onChange={(v) => set("status", v)}
            opcoes={
              ehHist
                ? STATUS_HISTORICO.map((s) => ({ valor: s.valor, label: s.label }))
                : TIPOS_ACAO.map((t) => ({ valor: t.valor, label: t.label }))
            }
          />
          <CampoPeriodo
            de={filtros.de}
            ate={filtros.ate}
            onDe={(v) => set("de", v)}
            onAte={(v) => set("ate", v)}
          />
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                limpar();
                setLimite(PAGINA);
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button className="gap-2" onClick={() => exportar("pdf")}>
          <FileText className="size-4" /> PDF
        </Button>
        <Button variant="secondary" className="gap-2" onClick={() => exportar("xlsx")}>
          <FileSpreadsheet className="size-4" /> Excel
        </Button>
        <Button variant="secondary" className="gap-2" onClick={() => exportar("csv")}>
          <FileDown className="size-4" /> CSV
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => exportar("print")}>
          <Printer className="size-4" /> Imprimir
        </Button>
      </div>

      {isLoading ? (
        <Carregando />
      ) : !linhas.length ? (
        <Vazio texto="Nenhum registro encontrado para os filtros selecionados." />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {linhas.length} registro(s) — pré-visualização do relatório
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  {colunas.map((c) => (
                    <th key={c.chave} className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-t">
                    {colunas.map((c) => (
                      <td key={c.chave} className="whitespace-nowrap px-3 py-2">
                        {c.valor(l)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.length >= limite && limite < LIMITE_MAX && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
