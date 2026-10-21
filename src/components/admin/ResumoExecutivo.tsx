import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, Bell, ShieldCheck, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { db, fmtDateTime } from "@/lib/app";
import { fmtDuracao, statusLabel, type AuditoriaRow, type HistoricoRow } from "@/lib/audit";
import { avaliarMeta, escopoLabel, moduloLabel, type MetaRow, duracaoRegistrada } from "@/lib/gerencial";
import { categoriaInfo } from "@/lib/notificacoes";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { useConferenciasAoVivo } from "@/hooks/useConferenciasAoVivo";
import { MonitorTempoReal } from "@/components/admin/MonitorTempoReal";



function Indicador({
  titulo,
  valor,
  icone: Icone,
}: {
  titulo: string;
  valor: number | string;
  icone: typeof Bell;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icone className="size-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{titulo}</p>
          <p className="text-xl font-bold">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Bloco({
  titulo,
  atalho,
  para,
  children,
}: {
  titulo: string;
  atalho: string;
  para: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">{titulo}</CardTitle>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/admin/$secao" params={{ secao: para }}>
            {atalho}
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 text-sm">{children}</CardContent>
    </Card>
  );
}

/** Resumo executivo da Central Administrativa — apenas widgets e atalhos. */
export function ResumoExecutivo() {
  const { notificacoes, naoLidas } = useNotificacoes();
  const { ativas } = useConferenciasAoVivo();
  const qc = useQueryClient();


  const { data: historico = [] } = useQuery({
    queryKey: ["resumo-historico"],
    refetchInterval: 30000,
    staleTime: 0,

    queryFn: async () => {
      const { data, error } = await db
        .from("historico_conferencias")
        .select("*")
        .order("hora_inicio", { ascending: false })
        .range(0, 999);
      if (error) throw new Error(error.message);
      return (data ?? []) as HistoricoRow[];
    },
  });

  const { data: auditoria = [] } = useQuery({
    queryKey: ["resumo-auditoria"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await db
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, 9);
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditoriaRow[];
    },
  });

  const { data: metas = [] } = useQuery({
    queryKey: ["resumo-metas"],
    queryFn: async () => {
      const { data, error } = await db.from("metas").select("*").eq("ativo", true);
      if (error) throw new Error(error.message);
      return (data ?? []) as MetaRow[];
    },
  });
  // Atualização em tempo real: qualquer mudança de status remove/insere o card na hora.
  useEffect(() => {
    const canal = supabase
      .channel("resumo-executivo-historico")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "historico_conferencias" },
        () => void qc.invalidateQueries({ queryKey: ["resumo-historico"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);

  // Fonte única: as conferências oficiais (mesma usada na tela da conferência).
  const emAndamento = ativas.filter((c) => c.status === "em_andamento");


  const concluidas = historico.filter((r) => r.status === "finalizada").slice(0, 5);
  const fora = useMemo(
    () =>
      metas
        .map((m) => ({ meta: m, av: avaliarMeta(m, historico) }))
        .filter((x) => x.av.situacao === "abaixo" || x.av.situacao === "atencao")
        .slice(0, 5),
    [metas, historico],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Contagens em andamento" valor={emAndamento.length} icone={Activity} />
        <Indicador titulo="Alertas pendentes" valor={naoLidas} icone={Bell} />
        <Indicador titulo="Metas fora do esperado" valor={fora.length} icone={Target} />
        <Indicador titulo="Conferências concluídas" valor={concluidas.length} icone={ShieldCheck} />
      </div>

      <MonitorTempoReal />



      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Últimas notificações" atalho="Abrir central" para="notificacoes">
          {notificacoes.slice(0, 5).length ? (
            notificacoes.slice(0, 5).map((n) => (
              <div
                key={n.chave}
                className="flex items-start justify-between gap-2 border-b pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">{n.titulo}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(n.quando)}</p>
                </div>
                <Badge className={categoriaInfo(n.categoria).classe}>
                  {categoriaInfo(n.categoria).label}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Sem notificações.</p>
          )}
        </Bloco>

        <Bloco titulo="Metas fora do esperado" atalho="Ver metas" para="metas">
          {fora.length ? (
            fora.map(({ meta, av }) => (
              <div
                key={meta.id}
                className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
              >
                <p className="font-medium">
                  {escopoLabel(meta.escopo)} — {meta.alvo_nome ?? meta.alvo}
                </p>
                <Badge variant="outline">{av.atingido}%</Badge>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Todas as metas dentro do esperado.</p>
          )}
        </Bloco>

        <Bloco titulo="Últimos registros da auditoria" atalho="Ver auditoria" para="auditoria">
          {auditoria.length ? (
            auditoria.slice(0, 5).map((a) => (
              <div key={a.id} className="border-b pb-2 last:border-0">
                <p className="font-medium">{a.detalhe ?? a.acao}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(a.created_at)} · {a.nome ?? a.usuario ?? "sistema"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Sem registros.</p>
          )}
        </Bloco>

        <Bloco
          titulo="Últimas conferências concluídas"
          atalho="Ver histórico"
          para="historico-operacional"
        >
          {concluidas.length ? (
            concluidas.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">
                    {moduloLabel(h.modulo)} — {h.lista ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(h.hora_fim ?? h.hora_inicio)} · {fmtDuracao(duracaoRegistrada(h))}
                  </p>
                </div>
                <Badge variant="outline">{statusLabel(h.status)}</Badge>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Sem conferências concluídas.</p>
          )}
        </Bloco>
      </div>
    </div>
  );
}
