import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
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
import { db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { ACOES, sessaoOnline, type CadastroRow } from "@/lib/cadastros";
import { EstadoVazio, MenuExportar, SkeletonLista } from "@/components/admin/ui-admin";
import type { Coluna } from "@/lib/relatorios";

type Fonte =
  | "usuarios"
  | "permissoes"
  | "perfis"
  | "setores"
  | "cadastros"
  | "logs"
  | "configuracoes"
  | "conferencias";

const FONTES: { valor: Fonte; label: string }[] = [
  { valor: "usuarios", label: "Usuários" },
  { valor: "permissoes", label: "Permissões" },
  { valor: "perfis", label: "Perfis" },
  { valor: "setores", label: "Setores" },
  { valor: "cadastros", label: "Cadastros" },
  { valor: "logs", label: "Logs de auditoria" },
  { valor: "configuracoes", label: "Configurações" },
  { valor: "conferencias", label: "Conferências" },
];

/** Relatórios administrativos exportáveis em PDF, Excel e CSV. */
export function RelatoriosAdministrativos() {
  const [fonte, setFonte] = useState<Fonte>("usuarios");

  const { data, isLoading } = useQuery({
    queryKey: ["relatorio-admin", fonte],
    queryFn: () => carregar(fonte),
  });

  const linhas = (data ?? []) as Record<string, unknown>[];
  const colunas = useMemo(() => COLUNAS[fonte], [fonte]);
  const titulo = `Relatório administrativo — ${FONTES.find((f) => f.valor === fonte)?.label}`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px]">
            <Label>Relatório</Label>
            <Select value={fonte} onValueChange={(v) => setFonte(v as Fonte)}>
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
          <MenuExportar
            titulo={titulo}
            subtitulo={`${linhas.length} registro(s)`}
            colunas={colunas as Coluna<Record<string, unknown>>[]}
            linhas={linhas}
            onExportado={(f) =>
              void registrarAuditoria({
                tipo: "exportacao",
                acao: "relatorio_administrativo_exportado",
                detalhe: `${titulo} em ${f.toUpperCase()}`,
                modulo: "ADMIN",
              })
            }
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <SkeletonLista />
      ) : !linhas.length ? (
        <EstadoVazio
          titulo="Nenhum dado disponível"
          descricao="Este relatório ainda não possui registros."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  {colunas.map((c) => (
                    <th key={c.chave} className="p-2 text-left font-medium">
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 100).map((l, i) => (
                  <tr key={i} className="border-t">
                    {colunas.map((c) => (
                      <td key={c.chave} className="p-2 align-top">
                        {(c as Coluna<Record<string, unknown>>).valor(l) || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {linhas.length > 100 && (
              <p className="p-3 text-center text-xs text-muted-foreground">
                Pré-visualização dos 100 primeiros de {linhas.length} registro(s). A exportação
                inclui todos.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileBarChart className="size-3.5" /> Todos os relatórios podem ser exportados em PDF, Excel
        (.xlsx), CSV ou impressos.
      </p>
    </div>
  );
}

const texto = (v: unknown) => (v == null ? "" : String(v));

const COLUNAS: Record<Fonte, Coluna<any>[]> = {
  usuarios: [
    { chave: "nome", titulo: "Nome", valor: (r) => texto(r.nome) },
    { chave: "perfil", titulo: "Perfil", valor: (r) => texto(r.perfil) },
    { chave: "setor", titulo: "Setor", valor: (r) => texto(r.setor) },
    { chave: "bloqueado", titulo: "Bloqueado", valor: (r) => (r.bloqueado ? "Sim" : "Não") },
    { chave: "ultimo_acesso", titulo: "Último acesso", valor: (r) => fmtDateTime(r.ultimo_acesso) },
    { chave: "status", titulo: "Status", valor: (r) => (r.online ? "Online" : "Offline") },
    { chave: "created_at", titulo: "Cadastrado em", valor: (r) => fmtDateTime(r.created_at) },
  ],
  permissoes: [
    { chave: "perfil", titulo: "Perfil", valor: (r) => texto(r.perfil) },
    { chave: "modulo", titulo: "Módulo", valor: (r) => texto(r.modulo) },
    ...ACOES.map((a) => ({
      chave: a.valor,
      titulo: a.label,
      valor: (r: any) => ((r.acoes ?? []).includes(a.valor) ? "Sim" : "Não"),
    })),
    { chave: "updated_at", titulo: "Última alteração", valor: (r) => fmtDateTime(r.updated_at) },
  ],
  perfis: cadastroColunas(),
  setores: cadastroColunas(),
  cadastros: [{ chave: "tipo", titulo: "Tipo", valor: (r) => texto(r.tipo) }, ...cadastroColunas()],
  logs: [
    { chave: "created_at", titulo: "Data/hora", valor: (r) => fmtDateTime(r.created_at) },
    { chave: "nome", titulo: "Usuário", valor: (r) => texto(r.nome ?? r.usuario) },
    { chave: "perfil", titulo: "Perfil", valor: (r) => texto(r.perfil) },
    { chave: "tipo_acao", titulo: "Tipo", valor: (r) => texto(r.tipo_acao) },
    { chave: "acao", titulo: "Ação", valor: (r) => texto(r.acao) },
    { chave: "modulo", titulo: "Módulo", valor: (r) => texto(r.modulo) },
    { chave: "detalhe", titulo: "Descrição", valor: (r) => texto(r.detalhe) },
    { chave: "ip", titulo: "IP", valor: (r) => texto(r.ip) },
    { chave: "dispositivo", titulo: "Dispositivo", valor: (r) => texto(r.dispositivo) },
    { chave: "resultado", titulo: "Resultado", valor: (r) => texto(r.resultado) },
  ],
  configuracoes: [
    { chave: "chave", titulo: "Configuração", valor: (r) => texto(r.chave) },
    { chave: "valor", titulo: "Valor", valor: (r) => JSON.stringify(r.valor) },
    { chave: "updated_at", titulo: "Última alteração", valor: (r) => fmtDateTime(r.updated_at) },
  ],
  conferencias: [
    { chave: "data", titulo: "Data", valor: (r) => fmtDateTime(r.hora_inicio) },
    { chave: "nome", titulo: "Usuário", valor: (r) => texto(r.nome ?? r.usuario_email) },
    { chave: "modulo_titulo", titulo: "Módulo", valor: (r) => texto(r.modulo_titulo ?? r.modulo) },
    { chave: "lista", titulo: "Lista", valor: (r) => texto(r.lista) },
    { chave: "prevista", titulo: "Prevista", valor: (r) => texto(r.quantidade_prevista) },
    { chave: "conferida", titulo: "Corretos", valor: (r) => texto(r.quantidade_conferida) },
    { chave: "divergencias", titulo: "Divergências", valor: (r) => texto(r.divergencias) },
    { chave: "status", titulo: "Status", valor: (r) => texto(r.status) },
  ],
};

function cadastroColunas(): Coluna<CadastroRow>[] {
  return [
    { chave: "codigo", titulo: "Código", valor: (r) => r.codigo },
    { chave: "nome", titulo: "Nome", valor: (r) => r.nome },
    { chave: "descricao", titulo: "Descrição", valor: (r) => r.descricao ?? "" },
    {
      chave: "situacao",
      titulo: "Situação",
      valor: (r) => (r.excluido ? "Excluído" : r.ativo ? "Ativo" : "Inativo"),
    },
    { chave: "created_at", titulo: "Criado em", valor: (r) => fmtDateTime(r.created_at) },
    { chave: "updated_at", titulo: "Alterado em", valor: (r) => fmtDateTime(r.updated_at) },
  ];
}

async function carregar(fonte: Fonte) {
  if (fonte === "usuarios") {
    const [{ data: perfis }, { data: sessoes }] = await Promise.all([
      db.from("user_profiles").select("*").order("nome"),
      db
        .from("sessoes_usuario")
        .select("user_id,ultimo_ping,encerrada_em")
        .is("encerrada_em", null),
    ]);
    const ativos = new Set(
      ((sessoes ?? []) as any[]).filter((s) => sessaoOnline(s)).map((s) => s.user_id as string),
    );
    return ((perfis ?? []) as any[]).map((p) => ({ ...p, online: ativos.has(p.user_id) }));
  }
  if (fonte === "permissoes") {
    const { data } = await db.from("permissoes_perfil").select("*").order("perfil");
    return data ?? [];
  }
  if (fonte === "perfis" || fonte === "setores") {
    const { data } = await db
      .from("cadastros_mestres")
      .select("*")
      .eq("tipo", fonte === "perfis" ? "perfil" : "setor")
      .order("ordem");
    return data ?? [];
  }
  if (fonte === "cadastros") {
    const { data } = await db.from("cadastros_mestres").select("*").order("tipo").order("ordem");
    return data ?? [];
  }
  if (fonte === "logs") {
    const { data } = await db
      .from("auditoria")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 4999);
    return data ?? [];
  }
  if (fonte === "configuracoes") {
    const { data } = await db.from("configuracoes_sistema").select("*").order("chave");
    return data ?? [];
  }
  const { data } = await db
    .from("historico_conferencias")
    .select("*")
    .order("hora_inicio", { ascending: false })
    .range(0, 4999);
  return data ?? [];
}
