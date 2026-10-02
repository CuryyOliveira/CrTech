/** V2.1 — a mesma conferência no desktop: lista e item lado a lado, uso só com teclado. */
import { expect, test } from "@playwright/test";
import {
  abrirConferencia,
  conferenciaNoServidor,
  esperarSincronizado,
  prepararBanco,
  sql,
} from "./apoio";

test.beforeEach(async () => {
  await prepararBanco(20);
});

test("desktop: lista e item visíveis ao mesmo tempo; sem botão de alternar abas", async ({
  page,
}) => {
  await abrirConferencia(page);
  await expect(page.getByTestId("lista-itens")).toBeVisible();
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await expect(page.getByRole("button", { name: /Ver lista de itens/ })).toBeHidden();
  // Clicar na lista abre o item à direita.
  await page.getByLabel("Buscar por código, descrição ou localização").fill("E-0010");
  await page
    .getByTestId("lista-itens")
    .getByRole("option", { name: /E-0010/ })
    .click();
  await expect(page.getByTestId("codigo-atual")).toHaveText("E-0010");
});

test("desktop: só teclado — buscar, Enter, digitar quantidade, Enter confirma e avança", async ({
  page,
}) => {
  await abrirConferencia(page);
  const busca = page.getByLabel("Buscar por código, descrição ou localização");
  await busca.focus();
  await page.keyboard.type("E-0005");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("codigo-atual")).toHaveText("E-0005");
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeFocused();
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("codigo-atual")).not.toHaveText("E-0005");
  await expect(page.getByTestId("progresso")).toHaveText("1 / 23");
  // Foco visível e controles alcançáveis por Tab.
  await page.keyboard.press("Tab");
  const focado = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent,
  );
  expect(focado).toBeTruthy();
  await esperarSincronizado(page);
  const { id } = await conferenciaNoServidor();
  const [i] = await sql<{ q: string }>(
    "SELECT quantidade_contada AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'E-0005'",
    [id],
  );
  expect(i.q).toBe("4");
});
