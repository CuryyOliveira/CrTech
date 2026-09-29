/**
 * Indicador global de sincronização (V2): ONLINE / OFFLINE / SINCRONIZANDO / ERRO, com
 * progresso, botão "SINCRONIZAR AGORA" e o painel de itens que precisam de atenção.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { empresaMemorizada } from "@/lib/offline/contexto";
import {
  aoTrocarMotor,
  encerrarMotor,
  motorDoUsuario,
  MotorSync,
  RESUMO_VAZIO,
  type ResumoSync,
} from "@/lib/sync-v2";
import { MENSAGEM_CONCLUIDA, MENSAGEM_PAINEL } from "@/lib/sync-v2/motor";
import type { ItemFila } from "@/lib/sync-v2/tipos";

export function useMotorSync() {
  const [motor, setMotor] = useState<MotorSync | null>(null);
  const [resumo, setResumo] = useState<ResumoSync>(RESUMO_VAZIO);
  useEffect(() => aoTrocarMotor(setMotor), []);
  useEffect(() => {
    if (!motor) return setResumo(RESUMO_VAZIO);
    return motor.observar(setResumo);
  }, [motor]);
  return { motor, resumo };
}

const ESTILO = {
  ONLINE: {
    icone: Wifi,
    texto: "Online",
    classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  OFFLINE: {
    icone: CloudOff,
    texto: "Offline",
    classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  SYNCING: {
    icone: RefreshCw,
    texto: "Sincronizando",
    classe: "bg-primary/15 text-primary border-primary/30",
  },
  ERROR: {
    icone: AlertTriangle,
    texto: "Atenção",
    classe: "bg-destructive/15 text-destructive border-destructive/30",
  },
} as const;

const NOMES: Record<string, string> = {
  CONFERENCE_CREATED: "Início da conferência",
  ITEM_COUNTED: "Contagem de item",
  MATERIAL_ADDED: "Material incluído",
  CONFERENCE_PAUSED: "Pausa",
  CONFERENCE_RESUMED: "Retomada",
  SIGNATURE_ADDED: "Assinatura",
  CONFERENCE_FINALIZED: "Finalização",
  CONFERENCE_CANCELLED: "Cancelamento",
  PHOTO_ADDED: "Foto",
};

export function IndicadorSync() {
  const { motor, resumo } = useMotorSync();
  const [aberto, setAberto] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  if (!motor) return null;
  const e = ESTILO[resumo.estado];
  const Icone = e.icone;
  const atencao = resumo.atencao + resumo.conflitos;
  const pct =
    resumo.progresso && resumo.progresso.total > 0
      ? Math.min(100, Math.round((resumo.progresso.feitos / resumo.progresso.total) * 100))
      : null;

  async function sincronizarAgora() {
    if (!motor) return;
    setSincronizando(true);
    try {
      const r = await motor.sincronizarAgora();
      if (r.mensagem === MENSAGEM_CONCLUIDA) toast.success(r.mensagem);
      else toast.warning(r.mensagem);
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <>
      <div
        className={`fixed right-3 top-3 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${e.classe}`}
        aria-live="polite"
      >
        <Icone className={`size-3.5 ${resumo.estado === "SYNCING" ? "animate-spin" : ""}`} />
        <span>{e.texto}</span>
        {pct !== null && <span className="tabular-nums">{pct}%</span>}
        {resumo.pendentes > 0 && (
          <span className="tabular-nums">· {resumo.pendentes} pendente(s)</span>
        )}
        {atencao > 0 && (
          <button type="button" className="underline" onClick={() => setAberto(true)}>
            {atencao} com atenção
          </button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={sincronizando || resumo.estado === "SYNCING"}
          onClick={() => void sincronizarAgora()}
        >
          SINCRONIZAR AGORA
        </Button>
      </div>
      <PainelAtencao motor={motor} aberto={aberto} onFechar={() => setAberto(false)} />
    </>
  );
}

/** "Há alterações que precisam de atenção." — tentar novamente / ver erro / decidir. */
export function PainelAtencao({
  motor,
  aberto,
  onFechar,
}: {
  motor: MotorSync;
  aberto: boolean;
  onFechar: () => void;
}) {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const recarregar = () => void motor.pendenciasAtencao().then(setItens);
  useEffect(() => {
    if (aberto) recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, motor]);

  async function decidir(f: ItemFila, d: "tentar_novamente" | "manter_local" | "usar_servidor") {
    try {
      await motor.resolver(f.event_id, d);
      if (d !== "usar_servidor") await motor.sincronizarAgora();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    recarregar();
  }

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{MENSAGEM_PAINEL}</SheetTitle>
          <SheetDescription>
            Nada foi descartado. Escolha o que fazer com cada alteração — ou continue trabalhando:
            elas ficam guardadas neste aparelho.
          </SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-3">
          {itens.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhuma pendência.</li>
          )}
          {itens.map((f) => (
            <li key={f.event_id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2 font-medium">
                <span>{NOMES[f.event_type] ?? f.event_type}</span>
                <span className="text-xs text-muted-foreground">
                  {f.status === "CONFLICT" ? "Conflito" : "Precisa de atenção"} ·{" "}
                  {new Date(f.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{f.error_message}</p>
              {detalhe === f.event_id && (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(
                    {
                      codigo: f.error_code,
                      tentativas: f.tentativas,
                      servidor: f.resposta?.estado_servidor ?? null,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void decidir(f, "tentar_novamente")}>
                  Tentar novamente
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDetalhe(detalhe === f.event_id ? null : f.event_id)}
                >
                  Ver erro
                </Button>
                {f.status === "CONFLICT" && f.event_type === "ITEM_COUNTED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void decidir(f, "manter_local")}
                  >
                    Manter minha contagem
                  </Button>
                )}
                {f.status === "CONFLICT" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void decidir(f, "usar_servidor")}
                  >
                    Usar a versão do servidor
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <Button className="mt-4 w-full" variant="secondary" onClick={onFechar}>
          Continuar trabalhando
        </Button>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Liga o motor V2 à sessão: abre o banco local do usuário ao entrar e fecha ao sair
 * (apagando o banco só se não houver pendências). Só é montado com VITE_SYNC_V2=1.
 */
export function SyncV2() {
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "SIGNED_OUT") {
        void encerrarMotor({ apagarDados: true });
        return;
      }
      if (sessao?.user)
        void motorDoUsuario(sessao.user.id, empresaMemorizada()).catch(() => undefined);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return <IndicadorSync />;
}
