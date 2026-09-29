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

it("carga inicial: itens só de conferências abertas (encerradas trazem só o cabeçalho)", async () => {
  const encerrada = "00000000-0000-4000-8000-0000000003a1"; // finalizada há 2 h (fixture)
  const snapshot = async (tabela: string) =>
    (
      await db.como(
        ESTQ_A,
        async (q) => (await q("SELECT snapshot_sync($1, null, 1000) AS r", [tabela]))[0].r,
      )
    ).linhas as { id: string; conferencia_id?: string }[];
  expect((await snapshot("conferencia_itens")).map((l) => l.conferencia_id)).not.toContain(
    encerrada,
  );
  expect((await snapshot("conferencias")).map((l) => l.id)).toContain(encerrada);
  const aberta = randomUUID();
  await enviar(db, ESTQ_A, [evento("CONFERENCE_CREATED", aberta, { unidade_id: LISTA.A })]);
  expect((await snapshot("conferencia_itens")).map((l) => l.conferencia_id)).toContain(aberta);
});

it("totais do histórico: usuário de outra empresa não recalcula conferência alheia", async () => {
  const conf = "00000000-0000-4000-8000-0000000003a1"; // Empresa A
  await db.dono(
    "UPDATE historico_conferencias SET quantidade_prevista = 999 WHERE conferencia_id = $1",
    [conf],
  );
  await db.como(
    usuario(U.ESTQ_B),
    async (q) => {
      await q("SELECT app_private.atualizar_totais_historico($1)", [conf]);
    },
    { gravar: true },
  );
  const [h] = await db.dono<{ p: string }>(
    "SELECT quantidade_prevista::text AS p FROM historico_conferencias WHERE conferencia_id = $1",
    [conf],
  );
  expect(h.p).toBe("999");
  await db.como(
    ESTQ_A,
    async (q) => {
      await q("SELECT app_private.atualizar_totais_historico($1)", [conf]);
    },
    { gravar: true },
  );
  const [h2] = await db.dono<{ p: string }>(
    "SELECT quantidade_prevista::text AS p FROM historico_conferencias WHERE conferencia_id = $1",
    [conf],
  );
  expect(h2.p).not.toBe("999");
});

it("carga inicial e pull de 1.000 itens ficam bem abaixo do statement_timeout (8 s)", async () => {
  await db.dono(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.A],
  );
  // Histórico com várias conferências (o custo por linha crescia com ele).
  for (let i = 0; i < 40; i++) {
    await db.dono(
      "INSERT INTO conferencias (unidade_id, status, hora_inicio, hora_fim) VALUES ($1, 'cancelada', now() - interval '1 day', now() - interval '1 day')",
      [LISTA.A],
    );
  }
  await db.dono(
    `INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada)
     SELECT $1, 'PERF-' || g, 'Material ' || g, 1 FROM generate_series(1, 1000) g`,
    [LISTA.A],
  );
  const conf = randomUUID();
  const [cursor] = await db.como(ESTQ_A, async (q) => q("SELECT cursor_sync_inicial() AS c"));
  await enviar(db, ESTQ_A, [evento("CONFERENCE_CREATED", conf, { unidade_id: LISTA.A })]);
  const medir = (sql: string, params: unknown[]) =>
    db.como(ESTQ_A, async (q) => {
      await q("SET LOCAL statement_timeout = '8s'");
      const t = Date.now();
      const [r] = await q(sql, params);
      return { ms: Date.now() - t, r: r.r };
    });
  const snap = await medir("SELECT snapshot_sync('conferencia_itens', null, 500) AS r", []);
  expect(snap.r.linhas).toHaveLength(500);
  expect(snap.ms).toBeLessThan(2000);
  const pull = await medir("SELECT alteracoes_sync($1, 500) AS r", [cursor.c]);
  expect(pull.r.alteracoes.length).toBeGreaterThan(0);
  expect(pull.ms).toBeLessThan(2000);
});
