/** V2.1 — ajustes de servidor usados pela tela nova. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Banco, usuario } from "./ambiente";
import { ASSINATURA, enviar, evento } from "./eventos";
import { LISTA, U } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
  await db.dono(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.A],
  );
});
afterAll(async () => {
  await db?.remover();
});

const ESTQ_A = usuario(U.ESTQ_A);

it("material incluído fora do cadastro guarda a localização informada", async () => {
  const conf = randomUUID();
  const item = randomUUID();
  const r = await enviar(db, ESTQ_A, [
    evento("CONFERENCE_CREATED", conf, { unidade_id: LISTA.A }),
    evento("MATERIAL_ADDED", conf, {
      item_id: item,
      codigo: "FORA-1",
      descricao: "Fora do cadastro",
      quantidade: 2,
      motivo: "Encontrado",
      locacao: "  Corredor 07 · Prateleira C  ",
    }),
  ]);
  expect(r.map((x) => x.status)).toEqual(["aplicado", "aplicado"]);
  const [i] = await db.dono("SELECT locacao, origem FROM conferencia_itens WHERE id = $1", [item]);
  expect(i).toEqual({ locacao: "Corredor 07 · Prateleira C", origem: "adicionado" });
});

it("ao finalizar, o Histórico Operacional recebe os totais calculados no servidor", async () => {
  await db.dono(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.A],
  );
  const conf = randomUUID();
  await enviar(db, ESTQ_A, [evento("CONFERENCE_CREATED", conf, { unidade_id: LISTA.A })]);
  const itens = await db.dono<{ material_id: string; quantidade_esperada: string }>(
    "SELECT material_id, quantidade_esperada FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conf],
  );
  const r = await enviar(db, ESTQ_A, [
    evento("ITEM_COUNTED", conf, {
      material_id: itens[0].material_id,
      quantidade: Number(itens[0].quantidade_esperada),
      versao_base: 0,
    }),
    evento("ITEM_COUNTED", conf, {
      material_id: itens[1].material_id,
      quantidade: 999,
      versao_base: 0,
    }),
    evento("SIGNATURE_ADDED", conf, { tipo: "conferente", imagem: ASSINATURA }),
    evento("CONFERENCE_FINALIZED", conf, {}),
  ]);
  expect(r.every((x) => x.status === "aplicado")).toBe(true);
  const [h] = await db.dono(
    "SELECT status, quantidade_prevista, quantidade_conferida, divergencias, percentual FROM historico_conferencias WHERE conferencia_id = $1",
    [conf],
  );
  expect(h).toMatchObject({ status: "finalizada" });
  expect(Number(h.quantidade_prevista)).toBe(itens.length);
  expect(Number(h.quantidade_conferida)).toBe(1);
  expect(Number(h.divergencias)).toBe(1);
  expect(Number(h.percentual)).toBe(Math.round(100 / itens.length));
});

it("carga inicial: itens só de conferências abertas ou encerradas há menos de 24 h", async () => {
  // Fixture: 0000…03a1 finalizada há 2 h (itens vêm); aqui ela passa a ter terminado há 3 dias.
  const antiga = "00000000-0000-4000-8000-0000000003a1";
  const itens = async () =>
    (
      await db.como(
        ESTQ_A,
        async (q) => (await q("SELECT snapshot_sync('conferencia_itens', null, 1000) AS r"))[0].r,
      )
    ).linhas.map((l: { conferencia_id: string }) => l.conferencia_id) as string[];
  expect(await itens()).toContain(antiga);
  await db.dono(
    "UPDATE conferencias SET hora_inicio = now() - interval '3 days 1 hour', hora_fim = now() - interval '3 days' WHERE id = $1",
    [antiga],
  );
  expect(await itens()).not.toContain(antiga);
  // O cabeçalho continua (janela de 30 dias) e a conferência aberta traz os itens.
  const confs = (
    await db.como(
      ESTQ_A,
      async (q) => (await q("SELECT snapshot_sync('conferencias', null, 1000) AS r"))[0].r,
    )
  ).linhas.map((l: { id: string }) => l.id) as string[];
  expect(confs).toContain(antiga);
  const aberta = randomUUID();
  await enviar(db, ESTQ_A, [evento("CONFERENCE_CREATED", aberta, { unidade_id: LISTA.A })]);
  expect(await itens()).toContain(aberta);
});
