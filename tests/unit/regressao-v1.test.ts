/**
 * Regressão da V1 (sem banco): regras usadas pelas telas que a Fase 0 não pode quebrar.
 *  - hierarquia de perfis (frontend) idêntica à do banco (app_private.nivel_perfil);
 *  - importação de planilha (coluna de quantidade, números, ordenação por locação);
 *  - login offline (cofre criptografado);
 *  - fila offline (comportamento atual documentado para a V2.2/V2.3).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { NIVEL, NIVEIS, PERFIS, nivelDe, temNivel, type Perfil } from "@/lib/permissions";
import { acharColunaQuantidade, normalize, ordenarPorLocacao, pick, toNumero } from "@/lib/app";

const RAIZ = path.resolve(__dirname, "../..");

describe("hierarquia de perfis: frontend = banco", () => {
  it("NIVEL (src/lib/permissions.ts) é igual a app_private.nivel_perfil (baseline)", () => {
    const sql = readFileSync(
      path.join(RAIZ, "supabase/migrations/20260929120000_baseline_v2.sql"),
      "utf-8",
    );
    const bloco = sql.slice(
      sql.indexOf("FUNCTION app_private.nivel_perfil"),
      sql.indexOf("ELSE 0 END", sql.indexOf("FUNCTION app_private.nivel_perfil")),
    );
    const banco = Object.fromEntries(
      [...bloco.matchAll(/WHEN '(\w+)' THEN (\d)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(banco).toEqual(NIVEL);
  });

  it("proprietário é nível 6, acima do super administrador (5)", () => {
    expect(nivelDe("proprietario")).toBe(6);
    expect(nivelDe("super_admin")).toBe(5);
    expect(NIVEIS[0]).toEqual({ nivel: 6, label: "Proprietário do Sistema" });
    expect(temNivel("administrador", NIVEL.administrador)).toBe(true);
    expect(temNivel("gestor", NIVEL.administrador)).toBe(false);
  });

  it("o perfil de Proprietário não é atribuível pela tela de usuários", () => {
    expect(PERFIS.map((p) => p.valor)).not.toContain("proprietario" as Perfil);
  });
});

describe("importação de planilha (materiais)", () => {
  it("encontra a coluna de quantidade por várias grafias", () => {
    expect(acharColunaQuantidade([{ Código: "1", "QTDE. ESPERADA": "3" }])).toBe("QTDE. ESPERADA");
    expect(acharColunaQuantidade([{ codigo: "1", Saldo: "3" }])).toBe("Saldo");
    expect(acharColunaQuantidade([{ codigo: "1", descricao: "x" }])).toBeNull();
  });

  it("converte números no formato brasileiro e recusa texto", () => {
    expect(toNumero("1.234,5")).toBe(1234.5);
    expect(toNumero("10")).toBe(10);
    expect(toNumero(7)).toBe(7);
    expect(toNumero("abc")).toBeNull();
  });

  it("lê colunas com nomes aproximados", () => {
    expect(pick({ "Código do Item": "P-1", Descrição: "Parafuso" }, ["codigo"])).toBe("P-1");
    expect(pick({ Material: "Porca" }, ["descricao", "material"])).toBe("Porca");
  });

  it("normaliza texto para pesquisa (acentos e caixa)", () => {
    expect(normalize("  Ação ")).toBe("acao");
  });

  it("ordena por locação em ordem natural (A2 antes de A10)", () => {
    const r = ordenarPorLocacao([
      { locacao: "A10", codigo: "3" },
      { locacao: "A2", codigo: "2" },
      { locacao: null, codigo: "9" },
      { locacao: "A1", codigo: "1" },
    ]);
    expect(r.map((x) => x.locacao)).toEqual(["A1", "A2", "A10", null]);
  });
});

describe("login offline (cofre local)", () => {
  beforeAll(() => {
    const mem = new Map<string, string>();
    const armazenamento = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    Object.assign(globalThis, {
      window: globalThis,
      localStorage: armazenamento,
      sessionStorage: armazenamento,
    });
  });

  it("valida a senha correta, recusa a errada e não guarda a senha em texto", async () => {
    const { salvarCofre, validarCofre } = await import("@/lib/offline/cofre");
    const dados = {
      userId: "u1",
      email: "ana@empresa.com",
      nome: "Ana",
      matricula: null,
      perfil: "agricola",
      setor: null,
      unidades: [],
      token: null,
      refreshToken: null,
      validadoEm: new Date().toISOString(),
    };
    expect(await salvarCofre("Senha#Forte1", dados)).toBe(true);
    const bruto = localStorage.getItem("cr:cofre:ana@empresa.com") ?? "";
    expect(bruto).not.toContain("Senha#Forte1");
    expect(bruto).not.toContain("Ana");
    expect((await validarCofre("ana@empresa.com", "Senha#Forte1"))?.userId).toBe("u1");
    expect(await validarCofre("ana@empresa.com", "errada")).toBeNull();
    expect(await validarCofre("outra@empresa.com", "Senha#Forte1")).toBeNull();
  }, 20_000);
});

describe("fila offline da V1 (comportamento atual documentado)", () => {
  it("enfileira, deduplica a mesma operação e aplica espera progressiva após falha", async () => {
    const { enfileirar, lerFila, marcarTentativa, podeTentar, gravarFila } =
      await import("@/lib/offline/fila");
    gravarFila([]);
    const op = {
      tabela: "conferencias",
      tipo: "update" as const,
      payload: { status: "finalizada" },
      filtros: [{ coluna: "id", valor: "c1" }],
    };
    enfileirar(op);
    enfileirar(op); // duplo clique: uma só operação
    expect(lerFila()).toHaveLength(1);
    const id = lerFila()[0].id;
    marcarTentativa(id, "falhou");
    expect(podeTentar(lerFila()[0])).toBe(false);
    expect(lerFila()[0].tentativas).toBe(1);
  });

  it("LIMITAÇÃO CONHECIDA (R-03, corrigir na V2.3): pausar→retomar→pausar offline perde a 2ª pausa", async () => {
    const { enfileirar, lerFila, gravarFila } = await import("@/lib/offline/fila");
    gravarFila([]);
    const alvo = [{ coluna: "id", valor: "c1" }];
    enfileirar({
      tabela: "conferencias",
      tipo: "update",
      payload: { status: "pausada" },
      filtros: alvo,
    });
    enfileirar({
      tabela: "conferencias",
      tipo: "update",
      payload: { status: "em_andamento" },
      filtros: alvo,
    });
    enfileirar({
      tabela: "conferencias",
      tipo: "update",
      payload: { status: "pausada" },
      filtros: alvo,
    });
    expect(lerFila().map((o) => (o.payload as { status: string }).status)).toEqual([
      "pausada",
      "em_andamento",
    ]);
  });
});
