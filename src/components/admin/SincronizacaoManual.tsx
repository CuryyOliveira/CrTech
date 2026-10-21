import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CloudOff, RefreshCw, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/admin/ui-admin";
import { fmtDataHoraLocal } from "@/lib/datas";
import { hidratarOffline } from "@/lib/offline/idb";
import {
  lerConflitos,
  lerFila,
  limparConflitos,
  removerDaFila,
  type Conflito,
  type Operacao,
} from "@/lib/offline/fila";
import { sincronizar } from "@/lib/offline/sync";
import { useOffline } from "@/hooks/useOffline";
import {
  despacharNotificacoesPendentes,
  enviosPendentes,
  type EnvioPendente,
} from "@/lib/offline/notificacoes-pendentes";

const ROTULO_TABELA: Record<string, string> = {
  conferencias: "Conferências",
  conferencia_itens: "Itens conferidos",
  conferencia_pausas: "Pausas",
  historico_conferencias: "Histórico de conferências",
  notificacoes_conferencia: "Notificações",
  materiais: "Materiais",
  material_imagens: "Imagens de materiais",
  unidades: "Frotas e unidades",
  auditoria: "Auditoria",
};

const ROTULO_TIPO: Record<Operacao["tipo"], string> = {
  insert: "Inclusão",
  upsert: "Envio",
  update: "Alteração",
  delete: "Exclusão",
};

function rotulo(tabela: string) {
  return ROTULO_TABELA[tabela] ?? tabela;
}

/**
 * Sincronização manual: mostra o que ainda não chegou ao servidor, permite
 * enviar na hora e lista os conflitos em que a versão do servidor foi
 * preservada (divergências já resolvidas não são sobrepostas).
 */
export function SincronizacaoManual() {
  const offline = useOffline();
  const queryClient = useQueryClient();
  const [fila, setFila] = useState<Operacao[]>([]);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [notificacoes, setNotificacoes] = useState<EnvioPendente[]>([]);

  const recarregar = useCallback(() => {
    setFila(lerFila());
    setConflitos(lerConflitos());
    setNotificacoes(enviosPendentes());
  }, []);

  useEffect(() => {
    void hidratarOffline().then(recarregar);
    const timer = setInterval(recarregar, 5000);
    return () => clearInterval(timer);
  }, [recarregar]);

  async function enviarAgora() {
    if (offline) {
      toast.error("Sem internet agora. As pendências ficam guardadas no aparelho.");
      return;
    }
    setEnviando(true);
    try {
      const r = await sincronizar();
      // Depois de gravar as pendências, envia os e-mails de início/conclusão.
      const enviadosEmail = await despacharNotificacoesPendentes().catch(() => 0);
      recarregar();
      if (enviadosEmail)
        toast.success(`${enviadosEmail} notificação(ões) de conferência enviada(s) por e-mail.`);
      await queryClient.invalidateQueries();
      if (r.enviadas) toast.success(`${r.enviadas} operação(ões) enviada(s) ao servidor.`);
      if (r.conflitos)
        toast.info(`${r.conflitos} alteração(ões) mantiveram a versão do servidor.`);
      if (!r.enviadas && !r.falhas && !r.conflitos) toast.success("Nada pendente para enviar.");
      if (r.falhas) toast.error(`${r.falhas} operação(ões) falharam e serão tentadas novamente.`);
    } catch {
      toast.error("Não foi possível sincronizar agora.");
    } finally {
      setEnviando(false);
    }
  }

  function descartar(op: Operacao) {
    removerDaFila(op.id);
    recarregar();
    toast.success("Operação removida da fila.");
  }

  const comErro = fila.filter((o) => o.status === "erro").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Badge
            variant="outline"
            className={
              offline
                ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            }
          >
            {offline ? <CloudOff className="mr-1 size-3.5" /> : <Wifi className="mr-1 size-3.5" />}
            {offline ? "Sem internet" : "Conectado"}
          </Badge>
          <div className="text-sm">
            <p className="font-semibold tabular-nums">{fila.length} operação(ões) pendente(s)</p>
            <p className="text-xs text-muted-foreground">
              {comErro > 0
                ? `${comErro} com falha — serão reenviadas automaticamente`
                : "Tudo será enviado assim que houver conexão"}
            </p>
            {notificacoes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {notificacoes.length} notificação(ões) de conferência aguardando envio do e-mail
              </p>
            )}
          </div>
          <Button className="ml-auto" onClick={enviarAgora} disabled={enviando || offline}>
            <RefreshCw className={`mr-2 size-4 ${enviando ? "animate-spin" : ""}`} />
            {enviando ? "Enviando…" : "Sincronizar agora"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Operações pendentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fila.length === 0 ? (
            <EstadoVazio
              titulo="Nada pendente"
              descricao="Todas as alterações feitas no aparelho já chegaram ao servidor."
            />
          ) : (
            fila.map((op) => (
              <div
                key={op.id}
                className="flex flex-wrap items-start gap-2 rounded-lg border p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {ROTULO_TIPO[op.tipo]} · {rotulo(op.tabela)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Criada em {fmtDataHoraLocal(op.criado_em)} · {op.tentativas} tentativa(s)
                    {op.proxima_tentativa
                      ? ` · próxima tentativa ${fmtDataHoraLocal(op.proxima_tentativa)}`
                      : ""}
                  </p>
                  {op.ultimo_erro && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {op.ultimo_erro}
                    </p>
                  )}
                </div>
                <Badge variant={op.status === "erro" ? "destructive" : "secondary"}>
                  {op.status === "erro" ? "Com falha" : "Aguardando"}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => descartar(op)}>
                  <Trash2 className="mr-1 size-3.5" /> Descartar
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Conflitos resolvidos</CardTitle>
          {conflitos.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                limparConflitos();
                recarregar();
              }}
            >
              Limpar histórico
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {conflitos.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum conflito registrado"
              descricao="Quando a mesma conferência é alterada no servidor e no aparelho, o registro aparece aqui."
            />
          ) : (
            conflitos.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                <p className="flex items-center gap-1 font-medium">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  {rotulo(c.tabela)}
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    Versão do servidor mantida
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{c.detalhe}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Alteração offline: {fmtDataHoraLocal(c.alterado_offline_em)} · Servidor:{" "}
                  {fmtDataHoraLocal(c.alterado_servidor_em)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
