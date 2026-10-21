/**
 * Finalização: resumo (conferidos, pendentes, divergências, adicionados, eventos aguardando
 * sincronização), assinatura(s) e finalização pelo motor V2 (idempotente).
 *
 * Comportamento seguro com envios pendentes: a finalização é gravada no aparelho junto com a
 * fila; o motor só envia a finalização ao servidor depois que TODAS as alterações anteriores da
 * conferência forem confirmadas. Nada é perdido e nada é aplicado fora de ordem.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/SignaturePad";
import { type Resumo } from "@/lib/conferencia-v2/apresentacao";
import type { MotorSync } from "@/lib/sync-v2";
import type { ConferenciaLocal } from "@/lib/sync-v2/tipos";
import { executar } from "./useConferenciaV2";

export function ConferenceFinish({
  motor,
  conferencia,
  resumo,
  aguardandoSync,
  exigeGestor,
  rotuloResponsavel,
  aberto,
  onFechar,
  onFinalizada,
}: {
  motor: MotorSync;
  conferencia: ConferenciaLocal;
  resumo: Resumo;
  aguardandoSync: number;
  exigeGestor: boolean;
  rotuloResponsavel: string;
  aberto: boolean;
  onFechar: () => void;
  onFinalizada: () => void;
}) {
  const [conferente, setConferente] = useState(conferencia.conferente ?? "");
  const [responsavel, setResponsavel] = useState(conferencia.responsavel ?? "");
  const [observacoes, setObservacoes] = useState("");
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [assinaturaGestor, setAssinaturaGestor] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const jaAssinada = conferencia.tem_assinatura;
  const faltaAssinatura = !jaAssinada && !assinatura;
  const faltaGestor = exigeGestor && !conferencia.tem_assinatura_gestor && !assinaturaGestor;

  async function finalizar() {
    setSalvando(true);
    const ok = await executar(async () => {
      // Assinatura = operação crítica na fila (vale offline). Só grava se ainda não houver.
      if (assinatura && !conferencia.tem_assinatura)
        await motor.assinar(conferencia.id, assinatura);
      if (assinaturaGestor && !conferencia.tem_assinatura_gestor) {
        await motor.assinar(conferencia.id, assinaturaGestor, "gestor");
      }
      await motor.finalizar(conferencia.id, {
        conferente: conferente.trim() || null,
        responsavel: responsavel.trim() || null,
        observacoes: observacoes.trim() || null,
      });
      return true;
    });
    setSalvando(false);
    if (ok) onFinalizada();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="cr-alto-contraste max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Finalizar conferência</DialogTitle>
          <DialogDescription>Confira o resumo antes de assinar.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="resumo-finalizacao">
          {(
            [
              ["Itens conferidos", resumo.feitos],
              ["Pendentes", resumo.pendentes],
              ["Divergências", resumo.divergencias],
              ["Materiais adicionados", resumo.adicionados],
              ["Aguardando sincronização", aguardandoSync],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-md bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">{rotulo}</dt>
              <dd className="text-xl font-bold tabular-nums">{valor}</dd>
            </div>
          ))}
        </dl>

        {resumo.pendentes > 0 && (
          <p className="rounded-md border border-amber-600/50 bg-amber-500/10 p-2 text-sm">
            {resumo.pendentes === 1
              ? "Ainda há 1 item sem contagem. Ele ficará como pendente."
              : `Ainda há ${resumo.pendentes} itens sem contagem. Eles ficarão como pendentes.`}
          </p>
        )}
        {aguardandoSync > 0 && (
          <p
            className="rounded-md border border-primary/40 bg-primary/5 p-2 text-sm"
            data-testid="aviso-pendentes-finalizacao"
          >
            {aguardandoSync === 1
              ? "Existe 1 alteração ainda não sincronizada."
              : `Existem ${aguardandoSync} alterações ainda não sincronizadas.`}{" "}
            Nada será perdido: a finalização fica guardada neste aparelho e será enviada depois
            delas, assim que houver conexão.
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="fim-conferente">Nome do conferente</Label>
            <Input
              id="fim-conferente"
              className="h-11"
              value={conferente}
              onChange={(e) => setConferente(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fim-responsavel">{rotuloResponsavel}</Label>
            <Input
              id="fim-responsavel"
              className="h-11"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fim-obs">Observações finais</Label>
            <Textarea
              id="fim-obs"
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>
          {jaAssinada ? (
            <p className="text-sm text-muted-foreground">Assinatura do conferente já registrada.</p>
          ) : (
            <div data-testid="assinatura-conferente">
              <SignaturePad label="Assinatura do conferente *" onChange={setAssinatura} />
            </div>
          )}
          {exigeGestor &&
            (conferencia.tem_assinatura_gestor ? (
              <p className="text-sm text-muted-foreground">Assinatura do gestor já registrada.</p>
            ) : (
              <div data-testid="assinatura-gestor">
                <SignaturePad
                  label="Assinatura do gestor responsável *"
                  onChange={setAssinaturaGestor}
                />
              </div>
            ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-12" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            className="h-12 font-bold"
            disabled={salvando || faltaAssinatura || faltaGestor}
            onClick={() => void finalizar()}
          >
            ASSINAR E FINALIZAR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
