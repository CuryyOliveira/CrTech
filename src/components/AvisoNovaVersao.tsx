/**
 * Aviso "Nova versão disponível" do aplicativo Android.
 *
 * Fica na tela inicial (menu), fora da tela de conferência, e só verifica/mostra quando é seguro:
 * sem envio/sincronização em andamento, sem pendências, conflito ou atenção, e com internet.
 * Telas que montam o aviso junto de uma operação crítica passam `emOperacao`.
 * Nunca baixa nem instala nada: "Atualizar agora" abre a página oficial no navegador.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RESUMO_VAZIO, type MotorSync, type ResumoSync } from "@/lib/sync-v2";
import { useMotorSync } from "@/lib/sync-v2/react";
import {
  abrirPaginaOficial,
  adiarAviso,
  appInstalado,
  verificarAtualizacao,
  type Ambiente,
  type Atualizacao,
} from "@/lib/atualizacao-app/cliente";

/** Momento seguro para avisar: nada crítico acontecendo no motor de sincronização. */
export function momentoSeguro(resumo: ResumoSync, temMotor: boolean) {
  if (!temMotor) return true;
  return (
    resumo.estado === "ONLINE" &&
    resumo.pendentes === 0 &&
    resumo.conflitos === 0 &&
    resumo.atencao === 0
  );
}

export function AvisoNovaVersao({
  motor: motorProp,
  ambiente,
  emOperacao = false,
}: {
  motor?: MotorSync | null;
  ambiente?: Ambiente;
  /** Conferência/contagem/finalização aberta na tela: nunca mostra. */
  emOperacao?: boolean;
}) {
  const global = useMotorSync();
  const motor = motorProp !== undefined ? motorProp : global.motor;
  const [resumo, setResumo] = useState<ResumoSync>(RESUMO_VAZIO);
  const [aviso, setAviso] = useState<Atualizacao | null>(null);

  useEffect(() => {
    if (!motor) {
      setResumo(RESUMO_VAZIO);
      return;
    }
    return motor.observar(setResumo);
  }, [motor]);

  const seguro = !emOperacao && momentoSeguro(resumo, !!motor);

  useEffect(() => {
    if (!seguro || aviso || !appInstalado(ambiente?.janela)) return;
    let vivo = true;
    void verificarAtualizacao(ambiente).then((r) => vivo && r && setAviso(r));
    return () => {
      vivo = false;
    };
  }, [seguro, aviso, ambiente]);

  const aberto = !!aviso && seguro;
  if (!aviso) return null;

  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(abrir) => {
        // Fechar (Esc/voltar) vale como "Depois": nada de aviso insistente.
        if (abrir) return;
        adiarAviso(ambiente);
        setAviso(null);
      }}
    >
      <AlertDialogContent
        data-testid="aviso-nova-versao"
        className="max-w-[calc(100vw-2rem)] sm:max-w-md"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Nova versão disponível</AlertDialogTitle>
          <AlertDialogDescription className="space-y-1">
            <span className="block">
              Você está usando a versão <strong>{aviso.app.instalada.versionName}</strong>
              {aviso.app.identificado ? "" : " (ou anterior)"}.
            </span>
            <span className="block">
              A versão <strong>{aviso.remota.versionName}</strong> está disponível.
            </span>
            <span className="block text-xs">
              A página oficial do aplicativo será aberta no navegador. Nada é baixado
              automaticamente.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel
            className="h-12"
            onClick={() => {
              adiarAviso(ambiente);
              setAviso(null);
            }}
          >
            DEPOIS
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-12"
            onClick={() => {
              abrirPaginaOficial(aviso.remota.versionName, ambiente);
              // Ao voltar do navegador, não pergunta de novo na mesma hora.
              adiarAviso(ambiente);
              setAviso(null);
            }}
          >
            ATUALIZAR AGORA
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
