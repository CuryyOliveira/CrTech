/**
 * Notificações de início/término criadas pelo SERVIDOR (migration 20260930120000):
 * uma por conferência e tipo, somente após o COMMIT, sem depender do aparelho, com o
 * relatório completo; reserva atômica de cada e-mail (sem duplicidade em retry/timeout).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Banco, servidor, usuario } from "./ambiente";
import { ASSINATURA, enviar, evento, minutos } from "./eventos";
import { LISTA, U, novoId } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const estoquista = usuario(U.ESTQ_A);
const dono = usuario(U.DONO);

type Notif = {
  id: string;
  tipo: string;
  chave: string | null;
  email_status: string;
  status: string;
  payload: Record<string, unknown>;
};

/** Lista nova (cópia da lista de módulo da empresa A) com dois materiais. */
async function novaLista(frota: string | null = "FR-1204") {
  const id = novoId();
  await db.dono(
    `INSERT INTO unidades (id, tipo, nome, frota, placa, setor, empresa_id, modulo_id, gestor)
     SELECT $1, tipo, $2, $3, 'ABC1D23', 'Oficina Central', empresa_id, modulo_id, 'Gestor Padrão'
       FROM unidades WHERE id = $4`,
    [id, `Lista ${id.slice(0, 8)}`, frota, LISTA.A_MOD],
  );
  await db.dono(
    `INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada)
     VALUES ($1, 'M-001', 'Parafuso 10mm', 10), ($1, 'M-002', 'Porca 10mm', 5)`,
    [id],
  );
  return id;
}

async function notificacoes(conferencia: string) {
  return db.dono<Notif>(
    `SELECT id, tipo, chave, email_status, status, payload FROM notificacoes_conferencia
      WHERE conferencia_id = $1 ORDER BY created_at, tipo`,
    [conferencia],
  );
}

async function itens(conferencia: string) {
  return db.dono<{ id: string; codigo: string }>(
    "SELECT id, codigo FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conferencia],
  );
}

function criar(conf: string, lista: string, quando = new Date(), id?: string) {
  return evento(
    "CONFERENCE_CREATED",
    conf,
    { unidade_id: lista, conferente: "Lenílson", responsavel: "Fernando Guedis" },
    { quando, id },
  );
}

describe("início: criado pelo servidor após a confirmação", () => {
  it("V2: um aviso de início com o relatório (responsável, conferente, lista, local, frota, itens)", async () => {
    const lista = await novaLista();
    const conf = novoId();
    const [r] = await enviar(db, estoquista, [criar(conf, lista)]);
    expect(r.status).toBe("aplicado");

    const ns = await notificacoes(conf);
    expect(ns.map((n) => n.tipo)).toEqual(["conferencia_iniciada"]);
    const n = ns[0];
    expect(n.chave).toBe(`srv:${conf}:conferencia_iniciada`);
    expect(n.email_status).toBe("pendente");
    expect(n.status).toBe("em_andamento");
    expect(n.payload).toMatchObject({
      origem: "servidor",
      responsavel: "Fernando Guedis",
      conferente: "Lenílson",
      lista: expect.stringContaining("Lista "),
      setor: "Oficina Central",
      frota: "FR-1204",
      placa: "ABC1D23",
      previstos: 2,
      divergentes: 0,
      status: "em_andamento",
    });
    expect(n.payload.inicio).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(n.payload.empresa_nome).toBeTruthy();
  });

  it("duplicidade: reenvio do mesmo evento e nova tentativa não criam segundo aviso", async () => {
    const lista = await novaLista();
    const conf = novoId();
    const e = criar(conf, lista);
    await enviar(db, estoquista, [e]);
    const [dup] = await enviar(db, estoquista, [e]); // retry/timeout: mesmo event_id
    expect(dup.duplicado).toBe(true);
    await enviar(db, estoquista, [criar(conf, lista)]); // outro event_id, mesma conferência
    expect(
      (await notificacoes(conf)).filter((n) => n.tipo === "conferencia_iniciada"),
    ).toHaveLength(1);
  });

  it("transação desfeita não gera aviso (nem pedido de envio)", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await db.como(estoquista, async (q) => {
      await q("SELECT processar_eventos_conferencia($1)", [JSON.stringify([criar(conf, lista)])]);
    }); // ROLLBACK
    expect(await notificacoes(conf)).toHaveLength(0);
  });

  it("V1 (gravação direta): aviso de início criado no COMMIT, já com os itens gravados", async () => {
    const lista = await novaLista(null);
    const conf = novoId();
    await db.como(
      estoquista,
      async (q) => {
        await q(
          "INSERT INTO conferencias (id, unidade_id, created_by, conferente, responsavel) VALUES ($1, $2, $3, 'Ana', 'Bruno')",
          [conf, lista, U.ESTQ_A],
        );
        await q(
          `INSERT INTO conferencia_itens (conferencia_id, material_id, codigo, descricao, quantidade_esperada)
           SELECT $1, id, codigo, descricao, quantidade_esperada FROM materiais WHERE unidade_id = $2`,
          [conf, lista],
        );
      },
      { gravar: true },
    );
    const [n] = await notificacoes(conf);
    expect(n.tipo).toBe("conferencia_iniciada");
    expect(n.payload).toMatchObject({
      responsavel: "Bruno",
      conferente: "Ana",
      previstos: 2,
      frota: null,
    });
  });
});

