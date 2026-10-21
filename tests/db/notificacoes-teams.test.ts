/**
 * Notificações pelo Microsoft Teams (migration 20261021120000): configuração somente no servidor
 * (o endereço do fluxo nunca chega ao navegador), um envio por notificação (reserva atômica,
 * sem duplicidade em retry/timeout/agendador) e histórico dos envios e testes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonimo, Banco, servidor, usuario } from "./ambiente";
import { enviar, evento } from "./eventos";
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
const URL_FLUXO =
  "https://prod-00.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=segredo";

type Config = {
  webhook_url: string | null;
  destinatarios: string[];
  ativo: boolean;
  validado_em: string | null;
  validado_por: string | null;
  liberado_em: string | null;
  ultimo_erro: string | null;
};

async function obter(): Promise<Config> {
  const [c] = await db.como(servidor, (q) => q<Config>("SELECT * FROM teams_config_obter()"));
  return c;
}
async function salvar(patch: Record<string, unknown>) {
  await db.como(
    servidor,
    (q) => q("SELECT teams_config_salvar($1::jsonb)", [JSON.stringify(patch)]),
    {
      gravar: true,
    },
  );
}
async function reservar(notif: string, dest: string[] = ["a@alcoeste.com"]) {
  const [r] = await db.como(
    servidor,
    (q) => q<{ ok: boolean }>("SELECT reservar_envio_teams($1, $2) AS ok", [notif, dest]),
    { gravar: true },
  );
  return r.ok;
}
async function concluir(notif: string, ok: boolean) {
  await db.como(
    servidor,
    (q) => q("SELECT concluir_envio_teams($1, $2, 'erro teste')", [notif, ok]),
    {
      gravar: true,
    },
  );
}

/** Uma notificação real (início de conferência criado pelo servidor). */
async function novaNotificacao() {
  const lista = novoId();
  await db.dono(
    `INSERT INTO unidades (id, tipo, nome, frota, placa, setor, empresa_id, modulo_id, gestor)
     SELECT $1, tipo, $2, 'FR-1', 'ABC1D23', 'Oficina', empresa_id, modulo_id, 'Gestor'
       FROM unidades WHERE id = $3`,
    [lista, `Lista ${lista.slice(0, 8)}`, LISTA.A_MOD],
  );
  await db.dono(
    `INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada)
     VALUES ($1, 'M-001', 'Parafuso', 10)`,
    [lista],
  );
  const conf = novoId();
  await enviar(db, estoquista, [
    evento("CONFERENCE_CREATED", conf, {
      unidade_id: lista,
      conferente: "Teste",
      responsavel: "R",
    }),
  ]);
  const [n] = await db.dono<{ id: string }>(
    "SELECT id FROM notificacoes_conferencia WHERE conferencia_id = $1",
    [conf],
  );
  return n.id;
}

describe("Teams: configuração somente no servidor", () => {
  it("existe uma linha padrão, ativa, sem endereço e sem validação", async () => {
    const c = await obter();
    expect(c).toMatchObject({
      webhook_url: null,
      destinatarios: [],
      ativo: true,
      validado_em: null,
    });
  });

  it("salva só as chaves enviadas; trocar o endereço do fluxo invalida a validação", async () => {
    await salvar({ webhook_url: URL_FLUXO, destinatarios: ["a@alcoeste.com", "b@alcoeste.com"] });
    const agora = new Date().toISOString();
    await salvar({ validado_em: agora, validado_por: "a@alcoeste.com", liberado_em: agora });
    let c = await obter();
    expect(c.webhook_url).toBe(URL_FLUXO);
    expect(c.destinatarios).toEqual(["a@alcoeste.com", "b@alcoeste.com"]);
    expect(c.validado_em).not.toBeNull();

    // Só destinatários: mantém endereço e validação.
    await salvar({ destinatarios: ["a@alcoeste.com"] });
    c = await obter();
    expect(c.webhook_url).toBe(URL_FLUXO);
    expect(c.validado_em).not.toBeNull();

    // Mesmo endereço reenviado: não invalida.
    await salvar({ webhook_url: URL_FLUXO });
    expect((await obter()).validado_em).not.toBeNull();

    // Endereço novo: validação e liberação zeradas.
    await salvar({ webhook_url: `${URL_FLUXO}2` });
    c = await obter();
    expect(c).toMatchObject({ validado_em: null, validado_por: null, liberado_em: null });
  });

  it("usuários do app (inclusive o dono) e anônimos não leem nem alteram a configuração", async () => {
    for (const ator of [estoquista, dono, anonimo]) {
      expect((await db.tentar(ator, "SELECT * FROM teams_config_obter()")).ok).toBe(false);
      expect((await db.tentar(ator, "SELECT teams_config_salvar('{}'::jsonb)")).ok).toBe(false);
      expect((await db.tentar(ator, "SELECT * FROM app_private.teams_config")).ok).toBe(false);
      expect((await db.tentar(ator, "SELECT * FROM app_private.teams_envios")).ok).toBe(false);
      expect((await db.tentar(ator, "SELECT * FROM teams_envios_recentes(10)")).ok).toBe(false);
      expect(
        (await db.tentar(ator, "SELECT reservar_envio_teams(gen_random_uuid(), '{}')")).ok,
      ).toBe(false);
    }
  });
});

