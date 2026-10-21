/**
 * Aviso de nova versão do APK (harness com ?aviso=1).
 * O canal nativo do Android é simulado: as mensagens enviadas ao "app" ficam em window.__msgs.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { contar, EMPRESA_A, esperarSincronizado, LISTA_A, prepararBanco, U } from "./apoio";

const OFICIAL = "https://github.com/CuryyOliveira/CrTech/releases";

async function simularApp(
  page: Page,
  instalada: { versionName: string; versionCode: number } | null,
) {
  await page.addInitScript((v) => {
    const w = window as unknown as Record<string, unknown>;
    w.__msgs = [];
    w.CRNativo = { postMessage: (m: string) => (w.__msgs as string[]).push(m) };
    w.__crAndroid = true;
    if (v) w.__crVersaoApp = Object.freeze(v);
  }, instalada);
  let consultas = 0;
  await page.route("**/api/public/versao-android", (rota) => {
    consultas++;
    // Resposta "maliciosa": campos extras (URLs) precisam ser ignorados.
    return rota.fulfill({
      json: { versionName: "2.0.3", versionCode: 15, url: "https://evil.example/app.apk" },
    });
  });
  return () => consultas;
}

const mensagens = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __msgs: string[] }).__msgs ?? []).map((m) => JSON.parse(m)),
  );

async function abrirHarness(page: Page) {
  await page.goto(`/?usuario=${U.ESTQ_A}&lista=${LISTA_A}&empresa=${EMPRESA_A}&aviso=1`);
}

test.beforeEach(async () => {
  await prepararBanco(3);
});

test("fora de conferência: aviso aparece e 'Atualizar agora' só pede a página oficial", async ({
  page,
}) => {
  const consultas = await simularApp(page, { versionName: "2.0.2", versionCode: 14 });
  await abrirHarness(page);
  await expect(page.getByText("Nenhuma conferência aberta nesta lista.")).toBeVisible();

  const aviso = page.getByTestId("aviso-nova-versao");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Nova versão disponível");
  await expect(aviso).toContainText("Você está usando a versão 2.0.2");
  await expect(aviso).toContainText("A versão 2.0.3 está disponível");
  // Sem rolagem horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "ATUALIZAR AGORA" }).click();
  await expect(aviso).toBeHidden();
  // O app recebe só a versão; o endereço é montado pelo Java (constante oficial).
  expect(await mensagens(page)).toEqual([{ tipo: "atualizacao", versao: "2.0.3" }]);
  expect(JSON.stringify(await mensagens(page))).not.toContain("evil");

  // "Voltar do navegador": o app continua funcionando e não pergunta de novo na hora.
  await page.reload();
  await page.getByRole("button", { name: "INICIAR CONFERÊNCIA" }).click();
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden();
  expect(consultas()).toBe(1);
});

test("APK antigo (sem identificação): endereço oficial validado, nunca o do servidor", async ({
  page,
}) => {
  await simularApp(page, null);
  await abrirHarness(page);
  const aviso = page.getByTestId("aviso-nova-versao");
  await expect(aviso).toContainText("2.0.2 (ou anterior)");
  await page.getByRole("button", { name: "ATUALIZAR AGORA" }).click();
  expect(await mensagens(page)).toEqual([
    { tipo: "externo", url: `${OFICIAL}/tag/android-v2.0.3` },
  ]);
});

test("'Depois' fecha e não volta a perguntar", async ({ page }) => {
  await simularApp(page, { versionName: "2.0.2", versionCode: 14 });
  await abrirHarness(page);
  await page.getByRole("button", { name: "DEPOIS" }).click();
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden();
  await page.reload();
  await expect(page.getByText("Nenhuma conferência aberta nesta lista.")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden();
  expect(await mensagens(page)).toEqual([]);
});

test("durante a conferência o aviso NÃO aparece; depois de finalizar, aparece", async ({
  page,
}) => {
  await simularApp(page, { versionName: "2.0.2", versionCode: 14 });
  // Conferência já aberta antes de o aviso poder aparecer.
  await page.goto(`/?usuario=${U.ESTQ_A}&lista=${LISTA_A}&empresa=${EMPRESA_A}`);
  await page.getByRole("button", { name: "INICIAR CONFERÊNCIA" }).click();
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await esperarSincronizado(page);

  await abrirHarness(page);
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await contar(page, "1");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden(); // contagem

  await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  await expect(page.getByTestId("resumo-finalizacao")).toBeVisible();
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden(); // finalização
  const canvas = page.getByTestId("assinatura-conferente").locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const caixa = (await canvas.boundingBox())!;
  await page.mouse.move(caixa.x + 20, caixa.y + 20);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 120, caixa.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "ASSINAR E FINALIZAR" }).click();
  await expect(page.getByTestId("conferencia-encerrada")).toBeVisible();

  await esperarSincronizado(page);
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden(); // ainda na tela da conferência
  // Fora da conferência (de volta à lista) e tudo sincronizado: agora o aviso pode aparecer.
  await page
    .getByTestId("conferencia-encerrada")
    .getByRole("button", { name: "Voltar para a lista" })
    .click();
  await expect(page.getByTestId("aviso-nova-versao")).toBeVisible({ timeout: 15_000 });
  expect(await mensagens(page)).toEqual([]);
});

test("offline: não consulta e não mostra nada", async ({ page, context }) => {
  const consultas = await simularApp(page, { versionName: "2.0.2", versionCode: 14 });
  await page.goto(`/?usuario=${U.ESTQ_A}&lista=${LISTA_A}&empresa=${EMPRESA_A}&aviso=1&offline=1`);
  await context.setOffline(true);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden();
  expect(consultas()).toBe(0);
  await context.setOffline(false);
});

test("telas de 320 a 428 px: sem rolagem horizontal, botões visíveis e acessíveis", async ({
  page,
}) => {
  await simularApp(page, { versionName: "2.0.2", versionCode: 14 });
  for (const largura of [320, 360, 393, 428]) {
    await page.setViewportSize({ width: largura, height: 740 });
    await page.evaluate(() => localStorage.removeItem("cr.atualizacao.v1")).catch(() => undefined);
    await abrirHarness(page);
    const aviso = page.getByTestId("aviso-nova-versao");
    await expect(aviso).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${largura}px`,
    ).toBe(true);
    for (const nome of ["ATUALIZAR AGORA", "DEPOIS"]) {
      const b = page.getByRole("button", { name: nome });
      await expect(b).toBeInViewport();
      const caixa = (await b.boundingBox())!;
      expect(caixa.height).toBeGreaterThanOrEqual(44); // alvo de toque
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(largura);
    }
    await expect(page.getByRole("alertdialog", { name: "Nova versão disponível" })).toBeVisible();
    // Espera a animação de abertura terminar (no meio do fade o contraste ainda é parcial).
    await aviso.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page }).include('[data-testid="aviso-nova-versao"]').analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  }
  // Teclado: o foco fica dentro do aviso e Esc fecha sem abrir nada.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[data-testid="aviso-nova-versao"]'),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("aviso-nova-versao")).toBeHidden();
  expect(await mensagens(page)).toEqual([]);
});
