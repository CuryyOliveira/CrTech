/**
 * Testes de falha (item 26, A–H) com o motor real do aparelho (IndexedDB) e o banco real,
 * mais: NEEDS_ATTENTION sem descarte, resolução de conflitos, fila de fotos e assinatura,
 * isolamento do cache por usuário e logs sem dados sensíveis.
 */
import { randomUUID } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BancoLocal } from "@/lib/sync-v2/banco-local";
import { MENSAGEM_ATENCAO, MENSAGEM_CONCLUIDA, MotorSync } from "@/lib/sync-v2/motor";
import type { Transporte } from "@/lib/sync-v2/transporte";
import { Banco, usuario } from "./ambiente";
import { ASSINATURA } from "./eventos";
import { LISTA, MATERIAL, U } from "./fixtures";
import { aparelho, sincronizarTudo } from "./motor-apoio";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});
beforeEach(async () => {
  await db.dono(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.A],
  );
});

const ESTQ_A = usuario(U.ESTQ_A);
const ADMIN_A = usuario(U.ADMIN_A);
const ESTQ_B = usuario(U.ESTQ_B);

const filaVazia = (m: MotorSync) => async () => (await m.fila()).length === 0;
const kMaterial = (conf: string, material: string) => `${conf}|m|${material}`;

/** Aparelho com carga inicial feita e uma conferência criada e confirmada no servidor. */
async function comConferencia(ator = ESTQ_A) {
  const ap = await aparelho(db, ator);
  await ap.motor.sincronizarAgora();
  const conf = await ap.motor.criarConferencia({ unidade_id: LISTA.A, conferente: "Ana" });
  await sincronizarTudo(ap.motor, filaVazia(ap.motor));
  return { ...ap, conf };
}

async function eventosNoServidor(conf: string, tipo?: string) {
  const r = await db.dono(
    "SELECT count(*)::int AS n FROM conferencia_eventos WHERE conferencia_id = $1 AND ($2::text IS NULL OR event_type = $2)",
    [conf, tipo ?? null],
  );
  return r[0].n as number;
}