describe("término: criado pelo servidor ao confirmar a finalização", () => {
  it("finalização gera conclusão (e divergência) uma única vez, mesmo com retry e refinalização", async () => {
    const lista = await novaLista();
    const conf = novoId();
    const t0 = new Date(Date.now() - 30 * 60_000);
    await enviar(db, estoquista, [criar(conf, lista, t0)]);
    const [m1, m2] = await itens(conf);
    const finalizar = evento("CONFERENCE_FINALIZED", conf, {}, { quando: minutos(t0, 20) });
    await enviar(db, estoquista, [
      evento("ITEM_COUNTED", conf, { item_id: m1.id, quantidade: 10 }, { quando: minutos(t0, 5) }),
      evento("ITEM_COUNTED", conf, { item_id: m2.id, quantidade: 3 }, { quando: minutos(t0, 6) }),
      evento("SIGNATURE_ADDED", conf, { imagem: ASSINATURA }, { quando: minutos(t0, 19) }),
      finalizar,
    ]);
    await enviar(db, estoquista, [finalizar]); // reenvio (resposta perdida)

    // Proprietário reabre e finaliza de novo: não repete o aviso de conclusão.
    await db.como(dono, (q) => q("SELECT reabrir_conferencia($1, 'Ajuste de teste')", [conf]), {
      gravar: true,
    });
    await db.como(
      dono,
      (q) =>
        q("UPDATE conferencias SET status = 'finalizada', hora_fim = now() WHERE id = $1", [conf]),
      { gravar: true },
    );

    const ns = await notificacoes(conf);
    expect(ns.map((n) => n.tipo).sort()).toEqual([
      "conferencia_concluida",
      "conferencia_iniciada",
      "divergencia_estoque",
    ]);
    const fim = ns.find((n) => n.tipo === "conferencia_concluida")!;
    expect(fim.chave).toBe(`srv:${conf}:conferencia_concluida`);
    expect(fim.status).toBe("finalizada");
    expect(fim.payload).toMatchObject({
      responsavel: "Fernando Guedis",
      conferente: "Lenílson",
      previstos: 2,
      corretos: 1,
      divergentes: 1,
      faltantes: 1,
      status: "finalizada",
      duracao_segundos: 20 * 60,
      divergencias: [{ codigo: "M-002", descricao: "Porca 10mm", esperada: 5, encontrada: 3 }],
    });
    expect(fim.payload.fim).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  it("offline: criado e finalizado sem internet, sincronizado depois num único lote", async () => {
    const lista = await novaLista();
    const conf = novoId();
    const t0 = new Date(Date.now() - 3 * 3600_000); // aparelho ficou 3 h sem internet
    const [a] = [novoId()];
    const eventos = [criar(conf, lista, t0, a)];
    // Os itens só existem no servidor depois do CREATED; o aparelho conta pelo material_id.
    const mats = await db.dono<{ id: string; quantidade_esperada: number }>(
      "SELECT id, quantidade_esperada FROM materiais WHERE unidade_id = $1",
      [lista],
    );
    for (const [i, m] of mats.entries()) {
      eventos.push(
        evento(
          "ITEM_COUNTED",
          conf,
          { material_id: m.id, quantidade: m.quantidade_esperada },
          { quando: minutos(t0, 2 + i) },
        ),
      );
    }
    eventos.push(
      evento("SIGNATURE_ADDED", conf, { imagem: ASSINATURA }, { quando: minutos(t0, 9) }),
    );
    eventos.push(evento("CONFERENCE_FINALIZED", conf, {}, { quando: minutos(t0, 10) }));
    const rs = await enviar(db, estoquista, eventos);
    expect(rs.every((r) => r.status === "aplicado")).toBe(true);

    const ns = await notificacoes(conf);
    expect(ns.map((n) => n.tipo).sort()).toEqual(["conferencia_concluida", "conferencia_iniciada"]);
    const ini = ns.find((n) => n.tipo === "conferencia_iniciada")!;
    const fim = ns.find((n) => n.tipo === "conferencia_concluida")!;
    // Horários do aparelho (não a hora da sincronização).
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(d)
        .replace(",", "");
    expect(ini.payload.inicio).toBe(fmt(t0));
    expect(fim.payload.fim).toBe(fmt(minutos(t0, 10)));
    expect(fim.payload).toMatchObject({ corretos: 2, divergentes: 0, duracao_segundos: 600 });
  });

  it("cancelamento não gera aviso de conclusão", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await enviar(db, estoquista, [criar(conf, lista)]);
    await enviar(db, estoquista, [
      evento("CONFERENCE_CANCELLED", conf, { motivo: "Teste de cancelamento" }),
    ]);
    expect((await notificacoes(conf)).map((n) => n.tipo)).toEqual(["conferencia_iniciada"]);
  });

  it("carga de dados antigos (restauração) não gera avisos", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await db.dono(
      `INSERT INTO conferencias (id, unidade_id, created_by, hora_inicio, status, hora_fim, assinatura)
       VALUES ($1, $2, $3, now() - interval '30 days', 'finalizada', now() - interval '30 days', 'x')`,
      [conf, lista, U.ESTQ_A],
    );
    expect(await notificacoes(conf)).toHaveLength(0);
  });
});

