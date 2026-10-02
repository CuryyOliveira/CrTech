/** Apoio aos testes do motor de sincronização: aparelho simulado (IndexedDB falso + relógio). */
import { randomUUID } from "node:crypto";
import "fake-indexeddb/auto"; // IDBKeyRange global (o navegador já tem)
import { IDBFactory } from "fake-indexeddb";
import { MotorSync, type OpcoesMotor } from "@/lib/sync-v2/motor";
import type { Ator, Banco } from "./ambiente";
import { TransportePg } from "./transporte-pg";

export type Aparelho = {
  motor: MotorSync;
  transporte: TransportePg;
  fabrica: IDBFactory;
  relogio: { agora: Date; avancar(min: number): void };
  deviceId: string;
  reabrir(): Promise<MotorSync>;
};

export async function aparelho(
  db: Banco,
  ator: Ator & { id?: string },
  opcoes: {
    fabrica?: IDBFactory;
    inicio?: Date;
    deviceId?: string;
    empresaId?: string | null;
  } & OpcoesMotor = {},
): Promise<Aparelho> {
  const fabrica = opcoes.fabrica ?? new IDBFactory();
  const transporte = new TransportePg(db, ator);
  const relogio = {
    agora: opcoes.inicio ?? new Date(),
    avancar(min: number) {
      this.agora = new Date(this.agora.getTime() + min * 60_000);
    },
  };
  const deviceId = opcoes.deviceId ?? `aparelho-${randomUUID().slice(0, 8)}`;
  const abrir = () =>
    MotorSync.abrir(
      { userId: ator.id!, empresaId: opcoes.empresaId ?? null, deviceId },
      transporte,
      {
        fabrica,
        agora: () => relogio.agora,
        online: () => !transporte.falhas.offline,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        ...opcoes,
      },
    );
  const ap: Aparelho = {
    motor: await abrir(),
    transporte,
    fabrica,
    relogio,
    deviceId,
    async reabrir() {
      ap.motor = await abrir();
      return ap.motor;
    },
  };
  return ap;
}

/** Sincroniza até não haver mais nada a fazer (o watermark do servidor pode atrasar a entrega). */
export async function sincronizarTudo(motor: MotorSync, condicao?: () => Promise<boolean>) {
  let r = await motor.sincronizarAgora();
  for (let i = 0; i < 100; i++) {
    if (!condicao || (await condicao())) return r;
    await new Promise((ok) => setTimeout(ok, 20));
    r = await motor.sincronizarAgora();
  }
  return r;
}