describe("testes de falha (A–H) no aparelho", () => {
  it("TESTE A — servidor demora: o cliente aguarda, continua trabalhando e nada duplica", async () => {
    const { motor, transporte, conf } = await comConferencia();
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 10);
    transporte.falhas.atrasoMs = 300;
    const lenta = motor.sincronizarAgora();
    // Enquanto o envio está em andamento, o usuário continua contando e toca "sincronizar" de novo.
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A2), 4);
    const mesma = motor.sincronizarAgora();
    expect(mesma).toBe(lenta); // uma sincronização por vez
    await lenta;
    transporte.falhas.atrasoMs = 0;
    await sincronizarTudo(motor, filaVazia(motor));
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(2);
    const itens = await db.dono(
      "SELECT material_id, quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND quantidade_contada IS NOT NULL ORDER BY codigo",
      [conf],
    );
    expect(itens.map((i) => Number(i.quantidade_contada))).toEqual([10, 4]);
    await motor.encerrar();
  });

  it("TESTE B — internet cai depois do servidor aplicar: o reenvio usa o mesmo event_id e não duplica", async () => {
    const { motor, transporte, conf } = await comConferencia();
    const id = await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 9);
    transporte.falhas.perderResposta = 1;
    const r = await motor.sincronizarAgora();
    expect(r.ok).toBe(false);
    const [f] = await motor.fila();
    expect(f).toMatchObject({
      event_id: id,
      status: "FAILED",
      error_code: "TIMEOUT",
      tentativas: 0,
      falhas_rede: 1,
    });
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(1); // já aplicado no servidor
    await sincronizarTudo(motor, filaVazia(motor));
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(1);
    const logs = await motor.logs();
    expect(
      logs.some(
        (l) => l.acao === "resultado_envio" && (l.dados as { duplicados: number }).duplicados === 1,
      ),
    ).toBe(true);
    await motor.encerrar();
  });

  it("TESTE C — app fecha durante o envio: ao abrir, a fila é recuperada e nada se perde nem duplica", async () => {
    const ap = await comConferencia();
    const { conf, fabrica, transporte } = ap;
    await ap.motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 1);
    await ap.motor.contarItem(conf, kMaterial(conf, MATERIAL.A2), 2);
    // Transporte que aplica no servidor e "morre" antes de responder (app fechado).
    let aplicou!: () => void;
    const chegou = new Promise<void>((ok) => (aplicou = ok));
    const travado: Transporte = Object.assign(
      Object.create(Object.getPrototypeOf(transporte)),
      transporte,
      {
        enviarEventos: async (evs: Record<string, unknown>[]) => {
          await transporte.enviarEventos(evs);
          aplicou();
          return new Promise(() => undefined); // nunca responde
        },
      },
    );
    const morto = await MotorSync.abrir(ap.motor.sessao, travado, { fabrica, online: () => true });
    ap.motor.encerrar().catch(() => undefined);
    void morto.sincronizarAgora();
    await chegou;
    expect((await morto.fila()).filter((f) => f.status === "SYNCING")).toHaveLength(2);

    // Reabre o app (novo processo, mesmo disco).
    const novo = await MotorSync.abrir(ap.motor.sessao, transporte, {
      fabrica,
      online: () => true,
    });
    expect((await novo.fila()).map((f) => f.status)).toEqual(["PENDING", "PENDING"]);
    await sincronizarTudo(novo, filaVazia(novo));
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(2);
    const itens = await novo.itens(conf);
    expect(
      itens.filter((i) => i.quantidade_contada !== null).map((i) => i.quantidade_contada),
    ).toEqual([1, 2]);
  });

  it("TESTE D — o mesmo evento enviado 10 vezes é aplicado uma única vez", async () => {
    const { motor, transporte, conf } = await comConferencia();
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 3);
    transporte.falhas.perderResposta = 9;
    for (let i = 0; i < 10; i++) await motor.sincronizarAgora();
    await sincronizarTudo(motor, filaVazia(motor));
    expect(transporte.chamadas.eventos).toBeGreaterThanOrEqual(10);
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(1);
    const [h] = await db.dono(
      "SELECT versao FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2",
      [conf, MATERIAL.A1],
    );
    expect(h.versao).toBe(1);
    await motor.encerrar();
  });

  it("TESTE E — duas operações diferentes (mesmo item) geram duas aplicações, na ordem", async () => {
    const { motor, conf } = await comConferencia();
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 3);
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 8);
    await sincronizarTudo(motor, filaVazia(motor));
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(2);
    const [h] = await db.dono(
      "SELECT quantidade_contada, versao FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2",
      [conf, MATERIAL.A1],
    );
    expect(h).toMatchObject({ quantidade_contada: "8", versao: 2 });
    await motor.encerrar();
  });

  it("TESTE F — pausar/retomar/pausar offline e sincronizar depois: tempos corretos", async () => {
    const inicio = new Date(Date.now() - 4 * 3600_000);
    const ap = await aparelho(db, ESTQ_A, { inicio });
    const { motor, transporte, relogio } = ap;
    await motor.sincronizarAgora();
    const conf = await motor.criarConferencia({ unidade_id: LISTA.A });
    transporte.falhas.offline = true; // tudo offline, inclusive a criação
    relogio.avancar(20);
    await motor.pausar(conf);
    relogio.avancar(7);
    await motor.retomar(conf);
    relogio.avancar(13);
    await motor.pausar(conf);
    relogio.avancar(60); // sincroniza só 1 h depois (a pausa continua em aberto)
    const local = (await motor.conferencia(conf))!;
    expect(local).toMatchObject({
      status: "pausada",
      total_tempo_pausado: 420,
      quantidade_pausas: 2,
    });
    transporte.falhas.offline = false;
    await sincronizarTudo(motor, filaVazia(motor));
    const [c] = await db.dono(
      "SELECT status, total_tempo_pausado, quantidade_pausas, ultima_pausa, hora_inicio FROM conferencias WHERE id = $1",
      [conf],
    );
    expect(c).toMatchObject({ status: "pausada", total_tempo_pausado: 420, quantidade_pausas: 2 });
    expect(new Date(c.ultima_pausa).getTime() - new Date(c.hora_inicio).getTime()).toBe(
      40 * 60_000,
    );
    relogio.avancar(5);
    await motor.retomar(conf);
    await sincronizarTudo(motor, filaVazia(motor));
    const [d] = await db.dono("SELECT total_tempo_pausado FROM conferencias WHERE id = $1", [conf]);
    expect(d.total_tempo_pausado).toBe(420 + 65 * 60);
    expect((await motor.conferencia(conf))!.total_tempo_pausado).toBe(420 + 65 * 60);
    await motor.encerrar();
  });

  it("TESTE G — alteração local + alteração no servidor: conflito detectado, nada descartado", async () => {
    const a = await comConferencia();
    const b = await aparelho(db, ADMIN_A, { deviceId: "tablet-admin" });
    await b.motor.sincronizarAgora();
    // O aparelho A conta offline; enquanto isso o B conta o mesmo item e sincroniza.
    a.transporte.falhas.offline = true;
    await a.motor.contarItem(a.conf, kMaterial(a.conf, MATERIAL.A1), 7);
    await sincronizarTudo(b.motor, async () => (await b.motor.conferencia(a.conf)) !== undefined);
    await b.motor.contarItem(a.conf, kMaterial(a.conf, MATERIAL.A1), 9);
    await sincronizarTudo(b.motor, filaVazia(b.motor));
    a.transporte.falhas.offline = false;
    const r = await a.motor.sincronizarAgora();
    expect(r.mensagem).toBe(MENSAGEM_ATENCAO);
    expect(a.motor.resumo().estado).toBe("ERROR");
    const [f] = await a.motor.pendenciasAtencao();
    expect(f.status).toBe("CONFLICT");
    expect(f.error_message).toMatch(/outro aparelho/);
    expect(f.resposta?.estado_servidor).toMatchObject({
      quantidade_contada: 9,
      ultimo_dispositivo: "tablet-admin",
    });
    // A tela continua mostrando o valor local (não foi descartado) até o usuário decidir.
    expect((await a.motor.item(kMaterial(a.conf, MATERIAL.A1)))!.quantidade_contada).toBe(7);
    const [srv] = await db.dono(
      "SELECT quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2",
      [a.conf, MATERIAL.A1],
    );
    expect(srv.quantidade_contada).toBe("9");

    // Decisão: manter a contagem local.
    await a.motor.resolver(f.event_id, "manter_local");
    await sincronizarTudo(a.motor, filaVazia(a.motor));
    const [srv2] = await db.dono(
      "SELECT quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2",
      [a.conf, MATERIAL.A1],
    );
    expect(srv2.quantidade_contada).toBe("7");
    expect(await eventosNoServidor(a.conf, "ITEM_COUNTED")).toBe(3); // conflito registrado + B + forçado
    const eventos = await a.motor.eventos(a.conf);
    expect(eventos.filter((e) => e.event_type === "ITEM_COUNTED")).toHaveLength(2); // original + decisão (auditoria)

    // Mesma situação, agora usando o valor do servidor.
    a.transporte.falhas.offline = true;
    await a.motor.contarItem(a.conf, kMaterial(a.conf, MATERIAL.A2), 1);
    await sincronizarTudo(
      b.motor,
      async () => (await b.motor.item(kMaterial(a.conf, MATERIAL.A1)))?.quantidade_contada === 7,
    );
    await b.motor.contarItem(a.conf, kMaterial(a.conf, MATERIAL.A2), 5);
    await sincronizarTudo(b.motor, filaVazia(b.motor));
    a.transporte.falhas.offline = false;
    await a.motor.sincronizarAgora();
    const [g] = await a.motor.pendenciasAtencao();
    await a.motor.resolver(g.event_id, "usar_servidor");
    const final = await sincronizarTudo(
      a.motor,
      async () => (await a.motor.item(kMaterial(a.conf, MATERIAL.A2)))?.quantidade_contada === 5,
    );
    expect(final.mensagem).toBe(MENSAGEM_CONCLUIDA);
    expect((await a.motor.item(kMaterial(a.conf, MATERIAL.A2)))!.quantidade_contada).toBe(5);
    await a.motor.encerrar();
    await b.motor.encerrar();
  });

  it("TESTE H — exclusão no servidor chega ao aparelho", async () => {
    const { motor, conf } = await comConferencia();
    const material = randomUUID();
    await db.dono(
      "INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, $2, 'H-1', 'Temporário', 1)",
      [material, LISTA.A],
    );
    await sincronizarTudo(motor, async () =>
      (await motor.materiais(LISTA.A)).some((m) => m.id === material),
    );
    await db.dono("DELETE FROM materiais WHERE id = $1", [material]);
    await db.dono("DELETE FROM conferencias WHERE id = $1", [conf]);
    await sincronizarTudo(
      motor,
      async () =>
        !(await motor.materiais(LISTA.A)).some((m) => m.id === material) &&
        !(await motor.conferencia(conf)),
    );
    expect((await motor.materiais(LISTA.A)).some((m) => m.id === material)).toBe(false);
    expect(await motor.conferencia(conf)).toBeUndefined();
    expect(await motor.itens(conf)).toHaveLength(0);
    await motor.encerrar();
  });

  it("exclusão no servidor com alterações locais pendentes: não descarta, vira conflito", async () => {
    const { motor, transporte, conf } = await comConferencia();
    transporte.falhas.offline = true;
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 4);
    await db.dono("DELETE FROM conferencias WHERE id = $1", [conf]);
    transporte.falhas.offline = false;
    await sincronizarTudo(motor, async () => (await motor.pendenciasAtencao()).length > 0);
    const [f] = await motor.pendenciasAtencao();
    expect(f).toMatchObject({ status: "CONFLICT", error_code: "CR016" });
    expect((await motor.item(kMaterial(conf, MATERIAL.A1)))!.quantidade_contada).toBe(4);
    await motor.resolver(f.event_id, "usar_servidor");
    await sincronizarTudo(motor, async () => !(await motor.conferencia(conf)));
    expect(await motor.conferencia(conf)).toBeUndefined();
    await motor.encerrar();
  });
});

