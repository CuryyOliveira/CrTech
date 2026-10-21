import { useMemo, useState } from "react";
import { Bell, BellRing, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/app";
import { moduloLabel, setorLabel } from "@/lib/gerencial";
import { CATEGORIAS, categoriaInfo, type Categoria } from "@/lib/notificacoes";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import {
  CampoPeriodo,
  CampoSelect,
  Carregando,
  FiltrosPainel,
  PAGINA,
  TODOS,
  Vazio,
  useEstadoFiltros,
  useUsuariosFiltro,
} from "@/components/admin/consulta";
import { MODULOS } from "@/lib/permissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificacoesConferencia } from "@/components/admin/NotificacoesConferencia";
import { WhatsappDestinatarios } from "@/components/admin/WhatsappDestinatarios";

/** Central de Notificações: conferências iniciadas + alertas do histórico e auditoria. */
export function CentralNotificacoes() {
  return (
    <Tabs defaultValue="conferencias">
      <TabsList className="flex w-full flex-wrap">
        <TabsTrigger value="conferencias">Conferências iniciadas</TabsTrigger>
        <TabsTrigger value="alertas">Central de alertas</TabsTrigger>
        <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
      </TabsList>
      <TabsContent value="conferencias" className="pt-4">
        <NotificacoesConferencia />
      </TabsContent>
      <TabsContent value="alertas" className="pt-4">
        <CentralAlertas />
      </TabsContent>
      <TabsContent value="whatsapp" className="pt-4">
        <WhatsappDestinatarios />
      </TabsContent>
    </Tabs>
  );
}

/** Alertas derivados do histórico e da auditoria. */
function CentralAlertas() {

  const { notificacoes, naoLidas, carregando, marcarLidas } = useNotificacoes();
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    categoria: TODOS,
    usuario: TODOS,
    modulo: TODOS,
    situacao: TODOS,
    de: "",
    ate: "",
  });
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(PAGINA);
  const { data: usuarios = [] } = useUsuariosFiltro();

  const nomesUsuarios = useMemo(
    () =>
      usuarios.map((u) => ({ valor: u.nome ?? u.user_id, label: u.nome ?? u.user_id.slice(0, 8) })),
    [usuarios],
  );

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notificacoes.filter((n) => {
      if (filtros.categoria !== TODOS && n.categoria !== filtros.categoria) return false;
      if (filtros.usuario !== TODOS && (n.usuario ?? "") !== filtros.usuario) return false;
      if (filtros.modulo !== TODOS && (n.modulo ?? "") !== filtros.modulo) return false;
      if (filtros.situacao === "nao_lida" && n.lida) return false;
      if (filtros.situacao === "lida" && !n.lida) return false;
      const dia = (n.quando ?? "").slice(0, 10);
      if (filtros.de && dia < filtros.de) return false;
      if (filtros.ate && dia > filtros.ate) return false;
      if (q && !`${n.titulo} ${n.detalhe} ${n.usuario ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [notificacoes, filtros, busca]);

  const contagem = useMemo(
    () =>
      CATEGORIAS.map((c) => ({
        ...c,
        total: notificacoes.filter((n) => n.categoria === c.valor && !n.lida).length,
      })),
    [notificacoes],
  );

  const marcarTodas = async () => {
    const chaves = filtradas.filter((n) => !n.lida).map((n) => n.chave);
    if (!chaves.length) return toast.info("Nenhuma notificação pendente nesta seleção.");
    await marcarLidas(chaves);
    toast.success(`${chaves.length} notificação(ões) marcada(s) como lida(s).`);
  };

  if (carregando) return <Carregando />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {contagem.map((c) => (
          <Card key={c.valor}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">
                {c.emoji} {c.label}
              </p>
              <p className="text-2xl font-bold">{c.total}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar notificação, usuário ou detalhe..."
        onLimpar={() => {
          limpar();
          setBusca("");
        }}
      >
        <CampoSelect
          label="Categoria"
          valor={filtros.categoria}
          onChange={(v) => set("categoria", v)}
          opcoes={CATEGORIAS.map((c) => ({ valor: c.valor, label: `${c.emoji} ${c.label}` }))}
        />
        <CampoSelect
          label="Usuário"
          valor={filtros.usuario}
          onChange={(v) => set("usuario", v)}
          opcoes={nomesUsuarios}
        />
        <CampoSelect
          label="Módulo"
          valor={filtros.modulo}
          onChange={(v) => set("modulo", v)}
          opcoes={[
            ...MODULOS.map((m) => ({ valor: m.id, label: m.titulo })),
            { valor: "ADMIN", label: "Administração" },
          ]}
        />
        <CampoSelect
          label="Situação"
          valor={filtros.situacao}
          onChange={(v) => set("situacao", v)}
          opcoes={[
            { valor: "nao_lida", label: "Não lidas" },
            { valor: "lida", label: "Lidas" },
          ]}
        />
        <CampoPeriodo
          de={filtros.de}
          ate={filtros.ate}
          onDe={(v) => set("de", v)}
          onAte={(v) => set("ate", v)}
        />
      </FiltrosPainel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filtradas.length} notificação(ões) — {naoLidas} não lida(s)
        </p>
        <Button size="sm" variant="outline" onClick={() => void marcarTodas()}>
          <CheckCheck className="mr-1.5 size-4" />
          Marcar todas como lidas
        </Button>
      </div>

      {!filtradas.length ? (
        <Vazio texto="Nenhuma notificação para os filtros selecionados." />
      ) : (
        <ul className="space-y-2">
          {filtradas.slice(0, limite).map((n) => {
            const info = categoriaInfo(n.categoria as Categoria);
            return (
              <li key={n.chave}>
                <Card className={n.lida ? "opacity-70" : ""}>
                  <CardContent className="flex flex-wrap items-start gap-3 p-4">
                    <div className="mt-0.5 text-muted-foreground">
                      {n.lida ? (
                        <Bell className="size-4" />
                      ) : (
                        <BellRing className="size-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-40 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{n.titulo}</p>
                        <Badge className={info.classe}>{info.label}</Badge>
                        {!n.lida && <Badge variant="outline">Nova</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{n.detalhe}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDateTime(n.quando)} · {n.usuario ?? "sistema"} ·{" "}
                        {n.modulo ? moduloLabel(n.modulo) : "—"} · {setorLabel(n.setor)}
                      </p>
                    </div>
                    {!n.lida && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Marcar como lida"
                        onClick={() => void marcarLidas([n.chave])}
                      >
                        <Check className="size-4" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {filtradas.length > limite && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
