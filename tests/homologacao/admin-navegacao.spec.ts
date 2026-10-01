/**
 * Central Administrativa no app REAL (login real, Supabase local): visão operacional no topo,
 * grupos compactos, cada grupo em tela própria, módulos inalterados e permissões preservadas.
 */
import { expect, test, type Page } from "@playwright/test";
import { APP_V2, SENHA } from "./ambiente";
import { entrar, sair } from "./apoio";
import { semear, type Usuarios } from "./semear";
import { ADMIN_CATEGORIAS } from "../../src/lib/admin";

const APP = APP_V2;
let u: Usuarios;
test.beforeAll(async () => {
  u = await semear();
});

async function abrirCentral(page: Page) {
  await page.goto(`${APP}/admin`);
  const senha = page.locator('input[type="password"]');
  if (await senha.isVisible({ timeout: 5000 }).catch(() => false)) {
    await senha.fill(SENHA);
    await page.getByRole("button", { name: "Confirmar" }).click();
  }
  await expect(page.getByText("Contagens em andamento")).toBeVisible();
}

async function semRolagemHorizontal(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test("Central: indicadores no topo e só os grupos; cada grupo abre a própria tela", async ({
  page,
}) => {
  await entrar(page, APP, u.admin.email);
  await abrirCentral(page);

  // Visão operacional continua visível ao abrir.
  for (const t of [
    "Contagens em andamento",
    "Alertas pendentes",
    "Metas fora do esperado",
    "Conferências concluídas",
  ]) {
    await expect(page.getByText(t).first()).toBeVisible();
  }
  // Acesso aos módulos: só os grupos (nenhum card de módulo na Central).
  for (const c of ADMIN_CATEGORIAS) await expect(page.getByTestId(`grupo-${c.id}`)).toBeVisible();
  await expect(page.locator('[data-testid^="modulo-"]')).toHaveCount(0);

  for (const c of ADMIN_CATEGORIAS) {
    await page.getByTestId(`grupo-${c.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/grupo/${c.id}$`));
    await expect(page.getByRole("heading", { name: new RegExp(c.titulo) })).toBeVisible();
    await expect(
      page.getByTestId("modulos-do-grupo").locator('[data-testid^="modulo-"]'),
    ).toHaveCount(c.itens.length);

    // Cada módulo abre como antes (mesma rota /admin/<módulo>) e volta para o grupo.
    for (const item of c.itens) {
      await page.getByTestId(`modulo-${item.slug}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/${item.slug}$`));
      await expect(
        page.getByRole("heading", { name: item.titulo, exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Esta área não existe.")).toHaveCount(0);
      await page.getByRole("link", { name: `Voltar para ${c.titulo}` }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/grupo/${c.id}$`));
    }

    await page.getByRole("link", { name: "Voltar para a Central" }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  }
});

test("voltar do navegador/Android e atualizar a página", async ({ page }) => {
  await entrar(page, APP, u.admin.email);
  await abrirCentral(page);
  await page.getByTestId("grupo-gestao").click();
  await page.getByTestId("modulo-usuarios").click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/grupo\/gestao$/);
  await page.reload();
  await expect(page.getByTestId("modulos-do-grupo")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByText("Contagens em andamento")).toBeVisible();
  await page.goto(`${APP}/admin/grupo/nao-existe`);
  await expect(page.getByText("Este grupo não existe.")).toBeVisible();
  await sair(page, APP);
});

test("celular, tablet e desktop, claro e escuro: sem rolagem horizontal", async ({ page }) => {
  await entrar(page, APP, u.admin.email);
  await abrirCentral(page);
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const [w, h] of [
      [320, 640],
      [360, 740],
      [393, 852],
      [768, 1024],
      [1280, 800],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${APP}/admin`);
      await expect(page.getByTestId("grupo-gestao")).toBeVisible();
      await semRolagemHorizontal(page);
      const linha = (await page.getByTestId("grupo-gestao").boundingBox())!;
      expect(linha.height).toBeGreaterThanOrEqual(44); // área de toque
      await page.goto(`${APP}/admin/grupo/gestao`);
      await expect(page.getByTestId("modulo-usuarios")).toBeVisible();
      await semRolagemHorizontal(page);
    }
  }
});

test("permissões: conferente continua sem acesso à Central e às telas de grupo", async ({
  page,
}) => {
  await entrar(page, APP, u.conferenteA.email);
  for (const caminho of [
    "/admin",
    "/admin/grupo/gestao",
    "/admin/grupo/controle",
    "/admin/usuarios",
  ]) {
    await page.goto(`${APP}${caminho}`);
    await expect(page.getByText(/acesso não autorizado/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="modulo-"]')).toHaveCount(0);
  }
});
