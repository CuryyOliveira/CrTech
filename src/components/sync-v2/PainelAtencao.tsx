/**
 * "HÁ ALTERAÇÕES QUE PRECISAM DE ATENÇÃO" — lista os eventos com conflito ou erro e oferece as
 * decisões do motor V2 (nada é sobrescrito sem escolha do usuário; tudo passa por
 * MotorSync.resolver, que registra a decisão).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatarQuantidade } from "@/lib/conferencia-v2/apresentacao";
import type { MotorSync } from "@/lib/sync-v2";
import { MENSAGEM_PAINEL } from "@/lib/sync-v2/motor";
import type { Decisao, ItemFila } from "@/lib/sync-v2/tipos";

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

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function PainelAtencao({
  motor,
  aberto,
  onFechar,
  conferenciaId,
  nomeDoItem,
}: {
  motor: MotorSync;
  aberto: boolean;
  onFechar: () => void;
  /** Mostra só os eventos desta conferência. */
  conferenciaId?: string;
  /** Descrição do item afetado (chave k → texto). */
  nomeDoItem?: (k: string) => string | null;
}) {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    void motor.pendenciasAtencao().then((lista) => {
      setItens(conferenciaId ? lista.filter((f) => f.conference_id === conferenciaId) : lista);
    });
  }, [motor, conferenciaId]);

  useEffect(() => {
    if (!aberto) return;
    recarregar();
    return motor.aoAlterarDados(recarregar);
  }, [aberto, motor, recarregar]);

  async function decidir(f: ItemFila, d: Decisao) {
    setOcupado(f.event_id);
    try {
      await motor.resolver(f.event_id, d);
      if (d !== "usar_servidor") await motor.sincronizarAgora();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
    const restantes = (await motor.pendenciasAtencao()).filter(
      (x) => !conferenciaId || x.conference_id === conferenciaId,
    );
    setItens(restantes);
    if (restantes.length === 0) {
      toast.success("Tudo resolvido.");
      onFechar();
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="bottom" className="cr-alto-contraste max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{MENSAGEM_PAINEL.toUpperCase()}</SheetTitle>
          <SheetDescription>
            Nada foi descartado. Escolha o que fazer com cada alteração — ou continue trabalhando:
            elas ficam guardadas neste aparelho.
          </SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-3" aria-label="Alterações que precisam de atenção">
          {itens.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhuma pendência.</li>
          )}
          {itens.map((f) => {
            const contagem = f.event_type === "ITEM_COUNTED";
            const servidor = (f.resposta?.estado_servidor ?? null) as Record<
              string,
              unknown
            > | null;
            const outroAparelho = f.error_code === "item_alterado_no_servidor";
            const nome = f.alvo_k ? nomeDoItem?.(f.alvo_k) : null;
            return (
              <li
                key={f.event_id}
                className="rounded-lg border p-3 text-sm"
                data-testid="evento-atencao"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                  <span>
                    {NOMES[f.event_type] ?? f.event_type}
                    {nome ? ` — ${nome}` : ""}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">
                    {f.status === "CONFLICT" ? "CONFLITO" : "COM ERRO"}
                  </span>
                </div>
                <p className="mt-1">
                  {outroAparelho
                    ? "Este item também foi alterado em outro dispositivo."
                    : f.error_message}
                </p>
                {contagem && f.status === "CONFLICT" && servidor && (
                  <dl className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-muted/60 p-2 text-center">
                    <div>
                      <dt className="text-xs text-muted-foreground">MINHA CONTAGEM</dt>
                      <dd className="text-xl font-bold tabular-nums" data-testid="minha-contagem">
                        {formatarQuantidade(num(f.payload.quantidade))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">CONTAGEM NO SERVIDOR</dt>
                      <dd
                        className="text-xl font-bold tabular-nums"
                        data-testid="contagem-servidor"
                      >
                        {formatarQuantidade(num(servidor.quantidade_contada))}
                      </dd>
                    </div>
                  </dl>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Feito em {new Date(f.created_at).toLocaleString("pt-BR")}
                </p>
                {detalhe === f.event_id && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                    {JSON.stringify(
                      {
                        codigo: f.error_code,
                        mensagem: f.error_message,
                        tentativas: f.tentativas,
                        servidor,
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}
                <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                  {contagem && f.status === "CONFLICT" && (
                    <Button
                      className="h-11"
                      disabled={ocupado === f.event_id}
                      onClick={() => void decidir(f, "manter_local")}
                    >
                      MANTER MINHA CONTAGEM
                    </Button>
                  )}
                  {f.status === "CONFLICT" && (
                    <Button
                      className="h-11"
                      variant="outline"
                      disabled={ocupado === f.event_id}
                      onClick={() => void decidir(f, "usar_servidor")}
                    >
                      {contagem ? "USAR CONTAGEM DO SERVIDOR" : "USAR A VERSÃO DO SERVIDOR"}
                    </Button>
                  )}
                  <Button
                    className="h-11"
                    variant={f.status === "CONFLICT" ? "secondary" : "default"}
                    disabled={ocupado === f.event_id}
                    onClick={() => void decidir(f, "tentar_novamente")}
                  >
                    TENTAR NOVAMENTE
                  </Button>
                  <Button
                    className="h-11"
                    variant="ghost"
                    aria-expanded={detalhe === f.event_id}
                    onClick={() => setDetalhe(detalhe === f.event_id ? null : f.event_id)}
                  >
                    Ver erro
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <Button className="mt-4 h-12 w-full" variant="secondary" onClick={onFechar}>
          Continuar trabalhando
        </Button>
      </SheetContent>
    </Sheet>
  );
}
