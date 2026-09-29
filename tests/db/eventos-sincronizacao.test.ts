/**
 * V2.2/V2.3 no servidor: processamento idempotente de eventos, pausas pela hora real,
 * conflitos, finalização/cancelamento/material idempotentes, fotos e assinaturas,
 * cursor de sincronização com exclusões (tombstones) e isolamento por empresa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Banco, prepararSessao, servidor, usuario } from "./ambiente";
import { ASSINATURA, enviar, evento, minutos } from "./eventos";
import { CONF, EMPRESA_A, LISTA, MATERIAL, U } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const ESTQ_A = usuario(U.ESTQ_A);
const ESTQ_B = usuario(U.ESTQ_B);
const ADMIN_A = usuario(U.ADMIN_A);

/** Cria (via evento) uma conferência aberta numa lista e devolve o id. */
async function novaConferencia(lista: string, quando = new Date(), ator = ESTQ_A) {
  const id = randomUUID();
  const [r] = await enviar(db, ator, [
    evento("CONFERENCE_CREATED", id, { unidade_id: lista, conferente: "Ana" }, { quando }),
  ]);
  expect(r.status).toBe("aplicado");
  return id;
}
const fecharAbertas = (lista: string) =>
  db.dono("UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')", [lista]);

describe("idempotência", () => {
  it("TESTE D — o mesmo evento enviado 10 vezes é aplicado uma única vez", async () => {
    await fecharAbertas(LISTA.A);
    const conf = await novaConferencia(LISTA.A);
    const e = evento("ITEM_COUNTED", conf, { material_id: MATERIAL.A1, quantidade: 7, versao_base: 0 });
    const respostas = [];
    for (let i = 0; i < 10; i++) respostas.push((await enviar(db, ESTQ_A, [e]))[0]);
    expect(respostas[0]).toMatchObject({ status: "aplicado", duplicado: false });
    for (const r of respostas.slice(1)) expect(r).toMatchObject({ status: "aplicado", duplicado: true, versao: 1 });
    const [item] = await db.dono("SELECT versao, quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2", [conf, MATERIAL.A1]);
    expect(item.versao).toBe(1);
    expect(Number(item.quantidade_contada)).toBe(7);
    const [n] = await db.dono("SELECT count(*)::int n FROM conferencia_eventos WHERE event_id = $1", [e.event_id]);
    expect(n.n).toBe(1);
  });

  it("TESTE E — duas operações diferentes geram duas aplicações", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const r = await enviar(db, ESTQ_A, [
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A2, quantidade: 5, versao_base: 0 }),
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A3, quantidade: 1, versao_base: 0 }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["aplicado", "aplicado"]);
    const itens = await db.dono("SELECT material_id, status FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = ANY($2) ORDER BY material_id", [c.id, [MATERIAL.A2, MATERIAL.A3]]);
    expect(itens.map((i) => i.status).sort()).toEqual(["conferido", "divergencia"]);
  });

  it("TESTE B — resposta perdida (internet caiu): o reenvio devolve o resultado já registrado", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const e = evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A2, quantidade: 4, versao_base: 1 });
    const primeira = (await enviar(db, ESTQ_A, [e]))[0]; // o servidor aplicou e confirmou; o aparelho "não recebeu"
    const reenvio = (await enviar(db, ESTQ_A, [e]))[0];
    expect(reenvio).toMatchObject({ duplicado: true, status: primeira.status, versao: primeira.versao });
  });

  it("TESTE A — servidor lento: o reenvio simultâneo espera e não duplica", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const e = evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A3, quantidade: 9, versao_base: 1 });
    const lento = await db.conectar();
    const retry = await db.conectar();
    try {
      await lento.query("BEGIN");
      await prepararSessao(lento, ESTQ_A);
      const r1 = (await lento.query("SELECT processar_eventos_conferencia($1) AS r", [JSON.stringify([e])])).rows[0].r[0];
      // O aparelho desistiu de esperar (timeout) e reenviou enquanto a 1ª requisição ainda não confirmou.
      await retry.query("BEGIN");
      await prepararSessao(retry, ESTQ_A);
      const p2 = retry.query("SELECT processar_eventos_conferencia($1) AS r", [JSON.stringify([e])]);
      await new Promise((r) => setTimeout(r, 300));
      await lento.query("COMMIT");
      const r2 = (await p2).rows[0].r[0];
      await retry.query("COMMIT");
      expect(r1).toMatchObject({ status: "aplicado", duplicado: false });
      expect(r2).toMatchObject({ status: "aplicado", duplicado: true });
      const [item] = await db.dono("SELECT versao FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2", [c.id, MATERIAL.A3]);
      expect(item.versao).toBe(2); // 1 (teste E) + 1 — aplicado uma única vez
    } finally {
      await lento.end();
      await retry.end();
    }
  });

  it("o mesmo event_id de OUTRO usuário é recusado (não revela o resultado alheio)", async () => {
    const [ev] = await db.dono("SELECT event_id, conferencia_id FROM conferencia_eventos LIMIT 1");
    const r = await enviar(db, ADMIN_A, [evento("ITEM_COUNTED", ev.conferencia_id, {}, { id: ev.event_id })]);
    expect(r[0].status).toBe("rejeitado");
    expect(r[0].erro_codigo).toBe("42501");
  });
});

