import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  FileDown,
  KeyRound,
  LogIn,
  Settings,
  ShieldCheck,
  Upload,
  UserCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { db, fmtDate, fmtTime } from "@/lib/app";
import { MODULOS, PERFIS } from "@/lib/permissions";
import { TIPOS_ACAO, tipoAcaoLabel, type AuditoriaRow } from "@/lib/audit";
import {
  CampoPeriodo,
  CampoSelect,
  Carregando,
  FiltrosPainel,
  PAGINA,
  TODOS,
  Vazio,
  useBuscaLocal,
  useEstadoFiltros,
  useUsuariosFiltro,
} from "@/components/admin/consulta";

const SETORES = [
  { valor: "agricola", label: "Agrícola" },
  { valor: "industria", label: "Indústria" },
];

const ICONES: Record<string, typeof LogIn> = {
  autenticacao: LogIn,
  usuarios: UserCog,
  administracao: Settings,
  importacao: Upload,
  operacao: Boxes,
  exportacao: FileDown,
};

function corResultado(r: string) {
  if (r === "erro") return "bg-destructive text-destructive-foreground";
  if (r === "negado") return "bg-amber-500 text-white hover:bg-amber-500";
  return "bg-emerald-600 text-white hover:bg-emerald-600";
}

/** Log de Auditoria: registro somente leitura de todas as ações relevantes. */
export function LogAuditoria() {
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    usuario: TODOS,
    perfil: TODOS,
    setor: TODOS,
    tipo: TODOS,
    modulo: TODOS,
    de: "",
    ate: "",
  });
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState("recente");
  const [limite, setLimite] = useState(PAGINA);
  const { data: usuarios = [] } = useUsuariosFiltro();

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["log-auditoria", filtros, ordem, limite],
    queryFn: async () => {
      let q = db.from("auditoria").select("*");
      if (filtros.usuario !== TODOS) q = q.eq("user_id", filtros.usuario);
      if (filtros.perfil !== TODOS) q = q.eq("perfil", filtros.perfil);
      if (filtros.setor !== TODOS) q = q.eq("setor", filtros.setor);
      if (filtros.tipo !== TODOS) q = q.eq("tipo_acao", filtros.tipo);
      if (filtros.modulo !== TODOS) q = q.eq("modulo", filtros.modulo);
      if (filtros.de) q = q.gte("created_at", `${filtros.de}T00:00:00`);
      if (filtros.ate) q = q.lte("created_at", `${filtros.ate}T23:59:59`);
      const { data, error } = await q
        .order("created_at", { ascending: ordem === "antiga" })
        .range(0, limite - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditoriaRow[];
    },
  });

  const lista = useBuscaLocal(registros, busca, (r) => [r.nome, r.usuario, r.acao, r.detalhe, r.lista]);

  return (
    <div className="space-y-4">
      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar por usuário, ação ou descrição..."
        onLimpar={() => {
          limpar();
          setBusca("");
          setLimite(PAGINA);
        }}
      >
        <CampoSelect
          label="Usuário"
          valor={filtros.usuario}
          onChange={(v) => set("usuario", v)}
          opcoes={usuarios.map((u) => ({ valor: u.user_id, label: u.nome ?? u.user_id.slice(0, 8) }))}
        />
        <CampoSelect
          label="Perfil"
          valor={filtros.perfil}
          onChange={(v) => set("perfil", v)}
          opcoes={PERFIS.map((p) => ({ valor: p.valor, label: p.label }))}
        />
        <CampoSelect label="Setor" valor={filtros.setor} onChange={(v) => set("setor", v)} opcoes={SETORES} />
        <CampoSelect
          label="Tipo da ação"
          valor={filtros.tipo}
          onChange={(v) => set("tipo", v)}
          opcoes={TIPOS_ACAO.map((t) => ({ valor: t.valor, label: t.label }))}
        />
        <CampoSelect
          label="Módulo"
          valor={filtros.modulo}
          onChange={(v) => set("modulo", v)}
          opcoes={MODULOS.map((m) => ({ valor: m.id, label: m.titulo }))}
        />
        <CampoPeriodo
          de={filtros.de}
          ate={filtros.ate}
          onDe={(v) => set("de", v)}
          onAte={(v) => set("ate", v)}
        />
        <div>
          <Label>Ordem cronológica</Label>
          <Select value={ordem} onValueChange={setOrdem}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recente">Mais recente</SelectItem>
              <SelectItem value="antiga">Mais antiga</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosPainel>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        Registro somente leitura — nenhum evento pode ser editado ou excluído.
      </div>

      {isLoading ? (
        <Carregando />
      ) : !lista.length ? (
        <Vazio texto="Nenhum evento encontrado para os filtros selecionados." />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{lista.length} evento(s) carregado(s)</p>
          <div className="space-y-2">
            {lista.map((r) => {
              const Icone = ICONES[r.tipo_acao] ?? KeyRound;
              const modulo = MODULOS.find((m) => m.id === r.modulo)?.titulo ?? r.modulo;
              return (
                <Card key={r.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icone className="size-4" />
                    </div>
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-semibold">{r.acao}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.detalhe ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.nome ?? r.usuario ?? "—"}
                        {r.perfil ? ` • ${PERFIS.find((p) => p.valor === r.perfil)?.label ?? r.perfil}` : ""}
                        {r.setor ? ` • ${r.setor}` : ""}
                        {modulo ? ` • ${modulo}` : ""}
                        {r.lista ? ` • ${r.lista}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{tipoAcaoLabel(r.tipo_acao)}</Badge>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{fmtDate(r.created_at)}</p>
                      <p>{fmtTime(r.created_at)}</p>
                    </div>
                    <Badge className={corResultado(r.resultado)}>{r.resultado}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {registros.length >= limite && (
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
