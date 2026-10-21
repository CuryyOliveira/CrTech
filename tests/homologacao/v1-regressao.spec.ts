/**
 * Regressão da V1 no app REAL compilado com VITE_CONFERENCE_V2=0, contra o Supabase local com
 * baseline + Fase 0 + V2.2 + V2.3 aplicadas.
 */
import { expect, test } from "@playwright/test";
import { APP_V1, sql } from "./ambiente";
import { assinar, contagens, entrar, sair, ultimaConferencia } from "./apoio";
import { LISTAS, MODULO_H, semear, type Usuarios } from "./semear";

let u: Usuarios;
test.beforeAll(async () => {
  u = await semear();
});

test("V1: login, criação de lista, conferência completa, histórico", async ({ page }) => {
  // Criação de lista (cadastro de caminhão) pelo administrador
  await entrar(page, APP_V1, u.admin.email);
  const nome = `Lista V1 ${Date.now()}`;
  await page.goto(`${APP_V1}/m/${MODULO_H}`);
  await page.getByRole("button", { name: "Novo" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("input").first().fill(nome);
  await dlg.getByRole("button", { name: "Salvar" }).click();
  await expect(dlg).toBeHidden();
  const [nova] = await sql<{ id: string; empresa_id: string }>(
    "SELECT id, empresa_id FROM unidades WHERE nome = $1",
    [nome],
  );
  expect(nova.empresa_id).toBeTruthy();
  await sair(page, APP_V1);

  // Login do conferente
  await entrar(page, APP_V1, u.conferenteA.email);
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();

  // Conferência na lista pequena
  await page.goto(`${APP_V1}/unidade/${LISTAS.pequena.id}`);
  await page.getByRole("button", { name: "Iniciar conferência" }).click();
  await page.getByRole("dialog").locator("input").first().fill("Conferente A");
  await page.getByRole("dialog").getByRole("button", { name: "Iniciar" }).click();
  await expect(page.getByRole("button", { name: "Finalizar conferência" })).toBeVisible();
  const conf = await ultimaConferencia(LISTAS.pequena.id);
  expect(conf.status).toBe("em_andamento");

  const contarItem = async (texto: string, qtd: string) => {
    await page
      .getByRole("button", { name: new RegExp(texto) })
      .first()
      .click();
    const d = page.getByRole("dialog");
    await d.locator("input[inputmode=decimal]").fill(qtd);
    await d.getByRole("button", { name: "Salvar" }).click();
    await expect(d).toBeHidden();
  };
  await contarItem("Material homologação 1\\b", "2");
  await contarItem("Material homologação 2\\b", "1");

  // Inclusão de material na conferência
  await page.getByRole("button", { name: "Adicionar material à conferência" }).click();
  const add = page.getByRole("dialog");
  await add.getByPlaceholder("Código", { exact: true }).fill("EXTRA-V1");
  await add.locator("input[type=number]").fill("3");
  await add.getByPlaceholder("Descrição do material encontrado").fill("Material extra V1");
  await add.getByPlaceholder(/Ex\.: material encontrado/).fill("Encontrado na prateleira");
  await add.getByRole("button", { name: "Adicionar à conferência" }).click();
  await expect(add).toBeHidden();

  // Pausa e retomada
  await page.getByRole("button", { name: "Pausar conferência" }).click();
  await expect(page.getByRole("button", { name: "Retomar conferência" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalizar conferência" })).toBeDisabled();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Retomar conferência" }).click();
  await expect(page.getByRole("button", { name: "Pausar conferência" })).toBeVisible();

  // Finalização com assinatura
  await page.getByRole("button", { name: "Finalizar conferência" }).click();
  const fim = page.getByRole("dialog");
  await assinar(page, fim.locator("canvas").first());
  await fim.getByRole("button", { name: "Assinar e finalizar" }).click();
  await expect(fim).toBeHidden({ timeout: 30_000 });

  await expect
    .poll(async () => (await ultimaConferencia(LISTAS.pequena.id)).status, { timeout: 20_000 })
    .toBe("finalizada");
  const itens = await contagens(conf.id);
  expect(itens.find((i) => i.codigo === "H0001")?.quantidade_contada).toBe("2");
  expect(itens.find((i) => i.codigo === "EXTRA-V1")?.quantidade_contada).toBe("3");
  expect(itens.every((i) => i.n === 1)).toBe(true);
  const [pausa] = await sql<{ pausas: number; pausado: number }>(
    "SELECT coalesce(quantidade_pausas,0)::int AS pausas, coalesce(total_tempo_pausado,0)::int AS pausado FROM conferencias WHERE id = $1",
    [conf.id],
  );
  expect(pausa.pausas).toBe(1);
  expect(pausa.pausado).toBeGreaterThanOrEqual(1);

  // Histórico
  const [h] = await sql<{ status: string; n: number }>(
    "SELECT status, count(*) OVER ()::int AS n FROM historico_conferencias WHERE conferencia_id = $1",
    [conf.id],
  );
  expect(h).toEqual({ status: "finalizada", n: 1 });
  await page.getByRole("button", { name: "Histórico" }).click();
  await expect(page.getByText(/Conferente A/).first()).toBeVisible();

  await sair(page, APP_V1);
});

test("V1: administração abre para o administrador e é negada ao conferente", async ({ page }) => {
  await entrar(page, APP_V1, u.admin.email);
  await page.goto(`${APP_V1}/admin`);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText(/acesso não autorizado/i)).toHaveCount(0);
  await sair(page, APP_V1);

  await entrar(page, APP_V1, u.conferenteA.email);
  await page.goto(`${APP_V1}/admin`);
  await expect(page.getByText(/acesso não autorizado/i).first()).toBeVisible({
    timeout: 15_000,
  });
});
