/** Limite persistente de registros de tentativa de login (usado só pelo servidor). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonimo, Banco, servidor, usuario } from "./ambiente";
import { U } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const chave = "e:" + "a".repeat(64);
const consumir = (max = 3, janela = 900) =>
  db.tentar<{ ok: boolean }>(
    servidor,
    "SELECT consumir_limite_tentativa($1, $2, $3) AS ok",
    [chave, max, janela],
    { gravar: true },
  );

describe("consumir_limite_tentativa", () => {
  it("permite até o máximo e bloqueia depois, dentro da janela", async () => {
    const resultados = [];
    for (let i = 0; i < 5; i++) {
      const r = await consumir();
      resultados.push(r.ok ? r.linhas[0].ok : null);
    }
    expect(resultados).toEqual([true, true, true, false, false]);
  });

  it("a janela expira e a contagem recomeça", async () => {
    await db.dono(
      "UPDATE app_private.limites_tentativa SET janela_inicio = now() - interval '1 hour' WHERE chave = $1",
      [chave],
    );
    const r = await consumir();
    expect(r.ok && r.linhas[0].ok).toBe(true);
  });

  it("guarda só o hash recebido (nenhum e-mail ou IP em texto)", async () => {
    const linhas = await db.dono("SELECT chave FROM app_private.limites_tentativa");
    expect(linhas.every((l) => /^[ei]:[0-9a-f]{64}$/.test(l.chave))).toBe(true);
  });

  it("chaves inválidas não contam nem passam", async () => {
    const r = await db.tentar<{ ok: boolean }>(
      servidor,
      "SELECT consumir_limite_tentativa('curta', 3, 60) AS ok",
    );
    expect(r.ok && r.linhas[0].ok).toBe(false);
  });

  it("usuários comuns e anônimos não executam a função nem leem a tabela", async () => {
    expect(
      (await db.tentar(usuario(U.ESTQ_A), "SELECT consumir_limite_tentativa($1, 3, 60)", [chave]))
        .ok,
    ).toBe(false);
    expect(
      (await db.tentar(anonimo, "SELECT consumir_limite_tentativa($1, 3, 60)", [chave])).ok,
    ).toBe(false);
    expect(
      (await db.tentar(usuario(U.DONO), "SELECT * FROM app_private.limites_tentativa")).ok,
    ).toBe(false);
  });
});