describe("Teams: um envio por notificação", () => {
  it("chamadas simultâneas: só uma envia; falha libera nova tentativa; enviado nunca repete", async () => {
    const n = await novaNotificacao();
    const paralelas = await Promise.all([1, 2, 3, 4, 5].map(() => reservar(n)));
    expect(paralelas.filter(Boolean)).toHaveLength(1);

    await concluir(n, false); // fluxo indisponível
    const pendentes = await db.como(servidor, (q) =>
      q<{ id: string }>("SELECT teams_envios_pendentes() AS id"),
    );
    expect(pendentes.map((p) => p.id)).toContain(n);

    expect(await reservar(n)).toBe(true); // nova tentativa
    await concluir(n, true);
    expect(await reservar(n)).toBe(false); // já enviado: nunca repete
    const depois = await db.como(servidor, (q) =>
      q<{ id: string }>("SELECT teams_envios_pendentes() AS id"),
    );
    expect(depois.map((p) => p.id)).not.toContain(n);
  });

  it("tentativas esgotadas (5) não são mais reservadas nem reprocessadas", async () => {
    const n = await novaNotificacao();
    for (let i = 0; i < 5; i++) {
      expect(await reservar(n)).toBe(true);
      await concluir(n, false);
    }
    expect(await reservar(n)).toBe(false);
    const pend = await db.como(servidor, (q) =>
      q<{ id: string }>("SELECT teams_envios_pendentes() AS id"),
    );
    expect(pend.map((p) => p.id)).not.toContain(n);
  });

  it("histórico traz envios e testes, com o tipo da notificação", async () => {
    const n = await novaNotificacao();
    await reservar(n, ["x@alcoeste.com"]);
    await concluir(n, true);
    await db.como(
      servidor,
      (q) => q("SELECT registrar_teste_teams($1, false, 'HTTP 404')", [["y@alcoeste.com"]]),
      { gravar: true },
    );
    const h = await db.como(servidor, (q) =>
      q<{
        notificacao_id: string | null;
        tipo: string | null;
        teste: boolean;
        estado: string;
        erro: string | null;
      }>("SELECT * FROM teams_envios_recentes(50)"),
    );
    expect(h.find((r) => r.notificacao_id === n)).toMatchObject({
      tipo: "conferencia_iniciada",
      teste: false,
      estado: "enviado",
    });
    expect(h.find((r) => r.teste && r.erro === "HTTP 404")).toMatchObject({ estado: "falha" });
  });

  it("apagar a notificação apaga o registro de envio (sem órfãos)", async () => {
    const n = await novaNotificacao();
    await reservar(n);
    await db.dono("DELETE FROM notificacoes_conferencia WHERE id = $1", [n]);
    const r = await db.dono("SELECT 1 FROM app_private.teams_envios WHERE notificacao_id = $1", [
      n,
    ]);
    expect(r).toHaveLength(0);
  });
});
