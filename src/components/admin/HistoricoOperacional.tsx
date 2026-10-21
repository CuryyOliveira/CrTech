import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ListChecks, TriangleAlert, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { db, fmtDate, fmtTime } from "@/lib/app";
import { MODULOS, PERFIS } from "@/lib/permissions";
import { duracaoRegistrada } from "@/lib/gerencial";
import { STATUS_HISTORICO, fmtDuracao, statusLabel, type HistoricoRow } from "@/lib/audit";
import {
  CampoPeriodo,
  CampoSelect,
  Carregando,
  FiltrosPainel,
  PAGINA,
  useSetoresFiltro,
  TODOS,
  Vazio,
  useBuscaLocal,
  useEstadoFiltros,
  useListasFiltro,
  useUsuariosFiltro,
} from "@/components/admin/consulta";


const ORDENS = [
  { valor: "recente", label: "Mais recente" },
  { valor: "antiga", label: "Mais antiga" },
  { valor: "maior_tempo", label: "Maior tempo" },
  { valor: "menor_tempo", label: "Menor tempo" },
  { valor: "divergencias", label: "Maior nº de divergências" },
];



function corStatus(status: string) {
  if (status === "finalizada") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (status === "cancelada") return "bg-destructive text-destructive-foreground";
  if (status === "pausada") return "bg-amber-500 text-white hover:bg-amber-500";
  return "bg-primary text-primary-foreground";
}

