/** V2.1 — acessibilidade automática (axe): rótulos, nomes de botões, contraste, ARIA. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { abrirConferencia, prepararBanco } from "./apoio";

test("tela da conferência sem violações de acessibilidade (WCAG A/AA)", async ({ page }) => {
  await prepararBanco(5);
  await abrirConferencia(page);
  await page.getByLabel("QUANTIDADE CONFERIDA").fill("999"); // mostra a divergência também
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  expect(graves).toEqual([]);

  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  const lista = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(lista.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Diálogos: adicionar material e finalizar.
  await page.getByRole("button", { name: "Voltar ao item", exact: true }).first().click();
  await page.getByRole("button", { name: "ADICIONAR MATERIAL" }).click();
  await page.waitForTimeout(400); // fim da animação de abertura (opacidade)
  const add = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(add.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  await page.waitForTimeout(400);
  const fim = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(fim.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