describe("gravação pelo aparelho (versões antigas do app)", () => {
  it("início/conclusão/divergência gravados pelo aparelho são ignorados sem erro; erro continua", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await enviar(db, estoquista, [criar(conf, lista)]);
    for (const tipo of [
      "conferencia_iniciada",
      "conferencia_concluida",
      "divergencia_estoque",
      "erro_conferencia",
    ]) {
      const r = await db.tentar(
        estoquista,
        `INSERT INTO notificacoes_conferencia (conferencia_id, unidade_id, tipo, user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [conf, lista, tipo, U.ESTQ_A],
        { gravar: true },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.linhas).toHaveLength(tipo === "erro_conferencia" ? 1 : 0);
    }
    expect((await notificacoes(conf)).map((n) => n.tipo).sort()).toEqual([
      "conferencia_iniciada",
      "erro_conferencia",
    ]);
  });
});

describe("envio de e-mail: reserva atômica por destinatário", () => {
  async function reservar(notif: string, dest: string) {
    const [r] = await db.como(
      servidor,
      (q) => q<{ ok: boolean }>("SELECT reservar_envio_email($1, $2) AS ok", [notif, dest]),
      { gravar: true },
    );
    return r.ok;
  }
  async function concluir(notif: string, dest: string, ok: boolean) {
    await db.como(
      servidor,
      (q) => q("SELECT concluir_envio_email($1, $2, $3, 'erro teste')", [notif, dest, ok]),
      {
        gravar: true,
      },
    );
  }

  it("chamadas repetidas/simultâneas: só a primeira envia; falha libera nova tentativa; enviado nunca repete", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await enviar(db, estoquista, [criar(conf, lista)]);
    const [n] = await notificacoes(conf);
    const dest = "Lucasaranttess@gmail.com ";

    const paralelas = await Promise.all([1, 2, 3, 4, 5].map(() => reservar(n.id, dest)));
    expect(paralelas.filter(Boolean)).toHaveLength(1);

    await concluir(n.id, dest, false); // provedor falhou
    expect(await reservar(n.id, dest)).toBe(true); // retry permitido
    await concluir(n.id, dest, true);
    expect(await reservar(n.id, dest)).toBe(false); // já enviado: nunca repete
    expect(await reservar(n.id, "lucasaranttess@gmail.com")).toBe(false); // mesmo endereço normalizado

    // Outro destinatário é independente.
    expect(await reservar(n.id, "lucas.oliveira@alcoeste.com")).toBe(true);
  });

  it("reserva abandonada (queda do servidor) é retomada após 10 minutos; tentativas limitadas", async () => {
    const lista = await novaLista();
    const conf = novoId();
    await enviar(db, estoquista, [criar(conf, lista)]);
    const [n] = await notificacoes(conf);
    expect(await reservar(n.id, "a@x.com")).toBe(true);
    expect(await reservar(n.id, "a@x.com")).toBe(false);
    await db.dono(
      "UPDATE app_private.envios_email SET reservado_em = now() - interval '11 minutes' WHERE notificacao_id = $1",
      [n.id],
    );
    expect(await reservar(n.id, "a@x.com")).toBe(true);
    for (let i = 0; i < 6; i++) {
      await concluir(n.id, "a@x.com", false);
      await reservar(n.id, "a@x.com");
    }
    await concluir(n.id, "a@x.com", false);
    expect(await reservar(n.id, "a@x.com")).toBe(false); // 5 tentativas esgotadas
  });

  it("usuários do app não acessam a reserva nem o relatório do servidor", async () => {
    const r1 = await db.tentar(
      estoquista,
      "SELECT reservar_envio_email(gen_random_uuid(), 'a@x.com')",
    );
    expect(r1.ok).toBe(false);
    const r2 = await db.tentar(estoquista, "SELECT relatorio_notificacao(gen_random_uuid())");
    expect(r2.ok).toBe(false);
    const r3 = await db.tentar(estoquista, "SELECT * FROM app_private.envios_email");
    expect(r3.ok).toBe(false);
  });
});
