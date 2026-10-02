/**
 * Conferência única por fileira (letra da locação) no app REAL: módulo → lista → fileira.
 * "P01 − A01" é a fileira A; só os itens das fileiras marcadas entram na conferência.
 */
import { expect, test } from "@playwright/test";
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
  const itens: [string, string][] = [
    ["F-A1", "P01 − A01"],
    ["F-A2", "P01 − A02"],
    ["F-B1", "P01 − B01"],
    ["F-B2", "P01 - B02"],
    ["F-B3", "P02 – B03"],
    ["F-X1", "P05 - PAREDE"],
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

test("módulo → lista → fileira B: só os itens da fileira B entram", async ({ page }) => {
  await entrar(page, APP, u.conferenteA.email);
  await page.goto(`${APP}/conferencia-unica`);
  await page.getByRole("button", { name: /Frota Homologação/ }).click();

  // Só a lista pequena (locações sem fileira): a etapa de fileira não aparece.
  await page.getByText(LISTAS.pequena.nome).click();
  await expect(page.getByTestId("etapa-fileiras")).toHaveCount(0);
  await page.getByText(LISTAS.pequena.nome).click(); // desmarca

  // Lista de prateleira: fileiras A (2) e B (3); 1 item sem fileira.
  await page.getByText("Homolog Prateleira").click();
  const etapa = page.getByTestId("etapa-fileiras");
  await expect(etapa).toBeVisible();
  await expect(page.getByTestId("fileira-A")).toContainText("(2)");
  await expect(page.getByTestId("fileira-B")).toContainText("(3)");
  await expect(etapa).toContainText("1 item sem fileira");

  await page.getByTestId("fileira-B").click();
  await expect(page.getByTestId("fileira-B")).toHaveAttribute("aria-pressed", "true");
  await expect(etapa).toContainText("Conferindo só a fileira B");

  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });

  const [conf] = await sql<{ id: string; observacoes: string | null }>(
    `SELECT c.id, c.observacoes FROM conferencias c JOIN unidades un ON un.id = c.unidade_id
      WHERE un.nome LIKE 'Conferência única%' AND c.status = 'em_andamento'
      ORDER BY c.created_at DESC LIMIT 1`,
  );
  expect(conf.observacoes).toBe("Fileiras: B");
  const itens = await sql<{ codigo: string }>(
    "SELECT codigo FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conf.id],
  );
  expect(itens.map((i) => i.codigo)).toEqual(["F-B1", "F-B2", "F-B3"]);
});

test("sem fileira marcada: entram todos os itens da lista (comportamento anterior)", async ({
  page,
}) => {
  await cancelarUnicas();
  await entrar(page, APP, u.conferenteA.email);
  await page.goto(`${APP}/conferencia-unica`);
  await page.getByRole("button", { name: /Frota Homologação/ }).click();
  await page.getByText("Homolog Prateleira").click();
  await expect(page.getByTestId("etapa-fileiras")).toBeVisible();
  await page.getByRole("button", { name: "Iniciar conferência única" }).click();
  await page.waitForURL(/\/unidade\//, { timeout: 30_000 });
  const [conf] = await sql<{ id: string; observacoes: string | null }>(
    `SELECT c.id, c.observacoes FROM conferencias c JOIN unidades un ON un.id = c.unidade_id
      WHERE un.nome LIKE 'Conferência única%' AND c.status = 'em_andamento'
      ORDER BY c.created_at DESC LIMIT 1`,
  );
  expect(conf.observacoes).toBeNull();
  const [{ n }] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1",
    [conf.id],
  );
  expect(n).toBe(6);
});
