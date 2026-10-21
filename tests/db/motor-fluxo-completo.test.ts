/**
 * Item 30 — fluxo completo com o motor real (IndexedDB) contra o banco real:
 * login → criar conferência → 10 itens online → offline 50 itens → incluir material →
 * pausar/retomar/pausar → fechar e reabrir o app → continuar → internet volta → sincronizar →
 * finalizar → sincronizar → administrador confere.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MENSAGEM_CONCLUIDA } from "@/lib/sync-v2/motor";
import { tempoTrabalhado } from "@/lib/sync-v2/projecao";
import { Banco, usuario } from "./ambiente";
import { ASSINATURA } from "./eventos";
import { LISTA, U } from "./fixtures";
import { aparelho, sincronizarTudo } from "./motor-apoio";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
  await db.dono(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.A],
  );
  // A lista A passa a ter 60 materiais (3 da fixture + 57).
  for (let i = 4; i <= 60; i++) {
    await db.dono(
      "INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), LISTA.A, `P-${String(i).padStart(3, "0")}`, `Material ${i}`, i % 7],
    );
  }
});
afterAll(async () => {
  await db?.remover();
});

const ESTQ_A = usuario(U.ESTQ_A);
const ADMIN_A = usuario(U.ADMIN_A);

describe("fluxo completo (item 30)", () => {
  it("nenhuma operação se perde e o servidor fica igual ao aparelho", async () => {
    const inicio = new Date(Date.now() - 3 * 3600_000);
    const ap = await aparelho(db, ESTQ_A, { inicio });
    let motor = ap.motor;

    // Login + carga inicial.
    const r0 = await motor.sincronizarAgora();
    expect(r0.mensagem).toBe(MENSAGEM_CONCLUIDA);
    expect((await motor.materiais(LISTA.A)).length).toBe(60);

    // Criar conferência (online) e contar 10 itens.
    const conf = await motor.criarConferencia({ unidade_id: LISTA.A, conferente: "Ana" });
    let itens = await motor.itens(conf);
    expect(itens).toHaveLength(60);
    for (const i of itens.slice(0, 10)) {
      ap.relogio.avancar(1);
      await motor.contarItem(conf, i.k, i.quantidade_esperada);
    }
    await sincronizarTudo(motor, async () => (await motor.fila()).length === 0);
    const noServidor = await db.dono(
      "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1 AND quantidade_contada IS NOT NULL",
      [conf],
    );
    expect(noServidor[0].n).toBe(10);

    // Offline: 50 itens (5 com divergência), material novo, pausa/retomada/pausa.
    ap.transporte.falhas.offline = true;
    for (const [n, i] of itens.slice(10).entries()) {
      ap.relogio.avancar(0.2);
      await motor.contarItem(conf, i.k, n < 5 ? i.quantidade_esperada + 1 : i.quantidade_esperada);
    }
    const kNovo = await motor.adicionarMaterial(conf, {
      codigo: "X-NOVO",
      descricao: "Material encontrado",
      quantidade: 3,
      motivo: "Estava na prateleira",
    });
    const tPausa1 = ap.relogio.agora.getTime();
    await motor.pausar(conf);
    ap.relogio.avancar(10);
    await motor.retomar(conf);
    ap.relogio.avancar(5);
    await motor.pausar(conf);
    ap.relogio.avancar(15);
    const semRede = await motor.sincronizarAgora();
    expect(semRede.ok).toBe(false);
    expect(semRede.pendentes).toBeGreaterThan(50);
    expect(motor.resumo().estado).toBe("OFFLINE");

    // Fecha o app (sem logout) e reabre: tudo continua lá.
    await motor.encerrar();
    motor = await ap.reabrir();
    const c1 = (await motor.conferencia(conf))!;
    expect(c1.status).toBe("pausada");
    expect(c1.quantidade_pausas).toBe(2);
    expect(c1.total_tempo_pausado).toBe(600);
    itens = await motor.itens(conf);
    expect(itens.filter((i) => i.quantidade_contada !== null)).toHaveLength(61);
    expect((await motor.fila()).length).toBe(50 + 1 + 3);

    // Continua offline: retoma e corrige um item.
    await motor.retomar(conf);
    const corrigir = itens.find((i) => i.status === "divergencia")!;
    await motor.contarItem(conf, corrigir.k, corrigir.quantidade_esperada);

    // Internet volta.
    ap.transporte.falhas.offline = false;
    const r1 = await sincronizarTudo(motor, async () => (await motor.fila()).length === 0);
    expect(r1.mensagem).toBe(MENSAGEM_CONCLUIDA);
    const [srv] = await db.dono(
      "SELECT status, total_tempo_pausado, quantidade_pausas FROM conferencias WHERE id = $1",
      [conf],
    );
    expect(srv).toMatchObject({
      status: "em_andamento",
      total_tempo_pausado: 600 + 900,
      quantidade_pausas: 2,
    });
    const pausas = await db.dono(
      "SELECT pausada_em, segundos FROM conferencia_pausas WHERE conferencia_id = $1 ORDER BY pausada_em",
      [conf],
    );
    expect(pausas.map((p) => p.segundos)).toEqual([600, 900]);
    expect(new Date(pausas[0].pausada_em).getTime()).toBe(tPausa1);
    const divergentes = await db.dono(
      "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1 AND status = 'divergencia'",
      [conf],
    );
    expect(divergentes[0].n).toBe(5); // 4 contagens divergentes + o material incluído (esperado 0, contado 3)
    const novo = await db.dono(
      "SELECT origem, quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'X-NOVO'",
      [conf],
    );
    expect(novo).toEqual([{ origem: "adicionado", quantidade_contada: "3" }]);

    // Assina e finaliza (30 min depois da retomada).
    ap.relogio.avancar(30);
    await motor.assinar(conf, ASSINATURA);
    await motor.finalizar(conf, { observacoes: "Tudo certo" });
    const r2 = await sincronizarTudo(motor, async () => (await motor.fila()).length === 0);
    expect(r2.mensagem).toBe(MENSAGEM_CONCLUIDA);

    // Administrador confere.
    const final = await db.como(ADMIN_A, (q) =>
      q(
        "SELECT status, hora_inicio, hora_fim, total_tempo_pausado, tempo_trabalhado, assinatura IS NOT NULL AS assinada, observacoes FROM conferencias WHERE id = $1",
        [conf],
      ),
    );
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({
      status: "finalizada",
      assinada: true,
      observacoes: "Tudo certo",
      total_tempo_pausado: 1500,
    });
    const duracao =
      (new Date(final[0].hora_fim).getTime() - new Date(final[0].hora_inicio).getTime()) / 1000;
    expect(final[0].tempo_trabalhado).toBe(Math.round(duracao) - 1500);
    const itensSrv = await db.como(ADMIN_A, (q) =>
      q(
        "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1 AND quantidade_contada IS NOT NULL",
        [conf],
      ),
    );
    expect(itensSrv[0].n).toBe(61);

    // Sem duplicidade: cada evento local foi registrado exatamente uma vez no servidor.
    const locais = await motor.eventos(conf);
    const [ev] = await db.dono(
      "SELECT count(*)::int AS n, count(DISTINCT event_id)::int AS d FROM conferencia_eventos WHERE conferencia_id = $1",
      [conf],
    );
    expect(ev.n).toBe(locais.length);
    expect(ev.d).toBe(locais.length);

    // O aparelho mostra exatamente o que o servidor tem.
    const local = (await motor.conferencia(conf))!;
    expect(local.status).toBe("finalizada");
    expect(local.pendente).toBe(false);
    expect(tempoTrabalhado(local)).toBe(final[0].tempo_trabalhado);
    const itensLocais = await motor.itens(conf);
    expect(itensLocais.every((i) => !i.pendente && i.id)).toBe(true);
    expect(itensLocais.find((i) => i.k === kNovo)?.quantidade_contada).toBe(3);
    await motor.encerrar();
  });
});