describe("pausas pela hora real dos eventos (TESTE F)", () => {
  it("pausar, retomar e pausar de novo OFFLINE, sincronizar horas depois: tempo correto", async () => {
    await fecharAbertas(LISTA.A2);
    const t0 = new Date(Date.now() - 3 * 3600_000); // conferência começou há 3 horas
    const conf = randomUUID();
    // Tudo feito offline; enviado agora, de uma vez.
    const r = await enviar(db, ESTQ_A, [
      evento("CONFERENCE_CREATED", conf, { unidade_id: LISTA.A2 }, { quando: t0 }),
      evento("CONFERENCE_PAUSED", conf, {}, { quando: minutos(t0, 10) }),
      evento("CONFERENCE_RESUMED", conf, {}, { quando: minutos(t0, 15) }), // pausa 1: 5 min
      evento("CONFERENCE_PAUSED", conf, {}, { quando: minutos(t0, 20) }),
      evento("CONFERENCE_RESUMED", conf, {}, { quando: minutos(t0, 30) }), // pausa 2: 10 min
      evento("SIGNATURE_ADDED", conf, { tipo: "conferente", imagem: ASSINATURA }, { quando: minutos(t0, 59) }),
      evento("CONFERENCE_FINALIZED", conf, { conferente: "Ana" }, { quando: minutos(t0, 60) }),
    ]);
    expect(r.map((x) => x.status)).toEqual(Array(7).fill("aplicado"));
    const [c] = await db.dono("SELECT status, total_tempo_pausado, quantidade_pausas, tempo_trabalhado, hora_inicio, hora_fim FROM conferencias WHERE id = $1", [conf]);
    expect(c.status).toBe("finalizada");
    expect(c.quantidade_pausas).toBe(2);
    expect(c.total_tempo_pausado).toBe(15 * 60);
    expect(c.tempo_trabalhado).toBe(45 * 60);
    expect(new Date(c.hora_inicio).getTime()).toBe(t0.getTime());
    expect(new Date(c.hora_fim).getTime()).toBe(minutos(t0, 60).getTime());
    const pausas = await db.dono("SELECT segundos FROM conferencia_pausas WHERE conferencia_id = $1 ORDER BY pausada_em", [conf]);
    expect(pausas.map((p) => p.segundos)).toEqual([300, 600]);
    const [h] = await db.dono("SELECT duracao_segundos, status FROM historico_conferencias WHERE conferencia_id = $1", [conf]);
    expect(h).toMatchObject({ duracao_segundos: 45 * 60, status: "finalizada" });
  });

  it("app fechado com a conferência pausada e retomada no dia seguinte: pausa longa contada inteira", async () => {
    await fecharAbertas(LISTA.A2);
    const t0 = new Date(Date.now() - 26 * 3600_000);
    const conf = randomUUID();
    await enviar(db, ESTQ_A, [
      evento("CONFERENCE_CREATED", conf, { unidade_id: LISTA.A2 }, { quando: t0 }),
      evento("CONFERENCE_PAUSED", conf, {}, { quando: minutos(t0, 30) }),
    ]);
    // ...dia seguinte (app reaberto)
    await enviar(db, ESTQ_A, [evento("CONFERENCE_RESUMED", conf, {}, { quando: minutos(t0, 24 * 60 + 30) })]);
    const [c] = await db.dono("SELECT total_tempo_pausado FROM conferencias WHERE id = $1", [conf]);
    expect(c.total_tempo_pausado).toBe(24 * 3600);
  });

  it("relógio do aparelho adiantado: a hora é limitada (não gera tempo negativo nem futuro)", async () => {
    const [aberta] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A2]);
    const futuro = new Date(Date.now() + 3 * 24 * 3600_000);
    const [r] = await enviar(db, ESTQ_A, [evento("CONFERENCE_PAUSED", aberta.id, {}, { quando: futuro })]);
    expect(r.status).toBe("aplicado");
    const [c] = await db.dono("SELECT ultima_pausa FROM conferencias WHERE id = $1", [aberta.id]);
    expect(new Date(c.ultima_pausa).getTime()).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it("V1 (sem motor de eventos): a hora informada no clique é usada mesmo sincronizando depois", async () => {
    await fecharAbertas(LISTA.A_MOD);
    const conf = await novaConferencia(LISTA.A_MOD, new Date(Date.now() - 3600_000));
    const pausa = new Date(Date.now() - 50 * 60_000);
    const retomada = new Date(Date.now() - 40 * 60_000);
    await db.como(ESTQ_A, async (q) => {
      await q("UPDATE conferencias SET status = 'pausada', ultima_pausa = $2 WHERE id = $1", [conf, pausa.toISOString()]);
      await q("UPDATE conferencias SET status = 'em_andamento', ultima_retomada = $2 WHERE id = $1", [conf, retomada.toISOString()]);
      const [c] = await q("SELECT total_tempo_pausado FROM conferencias WHERE id = $1", [conf]);
      expect(c.total_tempo_pausado).toBe(600);
    });
  });
});

