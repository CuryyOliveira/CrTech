/**
 * Feedback visual das operações salvas sem internet.
 * Um único aviso por rajada de gravações, para não poluir a tela.
 */
import { toast } from "sonner";

let ultimo = 0;

export function avisarSalvoOffline() {
  const agora = Date.now();
  if (agora - ultimo < 4000) return;
  ultimo = agora;
  toast.success("Salvo offline. Será sincronizado quando a conexão retornar.");
}

export function avisarSincronizado(quantidade: number) {
  toast.success(
    quantidade === 1
      ? "Sincronizado com sucesso: 1 operação enviada."
      : `Sincronizado com sucesso: ${quantidade} operações enviadas.`,
  );
}
