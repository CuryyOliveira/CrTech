/** V2.1 — acessibilidade automática (axe): rótulos, nomes de botões, contraste, ARIA. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { abrirConferencia, prepararBanco } from "./apoio";

/** Espera transições/animações CSS terminarem: no meio de uma transição de cor (ex.: botão
 * que acabou de ficar selecionado) o contraste medido é o de uma cor intermediária. */
async function semAnimacoes(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}

async function analisar(page: Page, tags: string[], incluir?: string) {
  await semAnimacoes(page);
  let b = new AxeBuilder({ page }).withTags(tags);
  if (incluir) b = b.include(incluir);
  const r = await b.analyze();
  // Mensagem com o elemento e o motivo, para diagnosticar qualquer falha no CI.
  return r.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} — ${n.any[0]?.message ?? v.help}`),
  );
}

test("tela da conferência sem violações de acessibilidade (WCAG A/AA)", async ({ page }) => {
  await prepararBanco(5);
  await abrirConferencia(page);
  await page.getByLabel("QUANTIDADE CONFERIDA").fill("999"); // mostra a divergência também
  expect(await analisar(page, ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])).toEqual([]);

  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  expect(await analisar(page, ["wcag2a", "wcag2aa"])).toEqual([]);

  // Diálogos: adicionar material e finalizar.
  await page.getByRole("button", { name: "Voltar ao item", exact: true }).first().click();
  await page.getByRole("button", { name: "ADICIONAR MATERIAL" }).click();
  await page.getByRole("dialog").waitFor();
  expect(await analisar(page, ["wcag2a", "wcag2aa"], '[role="dialog"]')).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  await page.getByRole("dialog").waitFor();
  expect(await analisar(page, ["wcag2a", "wcag2aa"], '[role="dialog"]')).toEqual([]);
});

test("todos os estados (sincronização e status do item) têm contraste AA, claro e escuro", async ({
  page,
}) => {
  await page.goto("/?vitrine=1");
  await page.getByRole("heading", { name: "Vitrine" }).waitFor();
  expect(await analisar(page, ["wcag2a", "wcag2aa"])).toEqual([]);
});