describe("conflitos (TESTE G) — nunca descartados", () => {
  it("alteração local + alteração no servidor por outro aparelho = CONFLITO registrado, item preservado", async () => {
    await fecharAbertas(LISTA.A);
    const conf = await novaConferencia(LISTA.A);
    // Aparelho X conta o item (versão 0 -> 1).
    await enviar(db, ESTQ_A, [evento("ITEM_COUNTED", conf, { material_id: MATERIAL.A1, quantidade: 10, versao_base: 0 }, { dispositivo: "X" })]);
    // Outra pessoa altera no servidor (tela da V1): versão 2, sem dispositivo.
    await db.como(ADMIN_A, (q) => q("UPDATE conferencia_itens SET quantidade_contada = 8, status = 'divergencia' WHERE conferencia_id = $1 AND material_id = $2", [conf, MATERIAL.A1]), { gravar: true });
    // Aparelho X, ainda sem saber, envia nova contagem baseada na versão 1.
    const [r] = await enviar(db, ESTQ_A, [evento("ITEM_COUNTED", conf, { material_id: MATERIAL.A1, quantidade: 11, versao_base: 1 }, { dispositivo: "X" })]);
    expect(r.status).toBe("conflito");
    expect(r.estado_servidor).toMatchObject({ quantidade_contada: 8, versao: 2 });
    const [item] = await db.dono("SELECT quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2", [conf, MATERIAL.A1]);
    expect(Number(item.quantidade_contada)).toBe(8);
    const [reg] = await db.dono("SELECT status, device_id FROM conferencia_eventos WHERE event_id = $1", [r.event_id]);
    expect(reg).toMatchObject({ status: "conflito", device_id: "X" });
  });

  it("o usuário decide manter a contagem local: novo evento com 'forcar' é aplicado", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const [r] = await enviar(db, ESTQ_A, [evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A1, quantidade: 11, versao_base: 2, forcar: true }, { dispositivo: "X" })]);
    expect(r.status).toBe("aplicado");
  });

  it("contagens sequenciais do MESMO aparelho (offline) não são conflito", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const r = await enviar(db, ESTQ_A, [
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A2, quantidade: 1, versao_base: 0 }, { dispositivo: "Y" }),
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A2, quantidade: 2, versao_base: 0 }, { dispositivo: "Y" }),
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A2, quantidade: 5, versao_base: 0 }, { dispositivo: "Y" }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["aplicado", "aplicado", "aplicado"]);
  });

  it("outro aparelho abriu conferência na mesma lista: criação vira CONFLITO (não duplica)", async () => {
    const [r] = await enviar(db, ESTQ_A, [evento("CONFERENCE_CREATED", randomUUID(), { unidade_id: LISTA.A })]);
    expect(r).toMatchObject({ status: "conflito", erro_codigo: "CR015" });
    const n = await db.dono("SELECT count(*)::int n FROM conferencias WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')", [LISTA.A]);
    expect(n[0].n).toBe(1);
  });

  it("evento de conferência ainda não sincronizada NÃO é registrado (o aparelho reenvia depois)", async () => {
    const orfa = randomUUID();
    const e = evento("ITEM_COUNTED", orfa, { material_id: MATERIAL.A1, quantidade: 1 });
    const [r] = await enviar(db, ESTQ_A, [e]);
    expect(r).toMatchObject({ status: "tentar_novamente", erro_codigo: "CR010" });
    expect(await db.dono("SELECT 1 FROM conferencia_eventos WHERE event_id = $1", [e.event_id])).toHaveLength(0);
  });

  it("lote interrompido preserva a ordem: nada depois de uma falha transitória é aplicado", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const r = await enviar(db, ESTQ_A, [
      evento("ITEM_COUNTED", randomUUID(), { material_id: MATERIAL.A1, quantidade: 1 }),
      evento("ITEM_COUNTED", c.id, { material_id: MATERIAL.A3, quantidade: 3, versao_base: 99 }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["tentar_novamente", "tentar_novamente"]);
  });
});

