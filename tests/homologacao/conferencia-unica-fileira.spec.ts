/**
 * Conferência única por PRATELEIRA e FILEIRA no app REAL: módulo → lista → prateleira → fileira.
 * A fileira vale só dentro da prateleira: P02 + B nunca traz P01/B nem P03/B.
 */
import { expect, test, type Page } from "@playwright/test";
import { APP_V2, sql } from "./ambiente";
import { entrar } from "./apoio";
import { EMPRESA_H, LISTAS, MODULO_H, semear, type Usuarios } from "./semear";

const APP = APP_V2;
const LISTA_PRATELEIRA = "00000000-0000-4000-8000-0000000a0f01";
let u: Usuarios;

async function cancelarUnicas() {
  await sql(
    `UPDATE conferencias SET status = 'cancelada', hora_fim = now()
      WHERE status IN ('em_andamento','pausada')
        AND unidade_id IN (SELECT id FROM unidades WHERE nome LIKE 'Conferência única%')`,
  );
}

test.beforeAll(async () => {
  u = await semear();
  await sql(
    `INSERT INTO unidades (id, tipo, nome, empresa_id, modulo_id, gestor, ativo)
     VALUES ($1, 'frota', 'Homolog Prateleira', $2, $3, 'Gestor Homolog', true)
     ON CONFLICT (id) DO UPDATE SET ativo = true`,
    [LISTA_PRATELEIRA, EMPRESA_H, MODULO_H],
  );
  await sql("DELETE FROM materiais WHERE unidade_id = $1", [LISTA_PRATELEIRA]);
  // Cenário "ABRASIVOS": B existe em P01, P02 e P03; P05 - PAREDE não tem letra.
  const itens: [string, string][] = [
    ["F-P01A01", "P01 − A01"],
    ["F-P01B01", "P01 - B01"],
    ["F-P01B02", "P01 - B02"],
    ["F-P02A01", "P02 - A01"],
    ["F-P02B01", "P02 – B01"],
    ["F-P02B02", "P02 - B02"],
    ["F-P03B01", "P03 - B01"],
    ["F-P05PAR", "P05 - PAREDE"],
  ];
  for (const [codigo, locacao] of itens) {
    await sql(
      `INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada, locacao)
       VALUES ($1, $2, 'Item ' || $2, 1, $3)`,
      [LISTA_PRATELEIRA, codigo, locacao],
    );
  }
  await cancelarUnicas();
});

test.afterAll(async () => {
  await cancelarUnicas();
});

async function abrirLista(page: Page) {
  await page.goto(`${APP}/conferencia-unica`);
  await page.getByRole("button", { name: /Frota Homologação/ }).click();
  await page.getByText("Homolog Prateleira").click();
  await expect(page.getByTestId("etapa-prateleiras")).toBeVisible();
}

async function conferenciaAberta() {
  const [conf] = await sql<{ id: string; observacoes: string | null }>(
    `SELECT c.id, c.observacoes FROM conferencias c JOIN unidades un ON un.id = c.unidade_id
      WHERE un.nome LIKE 'Conferência única%' AND c.status = 'em_andamento'
      ORDER BY c.created_at DESC LIMIT 1`,
  );
  const itens = await sql<{ codigo: string }>(
    "SELECT codigo FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conf.id],
  );
  return { observacoes: conf.observacoes, codigos: itens.map((i) => i.codigo) };
}

test("lista → prateleira P02 → fileira B: só P02/B entra (nunca P01/B nem P03/B)", async ({
  page,
}) => {
  await entrar(page, APP, u.conferenteA.email);
  await page.goto(`${APP}/conferencia-unica`);
  await page.getByRole("button", { name: /Frota Homologação/ }).click();

  // Lista sem locações de prateleira: nenhuma etapa nova aparece.
  await page.getByText(LISTAS.pequena.nome).click();
  await expect(page.getByTestId("etapa-prateleiras")).toHaveCount(0);
  await page.getByText(LISTAS.pequena.nome).click(); // desmarca

  await page.getByText("Homolog Prateleira").click();
  const prateleiras = page.getByTestId("etapa-prateleiras");
  await expect(prateleiras).toBeVisible();
  await expect(page.getByTestId("prateleira-P01")).toContainText("(3)");
  await expect(page.getByTestId("prateleira-P02")).toContainText("(3)");
  await expect(page.getByTestId("prateleira-P03")).toContainText("(1)");
  await expect(page.getByTestId("prateleira-P05")).toContainText("(1)");
  // A fileira só aparece depois de escolher a prateleira (nada de letra global).
  await expect(page.getByTestId("etapa-fileiras")).toHaveCount(0);
  await expect(page.getByTestId("resumo-selecao")).toContainText("8 itens");

  await page.getByTestId("prateleira-P02").click();
  await expect(page.getByTestId("prateleira-P02")).toHaveAttribute("aria-pressed", "true");
  const fileiras = page.getByTestId("etapa-fileiras");
  await expect(fileiras).toContainText("P02");
  // Contadores só de P02: A (1), B (2) — e nenhuma letra de outras prateleiras.
  await expect(page.getByTestId("fileira-A")).toContainText("(1)");
  await expect(page.getByTestId("fileira-B")).toContainText("(2)");
  await expect(fileiras.getByRole("button")).toHaveCount(2);
  await expect(page.getByTestId("resumo-selecao")).toContainText("3 itens");

  await page.getByTestId("fileira-B").click();
  await expect(page.getByTestId("resumo-selecao")).toContainText(
    "2 itens serão conferidos · Prateleiras: P02 | Fileiras: B",
  );

  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });

  const r = await conferenciaAberta();
  expect(r.observacoes).toBe("Prateleiras: P02 | Fileiras: B");
  expect(r.codigos).toEqual(["F-P02B01", "F-P02B02"]);
  expect(r.codigos.filter((c) => /^F-P0[13]B/.test(c))).toEqual([]);
});

test("só a prateleira P02: entra toda a prateleira", async ({ page }) => {
  await cancelarUnicas();
  await entrar(page, APP, u.conferenteA.email);
  await abrirLista(page);
  await page.getByTestId("prateleira-P02").click();
  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });
  const r = await conferenciaAberta();
  expect(r.observacoes).toBe("Prateleiras: P02");
  expect(r.codigos).toEqual(["F-P02A01", "F-P02B01", "F-P02B02"]);
});

test("P01 + P03 com fileira B: (P01 e B) ou (P03 e B)", async ({ page }) => {
  await cancelarUnicas();
  await entrar(page, APP, u.conferenteA.email);
  await abrirLista(page);
  await page.getByTestId("prateleira-P01").click();
  await page.getByTestId("prateleira-P03").click();
  await expect(page.getByTestId("fileira-B")).toContainText("(3)");
  await page.getByTestId("fileira-B").click();
  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });
  const r = await conferenciaAberta();
  expect(r.observacoes).toBe("Prateleiras: P01, P03 | Fileiras: B");
  expect(r.codigos).toEqual(["F-P01B01", "F-P01B02", "F-P03B01"]);
});

test("sem filtro: entram todos os itens da lista (comportamento anterior)", async ({ page }) => {
  await cancelarUnicas();
  await entrar(page, APP, u.conferenteA.email);
  await abrirLista(page);
  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });
  const r = await conferenciaAberta();
  expect(r.observacoes).toBeNull();
  expect(r.codigos).toHaveLength(8);
});