/** Histórico Operacional: todas as conferências realizadas, somente consulta. */
export function HistoricoOperacional() {
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    usuario: TODOS,
    setor: TODOS,
    perfil: TODOS,
    modulo: TODOS,
    lista: TODOS,
    status: TODOS,
    de: "",
    ate: "",
  });
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState("recente");
  const [limite, setLimite] = useState(PAGINA);
  const [detalhe, setDetalhe] = useState<HistoricoRow | null>(null);
  const { data: usuarios = [] } = useUsuariosFiltro();
  const SETORES = useSetoresFiltro();
  const { data: listas = [] } = useListasFiltro();

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["historico-operacional", filtros, ordem, limite],
    queryFn: async () => {
      let q = db.from("historico_conferencias").select("*");
      if (filtros.usuario !== TODOS) q = q.eq("user_id", filtros.usuario);
      if (filtros.setor !== TODOS) q = q.eq("setor", filtros.setor);
      if (filtros.perfil !== TODOS) q = q.eq("perfil", filtros.perfil);
      if (filtros.modulo !== TODOS) q = q.eq("modulo", filtros.modulo);
      if (filtros.lista !== TODOS) q = q.eq("lista", filtros.lista);
      if (filtros.status !== TODOS) q = q.eq("status", filtros.status);
      if (filtros.de) q = q.gte("data", filtros.de);
      if (filtros.ate) q = q.lte("data", filtros.ate);


      if (ordem === "recente") q = q.order("hora_inicio", { ascending: false });
      else if (ordem === "antiga") q = q.order("hora_inicio", { ascending: true });
      else if (ordem === "maior_tempo")
        q = q.order("duracao_segundos", { ascending: false, nullsFirst: false });
      else if (ordem === "menor_tempo")
        q = q.order("duracao_segundos", { ascending: true, nullsFirst: false });
      else q = q.order("divergencias", { ascending: false });

      const { data, error } = await q.range(0, limite - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoRow[];
    },
  });

  const lista = useBuscaLocal(registros, busca, (r) => [r.lista, r.nome, r.usuario_email]);

  return (
    <div className="space-y-4">
      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar por lista ou usuário..."
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
        <CampoSelect label="Setor" valor={filtros.setor} onChange={(v) => set("setor", v)} opcoes={SETORES} />
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

          label="Status"
          valor={filtros.status}
          onChange={(v) => set("status", v)}
          opcoes={STATUS_HISTORICO.map((s) => ({ valor: s.valor, label: s.label }))}
        />
        <CampoPeriodo
          de={filtros.de}
          ate={filtros.ate}
          onDe={(v) => set("de", v)}
          onAte={(v) => set("ate", v)}
        />
        <div>
          <Label>Ordenar por</Label>
          <Select value={ordem} onValueChange={setOrdem}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDENS.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FiltrosPainel>

      {isLoading ? (
        <Carregando />
      ) : !lista.length ? (
        <Vazio texto="Nenhuma conferência registrada para os filtros selecionados." />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{lista.length} registro(s) carregado(s)</p>
          <div className="space-y-2">
            {lista.map((r) => (
              <Card
                key={r.id}
                className="cursor-pointer transition-colors hover:border-primary"
                onClick={() => setDetalhe(r)}
              >
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-40 flex-1">
                    <p className="truncate font-semibold">{r.lista ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.modulo_titulo ?? r.modulo} • {r.nome ?? r.usuario_email ?? "—"}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <p>{fmtDate(r.hora_inicio)}</p>
                    <p>
                      {fmtTime(r.hora_inicio)} → {r.hora_fim ? fmtTime(r.hora_fim) : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <Clock className="size-3.5 text-muted-foreground" />
                    {fmtDuracao(duracaoRegistrada(r))}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <ListChecks className="size-3.5 text-muted-foreground" />
                    {Number(r.quantidade_conferida)}/{Number(r.quantidade_prevista)}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <TriangleAlert className="size-3.5 text-muted-foreground" />
                    {Number(r.divergencias)}
                  </div>
                  <Badge className={corStatus(r.status)}>{statusLabel(r.status)}</Badge>
                </CardContent>
              </Card>
            ))}
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

      <Sheet open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detalhe?.lista ?? "Conferência"}</SheetTitle>
            <SheetDescription>{detalhe?.modulo_titulo ?? detalhe?.modulo}</SheetDescription>
          </SheetHeader>
          {detalhe && (
            <div className="space-y-4 p-4 pt-0 text-sm">
              <div className="space-y-1 rounded-lg border p-3">
                <p className="flex items-center gap-1.5 font-semibold">
                  <User className="size-4" /> Usuário responsável
                </p>
                <Linha rotulo="Nome completo" valor={detalhe.nome} />
                <Linha rotulo="E-mail" valor={detalhe.usuario_email} />
                <Linha
                  rotulo="Perfil"
                  valor={PERFIS.find((p) => p.valor === detalhe.perfil)?.label ?? detalhe.perfil}
                />
                <Linha rotulo="Setor" valor={detalhe.setor} />
              </div>

              <div className="space-y-1 rounded-lg border p-3">
                <p className="font-semibold">Conferência</p>
                <Linha rotulo="Data" valor={fmtDate(detalhe.hora_inicio)} />
                <Linha rotulo="Hora de início" valor={fmtTime(detalhe.hora_inicio)} />
                <Linha rotulo="Hora de término" valor={detalhe.hora_fim ? fmtTime(detalhe.hora_fim) : "—"} />
                <Linha rotulo="Tempo trabalhado (líquido)" valor={fmtDuracao(duracaoRegistrada(detalhe))} />
                <Linha
                  rotulo="Quantidade de pausas"
                  valor={String(Number(detalhe.quantidade_pausas ?? 0))}
                />
                <Linha
                  rotulo="Tempo total pausado"
                  valor={fmtDuracao(Number(detalhe.total_tempo_pausado ?? 0))}
                />
                <Linha
                  rotulo="Última pausa"
                  valor={detalhe.ultima_pausa ? fmtTime(detalhe.ultima_pausa) : "—"}
                />
                <Linha
                  rotulo="Última retomada"
                  valor={detalhe.ultima_retomada ? fmtTime(detalhe.ultima_retomada) : "—"}
                />
                <Linha rotulo="Status final" valor={statusLabel(detalhe.status)} />

              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="font-semibold">Itens</p>
                <Linha rotulo="Quantidade prevista" valor={String(Number(detalhe.quantidade_prevista))} />
                <Linha rotulo="Corretos" valor={String(Number(detalhe.quantidade_conferida))} />
                <Linha rotulo="Divergências encontradas" valor={String(Number(detalhe.divergencias))} />
                <div className="flex items-center gap-2 pt-1">
                  <Progress value={Number(detalhe.percentual)} className="h-2" />
                  <span className="font-medium">{Number(detalhe.percentual)}%</span>
                </div>
              </div>

              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                O detalhamento item a item será disponibilizado nas próximas fases.
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{valor || "—"}</span>
    </div>
  );
}
