/**
 * Fila local de notificações (início e conclusão de conferência) que foram
 * registradas sem internet.
 *
 * Offline a notificação é gravada normalmente no cache local e enfileirada para
 * o banco de dados (ver `src/lib/offline/db.ts`), mas o e-mail com o relatório
 * não pode ser enviado. Guardamos aqui os identificadores pendentes: quando a
 * conexão volta, a sincronização envia primeiro as pendências ao banco e depois
 * dispara os e-mails/relatórios correspondentes.
 */
import { gravarLocal, lerLocal } from "./idb";
import { agoraLocalISO } from "@/lib/datas";

const CHAVE = "cr:notificacoes-envio";

export type EnvioPendente = {
  notificacaoId: string;
  tipo: string;
  conferenciaId: string | null;
  criado_em: string;
  tentativas: number;
};

export function enviosPendentes(): EnvioPendente[] {
  return lerLocal<EnvioPendente[]>(CHAVE, []);
}

export function registrarEnvioPendente(
  notificacaoId: string,
  tipo: string,
  conferenciaId: string | null,
) {
  const fila = enviosPendentes();
  if (fila.some((e) => e.notificacaoId === notificacaoId)) return;
  fila.push({ notificacaoId, tipo, conferenciaId, criado_em: agoraLocalISO(), tentativas: 0 });
  gravarLocal(CHAVE, fila);
}

export function removerEnvioPendente(notificacaoId: string) {
  gravarLocal(
    CHAVE,
    enviosPendentes().filter((e) => e.notificacaoId !== notificacaoId),
  );
}

function marcarTentativa(notificacaoId: string) {
  gravarLocal(
    CHAVE,
    enviosPendentes().map((e) =>
      e.notificacaoId === notificacaoId ? { ...e, tentativas: e.tentativas + 1 } : e,
    ),
  );
}

const MAX_TENTATIVAS = 8;

/**
 * Envia os e-mails das notificações registradas offline. Deve ser chamada
 * SOMENTE depois de sincronizar a fila de operações (a notificação precisa
 * existir no banco de dados).
 */
export async function despacharNotificacoesPendentes(): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  const fila = enviosPendentes();
  if (!fila.length) return 0;
  const { enviarEmailNotificacao } = await import("@/lib/notificacoes-conferencia.functions");
  const { dispararWhatsappNotificacao } = await import("@/lib/whatsapp.functions");
  let enviados = 0;
  for (const item of fila) {
    try {
      await enviarEmailNotificacao({ data: { notificacaoId: item.notificacaoId } });
      // WhatsApp dos eventos de início e conclusão (idempotente no servidor).
      if (item.tipo === "conferencia_iniciada" || item.tipo === "conferencia_concluida") {
        await dispararWhatsappNotificacao({
          data: { notificacaoId: item.notificacaoId },
        }).catch(() => undefined);
      }
      removerEnvioPendente(item.notificacaoId);
      enviados++;
    } catch {
      marcarTentativa(item.notificacaoId);
      const atual = enviosPendentes().find((e) => e.notificacaoId === item.notificacaoId);
      // Falha definitiva (notificação inexistente/sem permissão): não trava a fila.
      if ((atual?.tentativas ?? 0) >= MAX_TENTATIVAS) removerEnvioPendente(item.notificacaoId);
    }
  }
  return enviados;
}