describe("exclusões e inclusões concorrentes", () => {
  it("item excluído no servidor com contagem local pendente: continua visível até a decisão", async () => {
    const { motor, transporte, conf } = await comConferencia();
    const k = kMaterial(conf, MATERIAL.A1);
    transporte.falhas.offline = true;
    await motor.contarItem(conf, k, 6);
    await db.dono("DELETE FROM conferencia_itens WHERE conferencia_id = $1 AND material_id = $2", [
      conf,
      MATERIAL.A1,
    ]);
    transporte.falhas.offline = false;
    await sincronizarTudo(motor, async () => (await motor.item(k))?.removido_no_servidor === true);
    const [f] = await motor.pendenciasAtencao();
    expect(f).toMatchObject({ status: "CONFLICT", error_code: "CR017" });
    expect((await motor.item(k))!.quantidade_contada).toBe(6);
    await motor.resolver(f.event_id, "usar_servidor");
    expect(await motor.item(k)).toBeUndefined();
    await motor.encerrar();
  });

  it("mesmo material incluído em dois aparelhos: conflito; usar o do servidor remove a cópia local", async () => {
    const a = await comConferencia();
    const b = await aparelho(db, ADMIN_A, { deviceId: "tablet-b" });
    await sincronizarTudo(b.motor, async () => (await b.motor.conferencia(a.conf)) !== undefined);
    a.transporte.falhas.offline = true;
    const dados = { codigo: "Z-1", descricao: "Achado", quantidade: 2, motivo: "Encontrado" };
    const kA = await a.motor.adicionarMaterial(a.conf, dados);
    const kB = await b.motor.adicionarMaterial(a.conf, dados);
    await sincronizarTudo(b.motor, filaVazia(b.motor));
    a.transporte.falhas.offline = false;
    await a.motor.sincronizarAgora();
    const [f] = await a.motor.pendenciasAtencao();
    expect(f).toMatchObject({
      event_type: "MATERIAL_ADDED",
      status: "CONFLICT",
      error_code: "CR013",
    });
    await a.motor.resolver(f.event_id, "usar_servidor");
    await sincronizarTudo(a.motor, async () => (await a.motor.item(kB)) !== undefined);
    const z = (await a.motor.itens(a.conf)).filter((i) => i.codigo === "Z-1");
    expect(z.map((i) => i.k)).toEqual([kB]);
    expect(kA).not.toBe(kB);
    const srv = await db.dono(
      "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'Z-1'",
      [a.conf],
    );
    expect(srv[0].n).toBe(1);
    await a.motor.encerrar();
    await b.motor.encerrar();
  });
});

