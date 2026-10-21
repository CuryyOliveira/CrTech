/**
 * Ambiente de cobrança e rótulos de assinatura usados pelo aplicativo.
 * Enquanto apenas credenciais de teste do provedor estão configuradas, o
 * ambiente é "sandbox" — nenhuma cobrança real é realizada.
 */
export type AmbienteCobranca = "sandbox" | "live";

export function ambienteCobranca(): AmbienteCobranca {
  const configurado = import.meta.env["VITE_COBRANCA_AMBIENTE"] as string | undefined;
  return configurado === "live" ? "live" : "sandbox";
}

export const STATUS_ASSINATURA_LABEL: Record<string, string> = {
  incompleta: "Incompleta",
  trial: "Período de teste",
  ativa: "Ativa",
  pagamento_pendente: "Pagamento pendente",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
  encerrada: "Encerrada",
};

/** Rótulos de resultado do checkout (tratamento visual padronizado). */
export const RESULTADO_CHECKOUT_LABEL = {
  aprovado: "Pagamento aprovado",
  recusado: "Pagamento recusado",
  cancelado: "Checkout cancelado",
  aguardando: "Aguardando confirmação do pagamento",
} as const;
