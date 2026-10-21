import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  Mail,
  PlayCircle,
  RefreshCw,
  Trash2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { db, fmtDateTime } from "@/lib/app";
import { moduloLabel } from "@/lib/gerencial";
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
import {
  conteudoNotificacao,
  EMAIL_STATUS,
  emailStatusClasse,
  emailStatusLabel,
  fmtDataBR,
  envioLiberado,
  gravidadeClasse,
  resumoNotificacao,
  TIPOS_NOTIFICACAO,
  tipoInfo,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";
import {
  enviarEmailNotificacao,
  enviarEmailTeste,
  reenviarEmailsFalhados,
} from "@/lib/notificacoes-conferencia.functions";
import { useConfigEmails, useNotificacoesConferencia } from "@/hooks/useNotificacoesConferencia";

function Indicador({ titulo, valor, ajuda }: { titulo: string; valor: string; ajuda?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="truncate text-xl font-bold">{valor}</p>
        {ajuda && <p className="truncate text-xs text-muted-foreground">{ajuda}</p>}
      </CardContent>
    </Card>
  );
}

function IconeTipo({ tipo }: { tipo: string }) {
  const cls = "mt-0.5 size-4";
  if (tipo === "conferencia_concluida")
    return <CheckCircle2 className={`${cls} text-emerald-600`} />;
  if (tipo === "divergencia_estoque")
    return <AlertTriangle className={`${cls} text-destructive`} />;
  if (tipo === "erro_conferencia") return <Bug className={`${cls} text-destructive`} />;
  if (tipo === "conferencia_atrasada") return <Clock className={`${cls} text-yellow-600`} />;
  return <PlayCircle className={`${cls} text-primary`} />;
}

function resumoCurto(n: NotificacaoConferenciaRow | null) {
  if (!n) return "—";
  return `${n.frota ?? n.local ?? "sem frota"} · ${n.usuario_nome ?? "—"}`;
}

/** Dashboard de notificações de conferência, em tempo real. */
export function NotificacoesConferencia() {
  const { notificacoes, emails, indicadores: ind, carregando, recarregar } =
    useNotificacoesConferencia();
  const { data: config } = useConfigEmails();
  const [limite, setLimite] = useState(PAGINA);
  const [aberta, setAberta] = useState<NotificacaoConferenciaRow | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    tipo: TODOS,
    usuario: TODOS,
    frota: TODOS,
    email: TODOS,
    de: "",
    ate: "",
  });
  const [busca, setBusca] = useState("");
  const { data: usuarios = [] } = useUsuariosFiltro();

  const frotas = useMemo(
    () =>
      Array.from(new Set(notificacoes.map((n) => n.frota).filter(Boolean) as string[])).map(
        (f) => ({
          valor: f,
          label: f,
        }),
      ),
    [notificacoes],
  );

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notificacoes.filter((n) => {
      if (filtros.tipo !== TODOS && n.tipo !== filtros.tipo) return false;
      if (filtros.usuario !== TODOS && (n.usuario_nome ?? "") !== filtros.usuario) return false;
      if (filtros.frota !== TODOS && (n.frota ?? "") !== filtros.frota) return false;
      if (filtros.email !== TODOS && (n.email_status ?? "pendente") !== filtros.email) return false;
      if (filtros.de && n.data < filtros.de) return false;
      if (filtros.ate && n.data > filtros.ate) return false;
      if (
        q &&
        !`${n.usuario_nome ?? ""} ${n.frota ?? ""} ${n.local ?? ""} ${n.matricula ?? ""} ${n.conferencia_id ?? ""} ${resumoNotificacao(n)}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [notificacoes, filtros, busca]);

  if (carregando) return <Carregando />;

  const semServidor = !config || !envioLiberado(config);

  const acao = async (fn: () => Promise<string>) => {
    setOcupado(true);
    try {
      toast.success(await fn());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na operação");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Indicador titulo="Iniciadas hoje" valor={String(ind.iniciadasHoje)} />
        <Indicador titulo="Concluídas hoje" valor={String(ind.concluidasHoje)} />
        <Indicador titulo="Em andamento" valor={String(ind.emAndamento)} />
        <Indicador titulo="Atrasadas" valor={String(ind.atrasadas)} />
        <Indicador titulo="Tempo médio" valor={ind.tempoMedio} />
        <Indicador titulo="Divergências" valor={String(ind.divergencias)} />
        <Indicador titulo="Erros" valor={String(ind.erros)} />
        <Indicador
          titulo="Último e-mail enviado"
          valor={ind.ultimoEmail ? fmtDateTime(ind.ultimoEmail.enviado_em) : "—"}
          ajuda={ind.ultimoEmail?.destinatario ?? "—"}
        />
        <Indicador
          titulo="Última conferência concluída"
          valor={ind.ultimaConcluida ? fmtDateTime(ind.ultimaConcluida.created_at) : "—"}
          ajuda={resumoCurto(ind.ultimaConcluida)}
        />
        <Indicador
          titulo="Último erro registrado"
          valor={ind.ultimoErro ? fmtDateTime(ind.ultimoErro.created_at) : "—"}
          ajuda={ind.ultimoErro ? resumoNotificacao(ind.ultimoErro) : "—"}
        />
      </div>

      {semServidor && (
        <Card className="border-yellow-500/60">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 text-yellow-600" />
            <p className="text-sm text-muted-foreground">
              Os disparos reais estão bloqueados até a conclusão do assistente de configuração do
              servidor de envio (domínio/DNS, remetente, destinatários e teste de conexão) em{" "}
              <strong>Administração do Sistema → Notificações</strong>. As notificações continuam
              sendo registradas normalmente.
            </p>
          </CardContent>
        </Card>
      )}

      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar usuário, frota, local ou ID da conferência..."
        onLimpar={() => {
          limpar();
          setBusca("");
        }}
      >
        <CampoSelect
          label="Evento"
          valor={filtros.tipo}
          onChange={(v) => set("tipo", v)}
          opcoes={TIPOS_NOTIFICACAO.map((t) => ({ valor: t.valor, label: t.label }))}
        />
        <CampoSelect
          label="Usuário"
          valor={filtros.usuario}
          onChange={(v) => set("usuario", v)}
          opcoes={usuarios.map((u) => ({
            valor: u.nome ?? u.user_id,
            label: u.nome ?? u.user_id.slice(0, 8),
          }))}
        />
        <CampoSelect
          label="Frota"
          valor={filtros.frota}
          onChange={(v) => set("frota", v)}
          opcoes={frotas}
        />
        <CampoSelect
          label="Status do e-mail"
          valor={filtros.email}
          onChange={(v) => set("email", v)}
          opcoes={EMAIL_STATUS}
        />
        <CampoPeriodo
          de={filtros.de}
          ate={filtros.ate}
          onDe={(v) => set("de", v)}
          onAte={(v) => set("ate", v)}
        />
      </FiltrosPainel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{filtradas.length} notificação(ões)</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              void acao(async () => {
                const r = await reenviarEmailsFalhados();
                return `${r.enviadas} de ${r.total} notificação(ões) reenviada(s).`;
              })
            }
          >
            <RefreshCw className="mr-1.5 size-4" />
            Reenviar falhas
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() =>
              void acao(async () => {
                const r = await enviarEmailTeste({ data: {} });
                if (!r.ok) throw new Error(r.erro ?? "Falha no envio de teste");
                return "E-mail de teste enviado.";
              })
            }
          >
            <Send className="mr-1.5 size-4" />
            Enviar e-mail de teste
          </Button>
        </div>
      </div>

      {!filtradas.length ? (
        <Vazio texto="Nenhuma notificação para os filtros selecionados." />
      ) : (
        <ul className="space-y-2">
          {filtradas.slice(0, limite).map((n) => {
            const info = tipoInfo(n.tipo);
            const critica = n.gravidade === "critica";
            return (
              <li key={n.id}>
                <Card className={critica ? "border-destructive/60" : ""}>
                  <CardContent className="flex flex-wrap items-start gap-3 p-4">
                    <IconeTipo tipo={n.tipo} />
                    <div className="min-w-40 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`font-semibold ${critica ? "text-destructive" : ""}`}>
                          {info.label}
                        </p>
                        <Badge className={gravidadeClasse(n.gravidade)}>{n.status}</Badge>
                        <Badge className={emailStatusClasse(n.email_status)}>
                          <Mail className="mr-1 size-3" />
                          {emailStatusLabel(n.email_status)}
                        </Badge>
                      </div>
                      <p
                        className={`text-sm ${critica ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {resumoNotificacao(n)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.usuario_nome ?? "—"} · Frota: {n.frota ?? "—"} · {fmtDataBR(n.data)} às{" "}
                        {n.hora ?? "—"} · {n.modulo ? moduloLabel(n.modulo) : "—"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setAberta(n)}>
                        Detalhes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Reenviar notificação"
                        disabled={ocupado}
                        onClick={() =>
                          void acao(async () => {
                            const r = await enviarEmailNotificacao({
                              data: { notificacaoId: n.id, reenvio: true },
                            });
                            if (!r.ok) throw new Error(r.erro ?? "Falha no reenvio");
                            return "Notificação reenviada.";
                          })
                        }
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Excluir notificação do histórico"
                        disabled={ocupado}
                        onClick={() =>
                          void acao(async () => {
                            const { error } = await db
                              .from("notificacoes_conferencia")
                              .delete()
                              .eq("id", n.id);
                            if (error) throw new Error(error.message);
                            recarregar();
                            return "Notificação excluída do histórico.";
                          })
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
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

      <Sheet open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {aberta && (
            <Detalhes n={aberta} envios={emails.filter((e) => e.notificacao_id === aberta.id)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Detalhes({
  n,
  envios,
}: {
  n: NotificacaoConferenciaRow;
  envios: {
    id: string;
    destinatario: string;
    status: string;
    erro: string | null;
    enviado_em: string;
    tentativa: number;
  }[];
}) {
  const c = conteudoNotificacao(n);
  return (
    <>
      <SheetHeader>
        <SheetTitle>{c.titulo}</SheetTitle>
      </SheetHeader>
      <div className="space-y-4 py-4">
        <p className="text-sm text-muted-foreground">{c.intro}</p>
        <dl className="grid gap-2 text-sm">
          {c.linhas.map((l) => (
            <div key={l.rotulo} className="grid grid-cols-[10rem_1fr] gap-2">
              <dt className="text-muted-foreground">{l.rotulo}</dt>
              <dd className="whitespace-pre-wrap break-words font-medium">{l.valor}</dd>
            </div>
          ))}
        </dl>

        {!!c.divergencias.length && (
          <div className="space-y-2">
            <p className="font-semibold text-destructive">Divergências ({c.divergencias.length})</p>
            <ul className="space-y-1 text-sm">
              {c.divergencias.map((d, i) => (
                <li key={`${d.codigo}-${i}`} className="rounded border border-destructive/40 p-2">
                  <p className="font-medium">
                    {d.codigo ?? "—"} — {d.descricao ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Esperada: {d.esperada ?? "—"} · Encontrada: {d.encontrada ?? "—"} · Diferença:{" "}
                    {d.encontrada != null && d.esperada != null
                      ? Number(d.encontrada) - Number(d.esperada)
                      : "—"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <p className="font-semibold">Tentativas de envio</p>
          {!envios.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma tentativa registrada.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {envios.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <Badge className={emailStatusClasse(e.status)}>
                    {emailStatusLabel(e.status)}
                  </Badge>
                  <span>{e.destinatario}</span>
                  <span className="text-xs text-muted-foreground">
                    tentativa {e.tentativa} · {fmtDateTime(e.enviado_em)}
                  </span>
                  {e.erro && <span className="text-xs text-destructive">{e.erro}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