describe("nenhum descarte automático", () => {
  it("após falhas repetidas do servidor vai para NEEDS_ATTENTION (e continua na fila)", async () => {
    const { motor, transporte, conf } = await comConferencia();
    await motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 2);
    transporte.falhas.erroServidor = 100;
    for (let i = 0; i < 8; i++) await motor.sincronizarAgora();
    const [f] = await motor.fila();
    expect(f).toMatchObject({ status: "NEEDS_ATTENTION", tentativas: 8, error_code: "500" });
    expect(motor.resumo()).toMatchObject({ estado: "ERROR", atencao: 1 });
    // Sem internet não conta como falha do dado.
    transporte.falhas.erroServidor = 0;
    await motor.resolver(f.event_id, "tentar_novamente");
    transporte.falhas.offline = true;
    for (let i = 0; i < 5; i++) await motor.sincronizarAgora();
    expect((await motor.fila())[0]).toMatchObject({ status: "PENDING", tentativas: 0 }); // offline: nem tenta
    transporte.falhas.offline = false;
    transporte.falhas.quedaRede = 20; // rede instável: tenta e cai
    for (let i = 0; i < 20; i++) await motor.sincronizarAgora();
    expect((await motor.fila())[0]).toMatchObject({
      status: "FAILED",
      tentativas: 0,
      falhas_rede: 20,
    });
    await sincronizarTudo(motor, filaVazia(motor));
    expect(await eventosNoServidor(conf, "ITEM_COUNTED")).toBe(1);
    await motor.encerrar();
  });

  it("operação recusada pelo servidor fica em atenção com a mensagem; outra conferência segue", async () => {
    const ap = await aparelho(db, ESTQ_A);
    await ap.motor.sincronizarAgora();
    const conf = await ap.motor.criarConferencia({ unidade_id: LISTA.A });
    // Outro aparelho abriu uma conferência na mesma lista antes desta chegar ao servidor.
    const outra = await aparelho(db, ADMIN_A);
    await outra.motor.sincronizarAgora();
    ap.transporte.falhas.offline = true;
    await ap.motor.contarItem(conf, kMaterial(conf, MATERIAL.A1), 1);
    ap.transporte.falhas.offline = false;
    const confOutra = await outra.motor.criarConferencia({ unidade_id: LISTA.A });
    await sincronizarTudo(outra.motor, filaVazia(outra.motor));
    await ap.motor.sincronizarAgora();
    const pend = await ap.motor.pendenciasAtencao();
    expect(pend.map((p) => [p.event_type, p.status, p.error_code])).toEqual([
      ["CONFERENCE_CREATED", "CONFLICT", "CR015"],
    ]);
    // A contagem desta conferência não foi enviada (depende da criação) e continua na fila.
    const fila = await ap.motor.fila();
    expect(fila.map((f) => f.status)).toEqual(["CONFLICT", "FAILED"]);
    expect(fila[1]).toMatchObject({ error_code: "CR010", tentativas: 1 });
    // Fica parada atrás do conflito (ordem por conferência): novas sincronizações não a reenviam.
    await ap.motor.sincronizarAgora();
    expect((await ap.motor.fila())[1].tentativas).toBe(1);
    await ap.motor.resolver(pend[0].event_id, "usar_servidor");
    await sincronizarTudo(
      ap.motor,
      async () => (await ap.motor.conferencia(confOutra)) !== undefined,
    );
    expect(await ap.motor.conferencia(conf)).toBeUndefined();
    expect((await ap.motor.eventos(conf)).length).toBe(2); // auditoria local preservada
    expect(
      (await ap.motor.fila()).every((f) => f.status === "RESOLVED" || f.status === "SYNCED"),
    ).toBe(true);
    await ap.motor.encerrar();
    await outra.motor.encerrar();
  });
});

