/**
 * Idempotência das operações críticas (fundação para a fila offline da V2):
 * repetir a mesma operação — mesmo id gerado no aparelho — nunca duplica nada.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Banco, usuario } from "./ambiente";
import { CONF, LISTA, MATERIAL, U, novoId } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const ESTQ_A = usuario(U.ESTQ_A);
const ESTQ_B = usuario(U.ESTQ_B);
const VISU_A = usuario(U.VISU_A);

type Res = Record<string, unknown>;
const rpc = async (ator = ESTQ_A, sql: string, params: unknown[]) => {
  const r = await db.tentar<{ r: Res }>(ator, `SELECT ${sql} AS r`, params, { gravar: true });
  if (!r.ok) throw Object.assign(new Error(r.erro.message), { code: r.erro.code });
  return r.linhas[0].r;
};

describe("iniciar_conferencia", () => {
  it("cria conferência + itens + histórico numa única operação", async () => {
    const id = novoId();
    const r = await rpc(ESTQ_A, "iniciar_conferencia($1, $2, $3)", [
      id,
      LISTA.A,
      { conferente: "Ana" },
    ]);
    expect(r).toMatchObject({ conferencia_id: id, criada: true, itens: 3 });
    const [c] = await db.dono(
      "SELECT status, conferente, created_by FROM conferencias WHERE id = $1",
      [id],
    );
    expect(c).toMatchObject({ status: "em_andamento", conferente: "Ana", created_by: U.ESTQ_A });
    const hist = await db.dono(
      "SELECT quantidade_prevista FROM historico_conferencias WHERE conferencia_id = $1",
      [id],
    );
    expect(Number(hist[0].quantidade_prevista)).toBe(3);
  });

  it("repetir com o MESMO id não cria outra conferência (resposta perdida / duplo clique)", async () => {
    const [aberta] = await db.dono(
      "SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'",
      [LISTA.A],
    );
    const r = await rpc(ESTQ_A, "iniciar_conferencia($1, $2)", [aberta.id, LISTA.A]);
    expect(r.repetida).toBe(true);
    const n = await db.dono("SELECT count(*)::int n FROM conferencias WHERE unidade_id = $1", [
      LISTA.A,
    ]);
    expect(n[0].n).toBe(3); // finalizada + cancelada (fixtures) + a aberta
    const itens = await db.dono(
      "SELECT count(*)::int n FROM conferencia_itens WHERE conferencia_id = $1",
      [aberta.id],
    );
    expect(itens[0].n).toBe(3);
  });

  it("id diferente com conferência já aberta na lista: reaproveita a existente", async () => {
    const [aberta] = await db.dono(
      "SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'",
      [LISTA.A],
    );
    const r = await rpc(ESTQ_A, "iniciar_conferencia($1, $2)", [novoId(), LISTA.A]);
    expect(r).toMatchObject({ conferencia_id: aberta.id, criada: false, reaproveitada: true });
  });

  it("dois aparelhos iniciando ao mesmo tempo: fica uma só conferência", async () => {
    const lista = LISTA.A_MOD;
    const [id1, id2] = [novoId(), novoId()];
    const c1 = await db.conectar();
    const c2 = await db.conectar();
    try {
      for (const c of [c1, c2]) {
        await c.query("BEGIN");
        await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: U.ESTQ_A, role: "authenticated" }),
        ]);
        await c.query("SET LOCAL ROLE authenticated");
      }
      const r1 = (await c1.query("SELECT iniciar_conferencia($1, $2) AS r", [id1, lista])).rows[0]
        .r;
      const p2 = c2.query("SELECT iniciar_conferencia($1, $2) AS r", [id2, lista]);
      await c1.query("COMMIT");
      const r2 = (await p2).rows[0].r;
      await c2.query("COMMIT");
      expect(r1).toMatchObject({ conferencia_id: id1, criada: true });
      expect(r2).toMatchObject({ conferencia_id: id1, criada: false, reaproveitada: true });
      const n = await db.dono("SELECT count(*)::int n FROM conferencias WHERE unidade_id = $1", [
        lista,
      ]);
      expect(n[0].n).toBe(1);
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it("recusa lista sem materiais, lista de outra empresa e usuário sem permissão", async () => {
    await expect(
      rpc(ESTQ_A, "iniciar_conferencia($1, $2)", [novoId(), LISTA.A_VAZIA]),
    ).rejects.toMatchObject({ code: "CR011" });
    await expect(
      rpc(ESTQ_B, "iniciar_conferencia($1, $2)", [novoId(), LISTA.A2]),
    ).rejects.toThrow();
    await expect(
      rpc(VISU_A, "iniciar_conferencia($1, $2)", [novoId(), LISTA.A_VAZIA]),
    ).rejects.toThrow();
  });
});

describe("adicionar_item_conferencia", () => {
  it("inclui material adicional uma única vez, mesmo repetindo a chamada", async () => {
    const item = novoId();
    const dados = {
      codigo: "EXTRA-1",
      descricao: "Encontrado na prateleira",
      motivo: "Sobra física",
      quantidade: 2,
    };
    const r1 = await rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
      item,
      CONF.A2_ABERTA,
      dados,
    ]);
    const r2 = await rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
      item,
      CONF.A2_ABERTA,
      dados,
    ]);
    expect(r1).toMatchObject({ item_id: item, criado: true, status: "divergencia" });
    expect(r2.repetida).toBe(true);
    const n = await db.dono(
      "SELECT count(*)::int n FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'EXTRA-1'",
      [CONF.A2_ABERTA],
    );
    expect(n[0].n).toBe(1);
    const [i] = await db.dono(
      "SELECT origem, motivo_inclusao, incluido_por FROM conferencia_itens WHERE id = $1",
      [item],
    );
    expect(i).toMatchObject({
      origem: "adicionado",
      motivo_inclusao: "Sobra física",
      incluido_por: U.ESTQ_A,
    });
  });

  it("material do cadastro: quantidade esperada vem do cadastro", async () => {
    const r = await rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
      novoId(),
      CONF.A2_ABERTA,
      {
        material_id: MATERIAL.A2,
        codigo: "P-002",
        descricao: "Porca",
        motivo: "Achado",
        quantidade: 5,
      },
    ]);
    expect(r.status).toBe("conferido");
  });

  it("recusa duplicado (mesmo código) e dados obrigatórios ausentes", async () => {
    await expect(
      rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
        novoId(),
        CONF.A2_ABERTA,
        { codigo: "extra-1 ", descricao: "x", motivo: "y", quantidade: 1 },
      ]),
    ).rejects.toMatchObject({ code: "CR013" });
    await expect(
      rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
        novoId(),
        CONF.A2_ABERTA,
        { codigo: "Z", descricao: "x", motivo: "", quantidade: 1 },
      ]),
    ).rejects.toThrow(/motivo/);
    await expect(
      rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
        novoId(),
        CONF.A2_ABERTA,
        { codigo: "Z", descricao: "x", motivo: "y", quantidade: 0 },
      ]),
    ).rejects.toThrow(/quantidade/);
  });

  it("recusa inclusão em conferência encerrada", async () => {
    await expect(
      rpc(ESTQ_A, "adicionar_item_conferencia($1, $2, $3)", [
        novoId(),
        CONF.A_FIN,
        { codigo: "Z", descricao: "x", motivo: "y", quantidade: 1 },
      ]),
    ).rejects.toMatchObject({ code: "CR004" });
  });
});

describe("finalizar_conferencia e cancelar_conferencia", () => {
  it("finalização repetida devolve a mesma finalização (não gera duas)", async () => {
    const op = novoId();
    const dados = { assinatura: "data:image/png;base64,QQ==", conferente: "Ana" };
    const r1 = await rpc(ESTQ_A, "finalizar_conferencia($1, $2, $3)", [CONF.A2_ABERTA, dados, op]);
    const r2 = await rpc(ESTQ_A, "finalizar_conferencia($1, $2, $3)", [CONF.A2_ABERTA, dados, op]);
    const r3 = await rpc(ESTQ_A, "finalizar_conferencia($1, $2)", [CONF.A2_ABERTA, dados]);
    expect(r1).toMatchObject({ status: "finalizada", repetida: false });
    expect(r2.repetida).toBe(true);
    expect(r3.repetida).toBe(true);
    const ops = await db.dono(
      "SELECT count(*)::int n FROM conferencia_operacoes WHERE conferencia_id = $1 AND tipo = 'finalizar'",
      [CONF.A2_ABERTA],
    );
    expect(ops[0].n).toBe(1);
    const aud = await db.dono(
      "SELECT count(*)::int n FROM historico_conferencias WHERE conferencia_id = $1",
      [CONF.A2_ABERTA],
    );
    expect(aud[0].n).toBeLessThanOrEqual(1);
  });

  it("finalizar exige assinatura", async () => {
    const [c] = await db.dono(
      "SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'",
      [LISTA.A],
    );
    await expect(rpc(ESTQ_A, "finalizar_conferencia($1, $2)", [c.id, {}])).rejects.toMatchObject({
      code: "CR003",
    });
  });

  it("cancelamento exige motivo, é idempotente e bloqueia finalização posterior", async () => {
    const [c] = await db.dono(
      "SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'",
      [LISTA.A],
    );
    await expect(rpc(ESTQ_A, "cancelar_conferencia($1, $2)", [c.id, ""])).rejects.toMatchObject({
      code: "CR007",
    });
    const r1 = await rpc(ESTQ_A, "cancelar_conferencia($1, $2)", [c.id, "Lista errada"]);
    const r2 = await rpc(ESTQ_A, "cancelar_conferencia($1, $2)", [c.id, "Lista errada"]);
    expect(r1).toMatchObject({ status: "cancelada", repetida: false });
    expect(r2.repetida).toBe(true);
    const [linha] = await db.dono(
      "SELECT motivo_cancelamento, hora_fim FROM conferencias WHERE id = $1",
      [c.id],
    );
    expect(linha.motivo_cancelamento).toBe("Lista errada");
    expect(linha.hora_fim).not.toBeNull();
    await expect(
      rpc(ESTQ_A, "finalizar_conferencia($1, $2)", [c.id, { assinatura: "x" }]),
    ).rejects.toMatchObject({ code: "CR006" });
  });

  it("finalizada não pode ser cancelada", async () => {
    await expect(
      rpc(ESTQ_A, "cancelar_conferencia($1, $2)", [CONF.A_FIN, "motivo"]),
    ).rejects.toMatchObject({ code: "CR008" });
  });

  it("registro de operações é imutável para usuários", async () => {
    const r = await db.tentar(ESTQ_A, "UPDATE conferencia_operacoes SET resultado = '{}'");
    expect(r.ok).toBe(false);
    const d = await db.tentar(ESTQ_A, "DELETE FROM conferencia_operacoes");
    expect(d.ok).toBe(false);
  });

  it("operações de outra empresa não são visíveis", async () => {
    const r = await db.tentar(ESTQ_B, "SELECT 1 FROM conferencia_operacoes");
    expect(r.ok && r.linhas.length).toBe(0);
  });
});
