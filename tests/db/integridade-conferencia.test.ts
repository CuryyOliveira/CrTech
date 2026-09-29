/**
 * Integridade da conferência NO BANCO (independe do frontend):
 * conferência encerrada imutável, transições válidas, uma aberta por lista,
 * operações administrativas com motivo e auditoria.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Banco, servidor, usuario } from "./ambiente";
import { CONF, ITEM, LISTA, MATERIAL, U, novoId } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const estoquista = usuario(U.ESTQ_A);
const admin = usuario(U.ADMIN_A);
const dono = usuario(U.DONO);

describe("conferência finalizada é imutável", () => {
  for (const [nome, ator] of [
    ["estoquista", estoquista],
    ["administrador (pela API direta)", admin],
  ] as const) {
    it(`${nome}: não altera, não reabre e não exclui`, async () => {
      const alterar = await db.tentar(
        ator,
        "UPDATE conferencias SET observacoes = 'mudei' WHERE id = $1",
        [CONF.A_FIN],
      );
      expect(alterar.ok).toBe(false);
      if (!alterar.ok) expect(alterar.erro.code).toBe("CR002");

      const reabrir = await db.tentar(
        ator,
        "UPDATE conferencias SET status = 'em_andamento' WHERE id = $1",
        [CONF.A_FIN],
      );
      expect(reabrir.ok).toBe(false);

      const excluir = await db.tentar(ator, "DELETE FROM conferencias WHERE id = $1", [CONF.A_FIN]);
      expect(excluir.ok).toBe(false);
      if (!excluir.ok) expect(excluir.erro.code).toBe("CR002");
    });
  }

  it("proprietário (nível 6) tem acesso total: altera, reabre e exclui, sempre auditado", async () => {
    await db.como(dono, async (q) => {
      await q("UPDATE conferencias SET observacoes = 'ajuste do proprietário' WHERE id = $1", [CONF.A_FIN]);
      await q("UPDATE conferencia_itens SET quantidade_contada = 987654, status = 'divergencia' WHERE id = $1", [
        ITEM.A_FIN_2,
      ]);
      await q("DELETE FROM conferencias WHERE id = $1", [CONF.A_FIN]);
      const [c] = await q("SELECT count(*)::int AS n FROM conferencias WHERE id = $1", [CONF.A_FIN]);
      expect(c.n).toBe(0);
      const aud = await q(
        "SELECT acao FROM auditoria WHERE user_id = $1 AND acao LIKE 'conferencia_encerrada_%' ORDER BY acao",
        [U.DONO],
      );
      expect(aud.map((a) => a.acao)).toEqual([
        "conferencia_encerrada_alterada",
        "conferencia_encerrada_excluida",
      ]);
    });
  });

  it("itens de conferência finalizada não podem ser alterados, incluídos nem excluídos", async () => {
    const upd = await db.tentar(
      estoquista,
      "UPDATE conferencia_itens SET quantidade_contada = 5, status = 'conferido' WHERE id = $1",
      [ITEM.A_FIN_2],
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.erro.code).toBe("CR004");

    const ins = await db.tentar(
      estoquista,
      "INSERT INTO conferencia_itens (conferencia_id, codigo, descricao) VALUES ($1, 'X', 'X')",
      [CONF.A_FIN],
    );
    expect(ins.ok).toBe(false);

    const del = await db.tentar(estoquista, "DELETE FROM conferencia_itens WHERE id = $1", [
      ITEM.A_FIN_1,
    ]);
    expect(del.ok).toBe(false);
  });

  it("finalização repetida (duplo clique / reenvio) é aceita sem alterar nada", async () => {
    const [antes] = await db.dono(
      "SELECT hora_fim, tempo_trabalhado, assinatura FROM conferencias WHERE id = $1",
      [CONF.A_FIN],
    );
    const r = await db.tentar(
      estoquista,
      `UPDATE conferencias SET status = 'finalizada', assinatura = $2, conferente = 'Estoquista A', hora_fim = now()
        WHERE id = $1 RETURNING tempo_trabalhado`,
      [CONF.A_FIN, antes.assinatura],
      { gravar: true },
    );
    expect(r.ok).toBe(true);
    const [depois] = await db.dono(
      "SELECT hora_fim, tempo_trabalhado FROM conferencias WHERE id = $1",
      [CONF.A_FIN],
    );
    expect(depois.hora_fim).toEqual(antes.hora_fim);
    expect(depois.tempo_trabalhado).toEqual(antes.tempo_trabalhado);
  });

  it("uma finalização repetida com dados diferentes é recusada (não há alteração silenciosa)", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencias SET status = 'finalizada', assinatura = 'outra' WHERE id = $1",
      [CONF.A_FIN],
    );
    expect(r.ok).toBe(false);
  });

  it("finalizada não pode ser cancelada", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencias SET status = 'cancelada' WHERE id = $1",
      [CONF.A_FIN],
    );
    expect(r.ok).toBe(false);
  });
});

describe("conferência cancelada", () => {
  it("não pode ser finalizada normalmente", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencias SET status = 'finalizada', assinatura = 'x' WHERE id = $1",
      [CONF.A_CANC],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.code).toBe("CR006");
  });

  it("não pode ser reaberta nem excluída por usuário", async () => {
    expect(
      (
        await db.tentar(
          estoquista,
          "UPDATE conferencias SET status = 'em_andamento' WHERE id = $1",
          [CONF.A_CANC],
        )
      ).ok,
    ).toBe(false);
    expect(
      (await db.tentar(estoquista, "DELETE FROM conferencias WHERE id = $1", [CONF.A_CANC])).ok,
    ).toBe(false);
  });
});

describe("transições de uma conferência aberta", () => {
  it("pausa, retoma e finaliza com assinatura; hora_fim é registrada", async () => {
    await db.como(estoquista, async (q) => {
      await q("UPDATE conferencias SET status = 'pausada' WHERE id = $1", [CONF.A2_ABERTA]);
      await q("UPDATE conferencias SET status = 'em_andamento' WHERE id = $1", [CONF.A2_ABERTA]);
      const [r] = await q(
        "UPDATE conferencias SET status = 'finalizada', assinatura = 'sig' WHERE id = $1 RETURNING hora_fim, quantidade_pausas",
        [CONF.A2_ABERTA],
      );
      expect(r.hora_fim).not.toBeNull();
      expect(r.quantidade_pausas).toBe(1);
    });
  });

  it("finalizar exige assinatura do conferente", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencias SET status = 'finalizada' WHERE id = $1",
      [CONF.A2_ABERTA],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.code).toBe("CR003");
  });

  it("status desconhecido é recusado (CHECK + trigger)", async () => {
    expect(
      (
        await db.tentar(estoquista, "UPDATE conferencias SET status = 'concluida' WHERE id = $1", [
          CONF.A2_ABERTA,
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await db.tentar(estoquista, "UPDATE conferencias SET status = 'qualquer' WHERE id = $1", [
          CONF.A2_ABERTA,
        ])
      ).ok,
    ).toBe(false);
  });

  it("não é possível criar uma conferência já encerrada", async () => {
    const r = await db.tentar(
      estoquista,
      "INSERT INTO conferencias (unidade_id, status, hora_fim, assinatura) VALUES ($1, 'finalizada', now(), 'x')",
      [LISTA.A],
    );
    expect(r.ok).toBe(false);
  });

  it("não é possível mover uma conferência para outra lista", async () => {
    const r = await db.tentar(estoquista, "UPDATE conferencias SET unidade_id = $2 WHERE id = $1", [
      CONF.A2_ABERTA,
      LISTA.A,
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("itens: coerência de status e quantidades", () => {
  it("status incoerente com a quantidade é recusado", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencia_itens SET quantidade_contada = 1, status = 'conferido' WHERE id = $1",
      [ITEM.A2_1],
    );
    expect(r.ok).toBe(false);
  });
  it("contagem negativa é recusada", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencia_itens SET quantidade_contada = -1, status = 'divergencia' WHERE id = $1",
      [ITEM.A2_1],
    );
    expect(r.ok).toBe(false);
  });
  it("contagem válida é aceita", async () => {
    const r = await db.tentar(
      estoquista,
      "UPDATE conferencia_itens SET quantidade_contada = 2, status = 'conferido' WHERE id = $1 RETURNING id",
      [ITEM.A2_1],
    );
    expect(r.ok && r.linhas.length).toBe(1);
  });
});

describe("duplicidade: uma conferência aberta por lista", () => {
  it("segunda conferência aberta na mesma lista é recusada pelo banco", async () => {
    const r = await db.tentar(
      estoquista,
      "INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2)",
      [LISTA.A2, U.ESTQ_A],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.code).toBe("23505");
  });

  it("listas diferentes podem ter conferências abertas ao mesmo tempo", async () => {
    const r = await db.tentar(
      estoquista,
      "INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2) RETURNING id",
      [LISTA.A, U.ESTQ_A],
    );
    expect(r.ok).toBe(true);
  });

  it("duas sessões simultâneas: só uma conferência fica aberta", async () => {
    const lista = LISTA.A;
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
      await c1.query("INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2)", [
        lista,
        U.ESTQ_A,
      ]);
      const segunda = c2
        .query("INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2)", [
          lista,
          U.ESTQ_A,
        ])
        .then(
          () => "ok",
          (e: { code?: string }) => e.code,
        );
      await c1.query("COMMIT");
      expect(await segunda).toBe("23505");
      await c2.query("ROLLBACK");
      const abertas = await db.dono(
        "SELECT count(*)::int n FROM conferencias WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
        [lista],
      );
      expect(abertas[0].n).toBe(1);
      await db.dono("DELETE FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [
        lista,
      ]);
    } finally {
      await c1.end();
      await c2.end();
    }
  });
});

describe("listas com histórico", () => {
  it("usuário não exclui lista que possui conferências encerradas", async () => {
    const r = await db.tentar(estoquista, "DELETE FROM unidades WHERE id = $1", [LISTA.A]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.code).toBe("CR005");
  });
  it("lista sem histórico continua podendo ser excluída (comportamento da V1)", async () => {
    const r = await db.tentar(estoquista, "DELETE FROM unidades WHERE id = $1 RETURNING id", [
      LISTA.A_VAZIA,
    ]);
    expect(r.ok && r.linhas.length).toBe(1);
  });
  it("excluir material de conferência encerrada preserva o item (retrato)", async () => {
    await db.como(estoquista, async (q) => {
      await q("DELETE FROM materiais WHERE id = $1", [MATERIAL.A1]);
      const [item] = await q(
        "SELECT material_id, codigo, quantidade_contada FROM conferencia_itens WHERE id = $1",
        [ITEM.A_FIN_1],
      );
      expect(item.material_id).toBeNull();
      expect(item.codigo).toBe("P-001");
      expect(Number(item.quantidade_contada)).toBe(10);
    });
  });
});

describe("operações administrativas explícitas e auditadas", () => {
  it("estoquista não pode reabrir nem excluir por RPC", async () => {
    expect(
      (
        await db.tentar(estoquista, "SELECT reabrir_conferencia($1, 'motivo qualquer')", [
          CONF.A_FIN,
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await db.tentar(estoquista, "SELECT excluir_conferencia($1, 'motivo qualquer')", [
          CONF.A_FIN,
        ])
      ).ok,
    ).toBe(false);
  });

  it("administrador de OUTRA empresa não pode reabrir", async () => {
    const r = await db.tentar(
      usuario(U.ADMIN_B),
      "SELECT reabrir_conferencia($1, 'motivo qualquer')",
      [CONF.A_FIN],
    );
    expect(r.ok).toBe(false);
  });

  it("motivo é obrigatório", async () => {
    const r = await db.tentar(admin, "SELECT reabrir_conferencia($1, '')", [CONF.A_FIN]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.code).toBe("CR007");
  });

  it("administrador reabre com motivo e fica registrado na auditoria", async () => {
    await db.como(admin, async (q) => {
      const [r] = await q(
        "SELECT reabrir_conferencia($1, 'Contagem refeita a pedido do gestor') AS r",
        [CONF.A_FIN],
      );
      expect(r.r.status).toBe("em_andamento");
      const [aud] = await q(
        "SELECT acao, detalhe, user_id FROM auditoria WHERE acao = 'conferencia_reaberta' ORDER BY created_at DESC LIMIT 1",
      );
      expect(aud.user_id).toBe(U.ADMIN_A);
      expect(aud.detalhe).toContain("Contagem refeita a pedido do gestor");
    });
  });

  it("administrador exclui com motivo; exclusão auditada", async () => {
    await db.como(admin, async (q) => {
      await q("SELECT excluir_conferencia($1, 'Registro de teste duplicado')", [CONF.A_CANC]);
      expect(await q("SELECT 1 FROM conferencias WHERE id = $1", [CONF.A_CANC])).toHaveLength(0);
      const aud = await q(
        "SELECT detalhe FROM auditoria WHERE acao = 'conferencia_encerrada_excluida'",
      );
      expect(aud.some((a) => String(a.detalhe).includes("Registro de teste duplicado"))).toBe(true);
    });
  });

  it("administrador exclui lista com histórico apenas pela RPC, com motivo", async () => {
    await db.como(admin, async (q) => {
      await q("SELECT excluir_unidade($1, 'Caminhão vendido')", [LISTA.A]);
      expect(await q("SELECT 1 FROM unidades WHERE id = $1", [LISTA.A])).toHaveLength(0);
      const aud = await q(
        "SELECT acao FROM auditoria WHERE acao IN ('lista_excluida','conferencia_encerrada_excluida')",
      );
      expect(aud.map((a) => a.acao)).toContain("lista_excluida");
    });
  });

  it("servidor (service_role) pode corrigir, mas a alteração fica auditada", async () => {
    await db.como(servidor, async (q) => {
      await q("UPDATE conferencias SET observacoes = 'ajuste do suporte' WHERE id = $1", [
        CONF.B_FIN,
      ]);
      const aud = await q(
        "SELECT acao FROM auditoria WHERE acao = 'conferencia_encerrada_alterada'",
      );
      expect(aud.length).toBeGreaterThan(0);
    });
  });
});

describe("ids gerados no aparelho", () => {
  it("inserir a mesma conferência (mesmo id) duas vezes não cria duas", async () => {
    const id = novoId();
    await db.como(estoquista, async (q) => {
      await q("INSERT INTO conferencias (id, unidade_id, created_by) VALUES ($1, $2, $3)", [
        id,
        LISTA.A_MOD,
        U.ESTQ_A,
      ]);
      await q(
        "INSERT INTO conferencias (id, unidade_id, created_by) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [id, LISTA.A_MOD, U.ESTQ_A],
      );
      const [n] = await q("SELECT count(*)::int n FROM conferencias WHERE unidade_id = $1", [
        LISTA.A_MOD,
      ]);
      expect(n.n).toBe(1);
    });
  });
});