describe("fotos e assinatura em fila", () => {
  it("foto offline: guardada no aparelho, enviada quando a conferência existe, arquivo liberado só após confirmação", async () => {
    const ap = await aparelho(db, ESTQ_A);
    await ap.motor.sincronizarAgora();
    ap.transporte.falhas.offline = true;
    const conf = await ap.motor.criarConferencia({ unidade_id: LISTA.A });
    const foto = await ap.motor.adicionarFoto(
      conf,
      kMaterial(conf, MATERIAL.A1),
      new Uint8Array([1, 2, 3, 4]).buffer,
      "image/jpeg",
    );
    await ap.motor.assinar(conf, ASSINATURA);
    let [f] = await ap.motor.fotos(conf);
    expect(f).toMatchObject({ id: foto, status: "pendente_upload" });
    expect(f.arquivo?.byteLength).toBe(4);

    // Internet volta, mas o upload da foto cai uma vez.
    ap.transporte.falhas.offline = false;
    ap.transporte.falhas.fotoSemRede = 1;
    await ap.motor.sincronizarAgora();
    [f] = await ap.motor.fotos(conf);
    expect(f.status).toBe("pendente_upload");
    expect(f.arquivo?.byteLength).toBe(4); // nunca apagar antes da confirmação
    await sincronizarTudo(ap.motor, filaVazia(ap.motor));
    [f] = await ap.motor.fotos(conf);
    expect(f.status).toBe("confirmada");
    expect(f.arquivo).toBeNull();
    const srv = await db.dono(
      "SELECT f.caminho, i.material_id FROM conferencia_fotos f JOIN conferencia_itens i ON i.id = f.item_id WHERE f.id = $1",
      [foto],
    );
    expect(srv).toEqual([{ caminho: f.caminho, material_id: MATERIAL.A1 }]);
    const obj = await db.dono("SELECT count(*)::int AS n FROM storage.objects WHERE name = $1", [
      f.caminho,
    ]);
    expect(obj[0].n).toBe(1);
    const [c] = await db.dono(
      "SELECT assinatura IS NOT NULL AS assinada FROM conferencias WHERE id = $1",
      [conf],
    );
    expect(c.assinada).toBe(true);
    // A assinatura não fica no registro de eventos (servidor) nem na auditoria local.
    const [ev] = await db.dono(
      "SELECT payload FROM conferencia_eventos WHERE conferencia_id = $1 AND event_type = 'SIGNATURE_ADDED'",
      [conf],
    );
    expect(ev.payload.imagem).toBeUndefined();
    expect(
      (await ap.motor.eventos(conf)).find((e) => e.event_type === "SIGNATURE_ADDED")!.payload
        .imagem,
    ).toBeUndefined();
    await ap.motor.encerrar();
  });

  it("finalizar sem assinatura é bloqueado no aparelho; finalizar/cancelar repetido não duplica", async () => {
    const { motor, transporte, conf } = await comConferencia();
    await expect(motor.finalizar(conf)).rejects.toThrow(/assinatura/);
    await motor.assinar(conf, ASSINATURA);
    await motor.finalizar(conf);
    await expect(motor.finalizar(conf)).rejects.toThrow(/finalizada/);
    await expect(motor.cancelar(conf, "teste")).rejects.toThrow(/finalizada/);
    transporte.falhas.perderResposta = 2;
    await motor.sincronizarAgora();
    await motor.sincronizarAgora();
    await sincronizarTudo(motor, filaVazia(motor));
    expect(await eventosNoServidor(conf, "CONFERENCE_FINALIZED")).toBe(1);
    const ops = await db.dono(
      "SELECT count(*)::int AS n FROM conferencia_operacoes WHERE conferencia_id = $1 AND tipo = 'finalizar'",
      [conf],
    );
    expect(ops[0].n).toBe(1);
    await motor.encerrar();
  });
});

