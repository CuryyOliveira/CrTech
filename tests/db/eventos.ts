/** Utilitários para montar e enviar eventos de conferência nos testes de banco. */
import { randomUUID } from "node:crypto";
import type { Banco, Ator } from "./ambiente";

export type Evento = {
  event_id: string;
  conference_id: string;
  device_id: string;
  event_type: string;
  created_at_device: string;
  schema_version: 1;
  payload: Record<string, unknown>;
};

export function evento(
  tipo: string,
  conferencia: string,
  payload: Record<string, unknown> = {},
  opcoes: { quando?: Date | string; dispositivo?: string; id?: string } = {},
): Evento {
  const quando = opcoes.quando ?? new Date();
  return {
    event_id: opcoes.id ?? randomUUID(),
    conference_id: conferencia,
    device_id: opcoes.dispositivo ?? "aparelho-teste",
    event_type: tipo,
    created_at_device: typeof quando === "string" ? quando : quando.toISOString(),
    schema_version: 1,
    payload,
  };
}

export type Resultado = Record<string, unknown> & {
  status: string;
  duplicado?: boolean;
  erro_codigo?: string;
};

/** Envia um lote como o aparelho faria (uma requisição = uma transação confirmada). */
export async function enviar(db: Banco, ator: Ator, eventos: Evento[]): Promise<Resultado[]> {
  return db.como(
    ator,
    async (q) => {
      const [r] = await q<{ r: Resultado[] }>("SELECT processar_eventos_conferencia($1) AS r", [
        JSON.stringify(eventos),
      ]);
      return r.r;
    },
    { gravar: true },
  );
}

export const minutos = (base: Date, m: number) => new Date(base.getTime() + m * 60_000);
export const ASSINATURA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
