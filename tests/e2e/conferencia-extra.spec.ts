/** V2.1 — desempenho (1.000 itens), rotação, cancelamento, decisões de conflito e contagem cega. */
import { expect, test } from "@playwright/test";
import {
  abrirConferencia,
  conferenciaNoServidor,
  contar,
  EMPRESA_A,
  esperarSincronizado,
  LISTA_A,
  offline,
  prepararBanco,
  sincronizar,
  sql,
  U,
} from "./apoio";

test("desempenho: 1.000 itens — lista virtualizada, busca e troca de item rápidas", async ({
  page,
}) => {
  await prepararBanco(0);
  await sql(
    `INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada, locacao)
     SELECT gen_random_uuid(), $1, 'M-' || lpad(g::text, 5, '0'), 'Item em massa ' || g, (g % 9) + 1,
            'C' || lpad((g / 50)::text, 2, '0') || '-P' || chr(65 + g % 5) || '-' || lpad((g % 50)::text, 2, '0')
       FROM generate_series(1, 1000) g`,
    [LISTA_A],
  );
  await abrirConferencia(page);
  await expect(page.getByTestId("progresso")).toHaveText("0 / 1003");
  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  // Só uma janela de linhas está no DOM (não 1.003).
  const linhas = await page.getByTestId("lista-itens").getByRole("option").count();
  expect(linhas).toBeLessThan(40);

  const busca = page.getByLabel("Buscar por código, descrição ou localização");
  const t0 = Date.now();
  await busca.fill("M-00777");
  await expect(page.getByTestId("lista-itens").getByRole("option")).toHaveCount(1);
  const tBusca = Date.now() - t0;
  expect(tBusca).toBeLessThan(1500); // inclui a pausa de digitação (150 ms)

  await busca.press("Enter");
  const t1 = Date.now();
  await contar(page, "3");
  await expect(page.getByTestId("progresso")).toHaveText("1 / 1003");
  const tContagem = Date.now() - t1;
  expect(tContagem).toBeLessThan(1500);
  test.info().annotations.push({
    type: "desempenho",
    description: `busca ${tBusca} ms; contagem+avanço ${tContagem} ms`,
  });
});

test("rotação: retrato ↔ paisagem mantém o item e os controles utilizáveis", async ({ page }) => {
  await prepararBanco(10);
  await abrirConferencia(page);
  const codigo = await page.getByTestId("codigo-atual").textContent();
  await page.setViewportSize({ width: 851, height: 393 }); // paisagem
  await expect(page.getByTestId("codigo-atual")).toHaveText(codigo!);
  await expect(page.getByRole("button", { name: "CONFIRMAR" })).toBeVisible();
  await page.getByLabel("QUANTIDADE CONFERIDA").fill("2");
  await page.setViewportSize({ width: 393, height: 851 }); // volta a retrato
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toHaveValue("2"); // rascunho preservado
});

test("cancelar conferência exige motivo e confirmação; vira evento V2", async ({ page }) => {
  await prepararBanco(5);
  await abrirConferencia(page);
  await page.getByRole("button", { name: "Cancelar conferência" }).click();
  const confirmar = page.getByRole("dialog").getByRole("button", { name: "CANCELAR CONFERÊNCIA" });
  await expect(confirmar).toBeDisabled();
  await page.getByLabel("Motivo do cancelamento").fill("Lista errada");
  await confirmar.click();
  await expect(page.getByTestId("saiu")).toBeVisible();
  await esperarSincronizado(page);
  const [c] = await sql<{ status: string; motivo_cancelamento: string }>(
    "SELECT status, motivo_cancelamento FROM conferencias WHERE id = $1",
    [(await conferenciaNoServidor()).id],
  );
  expect(c).toEqual({ status: "cancelada", motivo_cancelamento: "Lista errada" });
});

test("conflito: USAR CONTAGEM DO SERVIDOR mantém o valor do servidor", async ({ page }) => {
  await prepararBanco(5);
  await abrirConferencia(page);
  await esperarSincronizado(page);
  const codigo = (await page.getByTestId("codigo-atual").textContent())!.trim();
  const { id } = await conferenciaNoServidor();
  await offline(page, true);
  await contar(page, "1");
  await sql(
    "UPDATE conferencia_itens SET quantidade_contada = 6, status = 'divergencia' WHERE conferencia_id = $1 AND codigo = $2",
    [id, codigo],
  );
  await offline(page, false);
  await sincronizar(page);
  await page.getByTestId("aviso-atencao").click();
  await page.getByRole("button", { name: "USAR CONTAGEM DO SERVIDOR" }).click();
  await expect(page.getByTestId("aviso-atencao")).toHaveCount(0);
  await esperarSincronizado(page);
  await page.getByLabel("Buscar por código, descrição ou localização").fill(codigo);
  await page.getByLabel("Buscar por código, descrição ou localização").press("Enter");
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toHaveValue("6");
  const [i] = await sql<{ q: string }>(
    "SELECT quantidade_contada AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = $2",
    [id, codigo],
  );
  expect(i.q).toBe("6");
});

test("contagem cega (família prateleira): esperado e divergência ficam ocultos", async ({
  page,
}) => {
  await prepararBanco(3);
  await page.goto(`/?usuario=${U.ESTQ_A}&lista=${LISTA_A}&empresa=${EMPRESA_A}&familia=prateleira`);
  await page.getByRole("button", { name: "INICIAR CONFERÊNCIA" }).click();
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await expect(page.getByTestId("esperado")).toHaveCount(0);
  await page.getByLabel("QUANTIDADE CONFERIDA").fill("999");
  await expect(page.getByTestId("divergencia")).toHaveCount(0);
});

test("sem rolagem lateral em celulares estreitos (320, 360, 393 px e paisagem)", async ({
  page,
}) => {
  await prepararBanco(5);
  await abrirConferencia(page);
  for (const [w, h] of [
    [320, 640],
    [360, 740],
    [393, 851],
    [851, 393],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const larguras = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(larguras[0], `largura ${w}px`).toBeLessThanOrEqual(larguras[1]);
    await expect(page.getByRole("button", { name: "CONFIRMAR" })).toBeInViewport();
  }
});