describe("isolamento do cache por usuário", () => {
  it("A faz logout, B entra no mesmo aparelho e não vê nada de A", async () => {
    const fabrica = new IDBFactory();
    const a = await aparelho(db, ESTQ_A, { fabrica });
    await a.motor.sincronizarAgora();
    expect((await a.motor.unidades()).length).toBeGreaterThan(0);
    const confA = await a.motor.criarConferencia({ unidade_id: LISTA.A });
    await sincronizarTudo(a.motor, filaVazia(a.motor));
    const saida = await a.motor.encerrar({ apagarDados: true });
    expect(saida).toEqual({ apagado: true, pendentes: 0 });

    const b = await aparelho(db, ESTQ_B, { fabrica });
    await b.motor.sincronizarAgora();
    const unidadesB = await b.motor.unidades();
    expect(unidadesB.length).toBeGreaterThan(0);
    expect(unidadesB.some((u) => u.id === LISTA.A)).toBe(false);
    expect(await b.motor.conferencia(confA)).toBeUndefined();
    expect((await b.motor.conferencias()).some((c) => c.unidade_id === LISTA.A)).toBe(false);
    // Nem abrindo o banco local de B diretamente há dados de A.
    const banco = await BancoLocal.abrir(U.ESTQ_B, fabrica);
    const materiais = await banco.todos<{ unidade_id: string }>("materiais");
    expect(materiais.some((m) => m.unidade_id === LISTA.A)).toBe(false);
    banco.fechar();
    const nomes = (await fabrica.databases()).map((d) => d.name);
    expect(nomes).not.toContain(`cr-v2:${U.ESTQ_A}`);
    await b.motor.encerrar();
  });

  it("logout com alterações pendentes NÃO apaga (nada é perdido), mas o próximo usuário usa outro banco", async () => {
    const fabrica = new IDBFactory();
    const a = await aparelho(db, ESTQ_A, { fabrica });
    await a.motor.sincronizarAgora();
    a.transporte.falhas.offline = true;
    const confA = await a.motor.criarConferencia({ unidade_id: LISTA.A });
    expect(await a.motor.encerrar({ apagarDados: true })).toEqual({ apagado: false, pendentes: 1 });
    const b = await aparelho(db, ESTQ_B, { fabrica });
    expect(await b.motor.conferencia(confA)).toBeUndefined();
    expect(await b.motor.fila()).toHaveLength(0);
    await b.motor.encerrar();
    // A volta e a conferência dele ainda está lá, pronta para enviar.
    const a2 = await aparelho(db, ESTQ_A, { fabrica, deviceId: a.deviceId });
    expect((await a2.motor.conferencia(confA))?.status).toBe("em_andamento");
    await sincronizarTudo(a2.motor, filaVazia(a2.motor));
    expect(await eventosNoServidor(confA, "CONFERENCE_CREATED")).toBe(1);
    await a2.motor.encerrar();
  });

  it("a sessão local não guarda tokens e os logs não têm segredos", async () => {
    const fabrica = new IDBFactory();
    const a = await aparelho(db, ESTQ_A, { fabrica });
    await a.motor.log("info", "teste", {
      senha: "123456",
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJhLWZhbHNh",
      nested: {
        refresh_token: "abc",
        texto: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJhLWZhbHNh",
      },
      imagem: ASSINATURA,
    });
    const banco = await BancoLocal.abrir(U.ESTQ_A, fabrica);
    const tudo = JSON.stringify({
      sessao: await banco.todos("sessao"),
      logs: await banco.todos("logs"),
    });
    banco.fechar();
    expect(tudo).not.toMatch(/123456|eyJhbGciOiJIUzI1NiJ9\.eyJ|refresh_token":"abc|base64,iVBOR/);
    expect(tudo).toContain("[removido]");
    await a.motor.encerrar();
  });
});
