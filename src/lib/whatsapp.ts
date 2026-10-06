/**
 * FASE 0 — Preparação das notificações por WhatsApp.
 *
 * Este módulo NÃO envia mensagens e NÃO conversa com nenhum serviço externo.
 * Ele apenas concentra: normalização/validação de telefone, máscara para
 * registro, tipos dos eventos internos e a chave idempotente que a futura
 * integração usará para nunca enviar a mesma notificação duas vezes.
 */

export const MAX_DESTINATARIOS_WHATSAPP = 5;

export type EventoWhatsapp = "CONFERENCIA_INICIADA" | "CONFERENCIA_CONCLUIDA";

export type DestinatarioWhatsapp = {
  id: string;
  empresa_id: string;
  nome: string;
  telefone: string;
  telefone_normalizado: string;
  ativo: boolean;
  receber_inicio_conferencia: boolean;
  receber_conclusao_conferencia: boolean;
  created_at: string;
  updated_at: string;
};

/** Remove tudo que não é dígito. */
export function soDigitos(valor?: string | null) {
  return (valor ?? "").replace(/\D+/g, "");
}

/**
 * Normaliza para o padrão internacional brasileiro (55 + DDD + número),
 * aceitando `+55 17 99999-9999`, `(17) 99999-9999`, `17999999999` etc.
 * Retorna `null` quando o número não é válido.
 */
export function normalizarTelefone(valor?: string | null): string | null {
  let d = soDigitos(valor);
  if (!d) return null;
  // 00 55 ... (discagem internacional escrita à mão)
  if (d.startsWith("00")) d = d.slice(2);
  // Sem código do país: 10 (fixo) ou 11 (celular) dígitos com DDD.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55")) return null;
  const resto = d.slice(2);
  if (resto.length !== 10 && resto.length !== 11) return null;
  const ddd = Number(resto.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  const numero = resto.slice(2);
  // Celular tem 9 dígitos e começa com 9; fixo tem 8 e começa entre 2 e 5.
  if (numero.length === 9 && numero[0] !== "9") return null;
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;
  return `55${resto}`;
}

/** Mensagem de erro amigável para o telefone informado (ou `null` se válido). */
export function erroTelefone(valor?: string | null): string | null {
  if (!soDigitos(valor)) return "Informe o número do WhatsApp.";
  if (!normalizarTelefone(valor)) return "Número inválido. Use DDD + número, ex.: (17) 99999-9999.";
  return null;
}

/** Exibição amigável: +55 (17) 99999-9999. */
export function formatarTelefone(normalizado?: string | null) {
  const d = soDigitos(normalizado);
  if (d.length < 12) return normalizado ?? "—";
  const ddd = d.slice(2, 4);
  const n = d.slice(4);
  const meio = n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}` : `${n.slice(0, 4)}-${n.slice(4)}`;
  return `+55 (${ddd}) ${meio}`;
}

/** Máscara usada nos registros/logs: nunca guardamos o número completo no log. */
export function mascararTelefone(normalizado?: string | null) {
  const d = soDigitos(normalizado);
  if (d.length < 6) return "•••";
  return `+${d.slice(0, 4)}•••••${d.slice(-2)}`;
}

/**
 * Chave idempotente do evento:
 * empresa + conferência + tipo de evento + destinatário.
 */
export function chaveIdempotente(
  empresaId: string,
  conferenciaId: string,
  evento: EventoWhatsapp,
  destinatarioId: string,
) {
  return `${empresaId}_${conferenciaId}_${evento}_${destinatarioId}`;
}

/** Dados comuns a qualquer evento de conferência. */
export type BaseEventoConferencia = {
  empresaId: string | null;
  empresaNome: string | null;
  moduloId: string | null;
  moduloTitulo: string | null;
  unidadeId: string | null;
  unidadeNome: string | null;
  conferenciaId: string;
  conferente: string | null;
  matricula: string | null;
  local: string | null;
  tipo: string | null;
  dataHora: string;
};

export type EventoConferenciaIniciada = BaseEventoConferencia & {
  evento: "CONFERENCIA_INICIADA";
};

export type EventoConferenciaConcluida = BaseEventoConferencia & {
  evento: "CONFERENCIA_CONCLUIDA";
  inicio: string | null;
  fim: string | null;
  duracao: string | null;
  duracaoSegundos: number | null;
  itens: number | null;
  corretos: number | null;
  divergencias: number | null;
  faltantes: number | null;
  sobras: number | null;
  precisao: number | null;
};

/**
 * Monta o evento interno de início. NÃO envia nada: apenas devolve o pacote de
 * dados que o futuro template da Meta consumirá.
 */
export function eventoConferenciaIniciada(
  base: Omit<BaseEventoConferencia, "dataHora"> & { dataHora?: string },
): EventoConferenciaIniciada {
  return {
    evento: "CONFERENCIA_INICIADA",
    ...base,
    dataHora: base.dataHora ?? new Date().toISOString(),
  };
}

/** Monta o evento interno de conclusão (também sem qualquer envio). */
export function eventoConferenciaConcluida(
  dados: Omit<EventoConferenciaConcluida, "evento" | "dataHora"> & { dataHora?: string },
): EventoConferenciaConcluida {
  return {
    evento: "CONFERENCIA_CONCLUIDA",
    ...dados,
    dataHora: dados.dataHora ?? new Date().toISOString(),
  };
}

/** Destinatários que, no futuro, receberiam o evento informado. */
export function destinatariosDoEvento(
  lista: DestinatarioWhatsapp[],
  evento: EventoWhatsapp,
): DestinatarioWhatsapp[] {
  return lista.filter(
    (d) =>
      d.ativo &&
      (evento === "CONFERENCIA_INICIADA"
        ? d.receber_inicio_conferencia
        : d.receber_conclusao_conferencia),
  );
}