describe("finalização, cancelamento e material adicional idempotentes", () => {
  it("duas finalizações (eventos diferentes) produzem um único estado finalizado", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const fim1 = new Date(Date.now() - 60_000);
    const r = await enviar(db, ESTQ_A, [
      evento("SIGNATURE_ADDED", c.id, { tipo: "conferente", imagem: ASSINATURA }),
      evento("CONFERENCE_FINALIZED", c.id, {}, { quando: fim1 }),
      evento("CONFERENCE_FINALIZED", c.id, {}, { quando: new Date() }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["aplicado", "aplicado", "aplicado"]);
    expect(r[2].sem_efeito).toBe("ja_finalizada");
    const [conf] = await db.dono("SELECT status, hora_fim FROM conferencias WHERE id = $1", [c.id]);
    expect(new Date(conf.hora_fim).getTime()).toBe(fim1.getTime());
    const ops = await db.dono("SELECT count(*)::int n FROM conferencia_operacoes WHERE conferencia_id = $1 AND tipo = 'finalizar'", [c.id]);
    expect(ops[0].n).toBe(1);
  });

  it("cancelar depois de finalizar = conflito; finalizar depois de cancelar = conflito", async () => {
    const [fin] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'finalizada' ORDER BY hora_fim DESC LIMIT 1", [LISTA.A]);
    const [r1] = await enviar(db, ESTQ_A, [evento("CONFERENCE_CANCELLED", fin.id, { motivo: "engano" })]);
    expect(r1).toMatchObject({ status: "conflito", erro_codigo: "CR008" });
    const conf = await novaConferencia(LISTA.A);
    const cancel = evento("CONFERENCE_CANCELLED", conf, { motivo: "Lista errada" });
    const r = await enviar(db, ESTQ_A, [cancel, cancel, evento("CONFERENCE_CANCELLED", conf, { motivo: "de novo" })]);
    expect(r[0]).toMatchObject({ status: "aplicado", duplicado: false });
    expect(r[1]).toMatchObject({ duplicado: true });
    expect(r[2]).toMatchObject({ status: "aplicado", sem_efeito: "ja_cancelada" });
    const [r2] = await enviar(db, ESTQ_A, [evento("CONFERENCE_FINALIZED", conf, { assinatura: ASSINATURA })]);
    expect(r2).toMatchObject({ status: "conflito", erro_codigo: "CR006" });
    const [c] = await db.dono("SELECT motivo_cancelamento FROM conferencias WHERE id = $1", [conf]);
    expect(c.motivo_cancelamento).toBe("Lista errada");
  });

  it("material adicionado: mesmo evento reenviado não duplica; outro evento com o mesmo código = conflito", async () => {
    const conf = await novaConferencia(LISTA.A);
    const item = randomUUID();
    const add = evento("MATERIAL_ADDED", conf, { item_id: item, codigo: "EXTRA-9", descricao: "Achado", motivo: "Sobra", quantidade: 2 });
    const r = await enviar(db, ESTQ_A, [add, add]);
    expect(r[0]).toMatchObject({ status: "aplicado", item_id: item });
    expect(r[1].duplicado).toBe(true);
    const [dup] = await enviar(db, ESTQ_A, [evento("MATERIAL_ADDED", conf, { item_id: randomUUID(), codigo: "extra-9", descricao: "x", motivo: "y", quantidade: 1 })]);
    expect(dup).toMatchObject({ status: "conflito", erro_codigo: "CR013" });
    const n = await db.dono("SELECT count(*)::int n FROM conferencia_itens WHERE conferencia_id = $1 AND upper(codigo) = 'EXTRA-9'", [conf]);
    expect(n[0].n).toBe(1);
  });
});

describe("assinaturas e fotos", () => {
  it("assinatura fica na conferência; o registro do evento guarda só o hash", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const e = evento("SIGNATURE_ADDED", c.id, { tipo: "gestor", imagem: ASSINATURA });
    await enviar(db, ESTQ_A, [e]);
    const [conf] = await db.dono("SELECT assinatura_gestor FROM conferencias WHERE id = $1", [c.id]);
    expect(conf.assinatura_gestor).toBe(ASSINATURA);
    const [reg] = await db.dono("SELECT payload FROM conferencia_eventos WHERE event_id = $1", [e.event_id]);
    expect(reg.payload.imagem).toBeUndefined();
    expect(reg.payload.imagem_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("assinatura inválida é recusada e fica registrada (precisa de atenção)", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const [r] = await enviar(db, ESTQ_A, [evento("SIGNATURE_ADDED", c.id, { imagem: "javascript:alert(1)" })]);
    expect(r).toMatchObject({ status: "rejeitado", erro_codigo: "22023" });
  });

  it("upload no Storage só no caminho da própria empresa/conferência; foto registrada uma vez", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const foto = randomUUID();
    const caminho = `${EMPRESA_A}/${c.id}/${foto}.jpg`;
    const up = await db.tentar(ESTQ_A, "INSERT INTO storage.objects (bucket_id, name) VALUES ('conferencias', $1)", [caminho], { gravar: true });
    expect(up.ok).toBe(true);
    const outraEmpresa = await db.tentar(ESTQ_B, "INSERT INTO storage.objects (bucket_id, name) VALUES ('conferencias', $1)", [`${EMPRESA_A}/${c.id}/${randomUUID()}.jpg`]);
    expect(outraEmpresa.ok).toBe(false);
    const leituraB = await db.tentar(ESTQ_B, "SELECT 1 FROM storage.objects WHERE name = $1", [caminho]);
    expect(leituraB.ok && leituraB.linhas.length).toBe(0);

    const e = evento("PHOTO_ADDED", c.id, { foto_id: foto, caminho, material_id: MATERIAL.A2, mime: "image/jpeg", bytes: 12345 });
    const r = await enviar(db, ESTQ_A, [e, e]);
    expect(r[0].status).toBe("aplicado");
    expect(r[1].duplicado).toBe(true);
    const fotos = await db.dono("SELECT item_id FROM conferencia_fotos WHERE id = $1", [foto]);
    expect(fotos).toHaveLength(1);
    expect(fotos[0].item_id).not.toBeNull();
  });

  it("foto com caminho de outra conferência é recusada", async () => {
    const [c] = await db.dono("SELECT id FROM conferencias WHERE unidade_id = $1 AND status = 'em_andamento'", [LISTA.A]);
    const [r] = await enviar(db, ESTQ_A, [evento("PHOTO_ADDED", c.id, { foto_id: randomUUID(), caminho: `${EMPRESA_A}/${CONF.A_FIN}/${randomUUID()}.jpg` })]);
    expect(r.status).not.toBe("aplicado");
  });
});

describe("sincronização servidor → aparelho (cursor, exclusões, isolamento)", () => {
  type Pull = { alteracoes: { tabela: string; id: string; operacao: string; dados: Record<string, unknown> | null }[]; cursor: string; mais: boolean; reset: boolean };
  /** Uma consulta de alterações a partir do cursor. */
  async function puxarUmaVez(ator = ESTQ_A, cursor?: string): Promise<Pull> {
    return db.como(ator, async (q) => {
      const c = cursor ?? (await q("SELECT cursor_sync_inicial() AS c"))[0].c;
      const [r] = await q("SELECT alteracoes_sync($1, 1000) AS r", [c]);
      return r.r as Pull;
    }, { gravar: true });
  }
  /**
   * Consulta até receber algo ou até esgotar as tentativas (transações abertas em outros
   * bancos de teste do mesmo servidor podem adiar a marca d'água por alguns milissegundos).
   */
  async function puxar(ator = ESTQ_A, cursor?: string, ate?: (r: Pull) => boolean): Promise<Pull> {
    let acumulado: Pull = { alteracoes: [], cursor: cursor ?? "", mais: false, reset: false };
    let c = cursor;
    for (let i = 0; i < 100; i++) {
      const r = await puxarUmaVez(ator, c);
      acumulado = { ...r, alteracoes: [...acumulado.alteracoes, ...r.alteracoes] };
      c = r.cursor;
      if (r.reset || (ate ? ate(acumulado) : r.alteracoes.length > 0)) break;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    return acumulado;
  }

  it("TESTE H — exclusão no servidor chega ao aparelho como exclusão (tombstone)", async () => {
    const cursor = await db.como(ESTQ_A, async (q) => (await q("SELECT cursor_sync_inicial() AS c"))[0].c, { gravar: true });
    const [m] = await db.dono("INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, 'TMP-1', 'Temporário', 1) RETURNING id", [LISTA.A2]);
    let r = await puxar(ESTQ_A, cursor, (x) => x.alteracoes.some((a) => a.id === m.id));
    expect(r.alteracoes).toContainEqual(expect.objectContaining({ tabela: "materiais", id: m.id, operacao: "upsert" }));
    await db.dono("DELETE FROM materiais WHERE id = $1", [m.id]);
    r = await puxar(ESTQ_A, r.cursor, (x) => x.alteracoes.some((a) => a.id === m.id && a.operacao === "delete"));
    expect(r.alteracoes).toContainEqual(expect.objectContaining({ tabela: "materiais", id: m.id, operacao: "delete" }));
  });

  it("mudanças de status e atualizações também chegam (não só registros novos)", async () => {
    const cursor = await db.como(ESTQ_A, async (q) => (await q("SELECT cursor_sync_inicial() AS c"))[0].c, { gravar: true });
    await db.dono("UPDATE materiais SET quantidade_esperada = 99 WHERE id = $1", [MATERIAL.A2]);
    const r = await puxar(ESTQ_A, cursor, (x) => x.alteracoes.some((a) => a.id === MATERIAL.A2));
    const mat = r.alteracoes.find((a) => a.id === MATERIAL.A2);
    expect(Number(mat?.dados?.quantidade_esperada)).toBe(99);
  });

  it("transação lenta não é pulada pelo cursor (marca d'água por transação)", async () => {
    const cursor = await db.como(ESTQ_A, async (q) => (await q("SELECT cursor_sync_inicial() AS c"))[0].c, { gravar: true });
    const lenta = await db.conectar();
    try {
      await lenta.query("BEGIN");
      await lenta.query("UPDATE materiais SET descricao = 'alterado pela transação lenta' WHERE id = $1", [MATERIAL.A2]);
      // Outra transação, mais nova, confirma antes.
      await db.dono("UPDATE materiais SET descricao = 'rápida' WHERE id = $1", [MATERIAL.A1]);
      const antes = await puxarUmaVez(ESTQ_A, cursor);
      // Nada depois da transação lenta pode ser entregue enquanto ela não termina.
      expect(antes.alteracoes.find((a) => a.id === MATERIAL.A1)).toBeUndefined();
      await lenta.query("COMMIT");
      const depois = await puxar(ESTQ_A, antes.cursor, (x) =>
        [MATERIAL.A1, MATERIAL.A2].every((id) => x.alteracoes.some((a) => a.id === id)));
      const ids = depois.alteracoes.map((a) => a.id);
      expect(ids).toContain(MATERIAL.A1);
      expect(ids).toContain(MATERIAL.A2);
    } finally {
      await lenta.end();
    }
  });

  it("interrompida no meio, a sincronização retoma do cursor sem perder nem repetir além do necessário", async () => {
    const cursor = await db.como(ESTQ_A, async (q) => (await q("SELECT cursor_sync_inicial() AS c"))[0].c, { gravar: true });
    for (let i = 0; i < 7; i++) await db.dono("INSERT INTO materiais (unidade_id, codigo, descricao) VALUES ($1, $2, 'lote')", [LISTA.A2, `LOTE-${i}`]);
    const vistos = new Set<string>();
    let c = cursor;
    const lote = await db.dono("SELECT id FROM materiais WHERE codigo LIKE 'LOTE-%'");
    // Páginas de 3; transações ainda abertas (em qualquer banco do servidor) só ADIAM a entrega:
    // o aparelho consulta de novo depois, a partir do mesmo cursor.
    for (let chamada = 0; chamada < 200 && !lote.every((m) => vistos.has(m.id)); chamada++) {
      const r = await db.como(ESTQ_A, async (q) => (await q("SELECT alteracoes_sync($1, 3) AS r", [c]))[0].r, { gravar: true });
      for (const a of r.alteracoes) if (a.tabela === "materiais") vistos.add(a.id);
      c = r.cursor;
      if (!r.mais) await new Promise((ok) => setTimeout(ok, 20));
    }
    for (const m of lote) expect(vistos.has(m.id)).toBe(true);
  });

  it("isolamento: usuário da empresa B não recebe alterações da empresa A", async () => {
    const cursor = await db.como(ESTQ_B, async (q) => (await q("SELECT cursor_sync_inicial() AS c"))[0].c, { gravar: true });
    await db.dono("UPDATE materiais SET descricao = 'segredo da A' WHERE id = $1", [MATERIAL.A1]);
    // Sentinela da empresa B, feita DEPOIS: quando B a recebe, a alteração da A já passou pelo cursor.
    await db.dono("UPDATE materiais SET descricao = 'sentinela B' WHERE id = $1", [MATERIAL.B1]);
    const r = await puxar(ESTQ_B, cursor, (x) => x.alteracoes.some((a) => a.id === MATERIAL.B1));
    expect(r.alteracoes.some((a) => a.id === MATERIAL.B1)).toBe(true);
    expect(r.alteracoes.find((a) => a.id === MATERIAL.A1)).toBeUndefined();
    const ev = await db.tentar(ESTQ_B, "SELECT 1 FROM conferencia_eventos WHERE unidade_id = $1", [LISTA.A]);
    expect(ev.ok && ev.linhas.length).toBe(0);
  });

  it("carga inicial paginada respeita RLS e não traz imagens", async () => {
    const r = await db.como(ESTQ_A, async (q) => (await q("SELECT snapshot_sync('materiais', null, 2) AS r"))[0].r);
    expect(r.linhas).toHaveLength(2);
    expect(r.proximo).toBeTruthy();
    expect(r.linhas[0].imagem_principal).toBeUndefined();
    const conf = await db.como(ESTQ_A, async (q) => (await q("SELECT snapshot_sync('conferencias', null, 100) AS r"))[0].r);
    expect(conf.linhas.every((l: Record<string, unknown>) => l.assinatura === undefined)).toBe(true);
    const b = await db.como(ESTQ_B, async (q) => (await q("SELECT snapshot_sync('materiais', null, 100) AS r"))[0].r);
    expect(b.linhas.map((l: { id: string }) => l.id)).toEqual([MATERIAL.B1]);
  });

  it("limpeza do registro antigo: aparelho com cursor antigo recebe 'reset'", async () => {
    const antigo = "1:0";
    await db.dono("UPDATE alteracoes_sync SET alterado_em = now() - interval '40 days'");
    const apagadas = await db.como(servidor, async (q) => (await q("SELECT limpar_alteracoes_sync(30) AS n"))[0].n, { gravar: true });
    expect(apagadas).toBeGreaterThan(0);
    const r = await puxarUmaVez(ESTQ_A, antigo);
    expect(r.reset).toBe(true);
  });
});
