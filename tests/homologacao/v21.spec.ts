/**
 * V2.1 no app REAL (VITE_CONFERENCE_V2=1), celular (Pixel 5), login real e Supabase local.
 * Alternância V1 ↔ V2, dois aparelhos, troca de usuário, queda real de internet
 * (context.setOffline) e desempenho. Tudo verificado também no banco.
 */
import {
  expect,
  test,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { APP_V1, APP_V2, sql } from "./ambiente";
import {
  assinar,
  contagens,
  entrar,
  esperarFilaVazia,
  filaPendente,
  sair,
  ultimaConferencia,
} from "./apoio";
import { LISTAS, semear, type Usuarios } from "./semear";

let u: Usuarios;
const medidas: Record<string, number | string> = {};

test.beforeAll(async () => {
  u = await semear();
});

test.afterAll(async () => {
  console.log(`[medidas] ${JSON.stringify(medidas)}`);
});

async function celular(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ ...devices["Pixel 5"], locale: "pt-BR" });
}

async function abrirLista(page: Page, unidadeId: string) {
  await page.goto(`${APP_V2}/unidade/${unidadeId}`);
  const iniciar = page.getByRole("button", { name: "Iniciar conferência" });
  await expect(iniciar.or(page.getByTestId("item-atual"))).toBeVisible({ timeout: 60_000 });
  return iniciar;
}

async function iniciarV2(page: Page, unidadeId: string, conferente = "Conferente A") {
  const iniciar = await abrirLista(page, unidadeId);
  if (await iniciar.isVisible()) {
    await iniciar.click();
    await page.getByRole("dialog").locator("input").first().fill(conferente);
    const t0 = Date.now();
    await page.getByRole("dialog").getByRole("button", { name: "Iniciar" }).click();
    await expect(page.getByTestId("item-atual")).toBeVisible({ timeout: 30_000 });
    return Date.now() - t0;
  }
  return 0;
}

async function contar(page: Page, qtd: string) {
  await page.getByLabel("QUANTIDADE CONFERIDA").fill(qtd);
  await page.getByRole("button", { name: "CONFIRMAR" }).click();
}

test("V2.1: conferência completa na lista média (120 itens) com login real", async ({
  browser,
}) => {
  const ctx = await celular(browser);
  const page = await ctx.newPage();
  await entrar(page, APP_V2, u.conferenteA.email);
  const tAbrir = Date.now();
  await abrirLista(page, LISTAS.media.id);
  medidas.abrir_lista_media_ms = Date.now() - tAbrir;
  medidas.iniciar_media_ms = await iniciarV2(page, LISTAS.media.id);
  await expect(page.getByTestId("progresso")).toHaveText("0 / 120");

  // Quantidade + avanço automático; tempo de confirmação
  const t = Date.now();
  await contar(page, "2");
  await expect(page.getByTestId("progresso")).toHaveText("1 / 120");
  medidas.confirmar_ms = Date.now() - t;
  await contar(page, "3");
  await contar(page, "9"); // divergência
  await expect(page.getByTestId("progresso")).toHaveText("3 / 120");

  // Anterior / próximo
  const codigo = await page.getByTestId("codigo-atual").textContent();
  await page.getByRole("button", { name: "Próximo item" }).click();
  await expect(page.getByTestId("codigo-atual")).not.toHaveText(codigo!);
  await page.getByRole("button", { name: "Item anterior" }).click();
  await expect(page.getByTestId("codigo-atual")).toHaveText(codigo!);

  // Busca por código parcial e filtro
  const busca = page.getByLabel("Buscar por código, descrição ou localização");
  await busca.fill("H0077");
  await busca.press("Enter");
  await expect(page.getByTestId("codigo-atual")).toHaveText("H0077");
  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  await page.getByRole("radio", { name: /Divergências/i }).click();
  await expect(page.getByRole("radio", { name: /Divergências/i })).toContainText("1");
  await page.getByRole("radio", { name: /Todos/i }).click();
  await page.getByRole("button", { name: "Voltar ao item", exact: true }).first().click();

  // Pausa e retomada
  await page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" }).click();
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeDisabled();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "RETOMAR CONFERÊNCIA" }).click();
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeEnabled();

  // Material adicional
  await page.getByRole("button", { name: "ADICIONAR MATERIAL" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Pesquisar material por código ou descrição").fill("EXTRA-V2");
  await d.getByLabel("Descrição *").fill("Material extra V2");
  await d.getByLabel("Localização").fill("C99-PZ-01");
  await d.getByLabel("Quantidade encontrada *").fill("4");
  await d.getByLabel("Motivo da inclusão *").fill("Encontrado sem cadastro");
  await d.getByRole("button", { name: "ADICIONAR À CONFERÊNCIA" }).click();
  await expect(page.getByTestId("codigo-atual")).toHaveText("EXTRA-V2");

  // Sincronização e finalização com assinatura
  const tSync = Date.now();
  await esperarFilaVazia(page, u.conferenteA.id);
  medidas.sincronizar_media_ms = Date.now() - tSync;
  await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  await expect(page.getByTestId("resumo-finalizacao")).toContainText("Itens conferidos4");
  await assinar(page, page.getByTestId("assinatura-conferente").locator("canvas"));
  await page.getByRole("button", { name: "ASSINAR E FINALIZAR" }).click();
  await esperarFilaVazia(page, u.conferenteA.id);

  const conf = await ultimaConferencia(LISTAS.media.id);
  expect(conf.status).toBe("finalizada");
  const itens = await contagens(conf.id);
  expect(itens.length).toBe(121);
  expect(itens.every((i) => i.n === 1)).toBe(true);
  expect(itens.find((i) => i.codigo === "EXTRA-V2")?.quantidade_contada).toBe("4");
  const [info] = await sql<{ pausas: number; pausado: number; loc: string; ev_dup: number }>(
    `SELECT c.quantidade_pausas::int AS pausas, c.total_tempo_pausado::int AS pausado,
            (SELECT locacao FROM conferencia_itens WHERE conferencia_id = c.id AND codigo = 'EXTRA-V2') AS loc,
            (SELECT count(*) - count(DISTINCT event_id) FROM conferencia_eventos WHERE conferencia_id = c.id)::int AS ev_dup
       FROM conferencias c WHERE c.id = $1`,
    [conf.id],
  );
  expect(info.pausas).toBe(1);
  expect(info.pausado).toBeGreaterThanOrEqual(2);
  expect(info.pausado).toBeLessThanOrEqual(10);
  expect(info.loc).toBe("C99-PZ-01");
  expect(info.ev_dup).toBe(0);
  const [h] = await sql<{ n: number; prevista: string; conferida: string; status: string }>(
    `SELECT count(*) OVER ()::int AS n, quantidade_prevista::text AS prevista,
            quantidade_conferida::text AS conferida, status
       FROM historico_conferencias WHERE conferencia_id = $1`,
    [conf.id],
  );
  expect(h.n).toBe(1);
  expect(h.status).toBe("finalizada");
  expect(Number(h.prevista)).toBeGreaterThan(0);
  await ctx.close();
});

test("alternância V2 → V1 → V2 → V1: nenhum dado preso na interface V2", async ({ browser }) => {
  // 1) V2 ligada: inicia e conta dois itens (um deles sem internet)
  const c2 = await celular(browser);
  const p2 = await c2.newPage();
  await entrar(p2, APP_V2, u.conferenteA.email);
  await iniciarV2(p2, LISTAS.pequena.id);
  await contar(p2, "2");
  await c2.setOffline(true);
  await contar(p2, "1");
  await expect(p2.getByTestId("aviso-offline")).toBeVisible();
  await expect.poll(() => filaPendente(p2, u.conferenteA.id)).toBeGreaterThan(0);
  await c2.setOffline(false);
  await esperarFilaVazia(p2, u.conferenteA.id);
  const conf = await ultimaConferencia(LISTAS.pequena.id);

  // 2) V2 desligada: a V1 vê a conferência com as duas contagens e continua nela
  const c1 = await browser.newContext({ locale: "pt-BR" });
  const p1 = await c1.newPage();
  await entrar(p1, APP_V1, u.conferenteA.email);
  await p1.goto(`${APP_V1}/unidade/${LISTAS.pequena.id}`);
  await expect(p1.getByRole("button", { name: "Finalizar conferência" })).toBeVisible();
  const antes = await contagens(conf.id);
  expect(antes.filter((i) => i.quantidade_contada !== null).length).toBe(2);
  await p1
    .getByRole("button", { name: /Material homologação 5\b/ })
    .first()
    .click();
  await p1.getByRole("dialog").locator("input[inputmode=decimal]").fill("6");
  await p1.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(p1.getByRole("dialog")).toBeHidden();
  await p1.getByRole("button", { name: "Pausar conferência" }).click();
  await expect(p1.getByRole("button", { name: "Retomar conferência" })).toBeVisible();
  await p1.getByRole("button", { name: "Retomar conferência" }).click();
  await expect(p1.getByRole("button", { name: "Pausar conferência" })).toBeVisible();

  // 3) V2 ligada de novo: recebe a contagem feita na V1 e finaliza
  await p2.reload();
  await expect(p2.getByTestId("item-atual")).toBeVisible({ timeout: 30_000 });
  await expect(p2.getByTestId("progresso")).toHaveText("3 / 8", { timeout: 30_000 });
  await p2.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  await assinar(p2, p2.getByTestId("assinatura-conferente").locator("canvas"));
  await p2.getByRole("button", { name: "ASSINAR E FINALIZAR" }).click();
  await esperarFilaVazia(p2, u.conferenteA.id);
  await expect
    .poll(async () => (await ultimaConferencia(LISTAS.pequena.id)).status)
    .toBe("finalizada");

  // 4) V2 desligada novamente: a V1 mostra a lista livre e o histórico com a conferência
  await p1.reload();
  await expect(p1.getByRole("button", { name: "Iniciar conferência" })).toBeVisible();
  const depois = await contagens(conf.id);
  expect(depois.filter((i) => i.quantidade_contada !== null).length).toBe(3);
  expect(depois.every((i) => i.n === 1)).toBe(true);
  const [pausas] = await sql<{ n: number }>(
    "SELECT quantidade_pausas::int AS n FROM conferencias WHERE id = $1",
    [conf.id],
  );
  expect(pausas.n).toBe(1);
  await c1.close();
  await c2.close();
});

test("dois aparelhos na mesma conferência: conflito, resolução, sem duplicidade", async ({
  browser,
}) => {
  const ca = await celular(browser);
  const cb = await celular(browser);
  const a = await ca.newPage();
  const b = await cb.newPage();
  await entrar(a, APP_V2, u.conferenteA.email);
  await entrar(b, APP_V2, u.conferenteB.email);
  await iniciarV2(a, LISTAS.pequena.id);
  await esperarFilaVazia(a, u.conferenteA.id);
  // B abre a mesma conferência (recebe do servidor)
  await abrirLista(b, LISTAS.pequena.id);
  await expect(b.getByTestId("item-atual")).toBeVisible({ timeout: 30_000 });
  await expect(a.getByTestId("codigo-atual")).toHaveText("H0001");
  await expect(b.getByTestId("codigo-atual")).toHaveText("H0001");

  // Alteração simultânea no mesmo item: B sem internet conta 7; A conta 5 e envia.
  await cb.setOffline(true);
  await contar(b, "7");
  await contar(a, "5");
  await esperarFilaVazia(a, u.conferenteA.id);
  await cb.setOffline(false);
  // B sincroniza e recebe o conflito: nada muda sem decisão.
  await expect(b.getByTestId("aviso-atencao")).toBeVisible({ timeout: 30_000 });
  const conf = await ultimaConferencia(LISTAS.pequena.id);
  let itens = await contagens(conf.id);
  expect(itens.find((i) => i.codigo === "H0001")?.quantidade_contada).toBe("5");
  await b.getByTestId("aviso-atencao").click();
  await expect(b.getByTestId("minha-contagem")).toContainText("7");
  await expect(b.getByTestId("contagem-servidor")).toContainText("5");
  await b.getByRole("button", { name: "MANTER MINHA CONTAGEM" }).click();
  await esperarFilaVazia(b, u.conferenteB.id);
  itens = await contagens(conf.id);
  expect(itens.find((i) => i.codigo === "H0001")?.quantidade_contada).toBe("7");
  // A recebe a decisão
  await a.getByRole("button", { name: "SINCRONIZAR AGORA" }).first().click();
  await a.getByRole("button", { name: /Ver lista de itens/ }).click();
  await expect(a.getByTestId("lista-itens")).toContainText("7", { timeout: 30_000 });
  expect(itens.every((i) => i.n === 1)).toBe(true);
  const [dup] = await sql<{ d: number; h: number }>(
    `SELECT (SELECT count(*) - count(DISTINCT event_id) FROM conferencia_eventos WHERE conferencia_id = $1)::int AS d,
            (SELECT count(*) FROM historico_conferencias WHERE conferencia_id = $1)::int AS h`,
    [conf.id],
  );
  expect(dup.d).toBe(0);
  expect(dup.h).toBe(1);
  await ca.close();
  await cb.close();
});

test("troca de usuário no mesmo aparelho: A → sair → B (outra empresa)", async ({ browser }) => {
  const ctx = await celular(browser);
  const page = await ctx.newPage();
  await entrar(page, APP_V2, u.conferenteA.email);
  await iniciarV2(page, LISTAS.grande.id);
  await esperarFilaVazia(page, u.conferenteA.id);
  // A conta sem internet: fica na fila de A
  await ctx.setOffline(true);
  await contar(page, "4");
  await contar(page, "4");
  await expect.poll(() => filaPendente(page, u.conferenteA.id)).toBe(2);
  await ctx.setOffline(false);
  // Bloqueia só o envio de eventos para a fila de A continuar pendente durante a troca.
  await ctx.route("**/rest/v1/rpc/processar_eventos_conferencia*", (r) => r.abort());
  await ctx.route("**/rest/v1/rpc/processar_evento_conferencia*", (r) => r.abort());
  await sair(page, APP_V2);

  await entrar(page, APP_V2, u.outraEmpresa.email);
  await ctx.unrouteAll({ behavior: "ignoreErrors" });
  await page.waitForTimeout(3000);
  // B não vê nada de A: nem a lista, nem a conferência, nem o cache
  await page.goto(`${APP_V2}/unidade/${LISTAS.grande.id}`);
  await expect(page.getByTestId("item-atual")).toHaveCount(0);
  const bancos = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name ?? ""),
  );
  expect(bancos).toContain(`cr-v2:${u.conferenteA.id}`);
  expect(bancos).toContain(`cr-v2:${u.outraEmpresa.id}`);
  const unidadesDeB = await page.evaluate(async (uid) => {
    const db: IDBDatabase = await new Promise((res) => {
      const q = indexedDB.open(`cr-v2:${uid}`);
      q.onsuccess = () => res(q.result);
    });
    const r: { id: string }[] = await new Promise((res) => {
      const q = db.transaction("unidades").objectStore("unidades").getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return r.map((x) => x.id);
  }, u.outraEmpresa.id);
  expect(unidadesDeB).not.toContain(LISTAS.grande.id);
  expect(unidadesDeB).toContain(LISTAS.outra.id);
  // A fila de A não foi enviada por B
  const conf = await ultimaConferencia(LISTAS.grande.id);
  let itens = await contagens(conf.id);
  expect(itens.filter((i) => i.quantidade_contada !== null).length).toBe(0);
  const [porB] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM conferencia_eventos WHERE conferencia_id = $1 AND user_id = $2",
    [conf.id, u.outraEmpresa.id],
  );
  expect(porB.n).toBe(0);
  await sair(page, APP_V2);

  // A volta: a própria fila é enviada, com o usuário A
  await entrar(page, APP_V2, u.conferenteA.email);
  await esperarFilaVazia(page, u.conferenteA.id);
  itens = await contagens(conf.id);
  expect(itens.filter((i) => i.quantidade_contada !== null).length).toBe(2);
  const [autores] = await sql<{ n: number }>(
    "SELECT count(DISTINCT user_id)::int AS n FROM conferencia_eventos WHERE conferencia_id = $1",
    [conf.id],
  );
  expect(autores.n).toBe(1);
  const [logs] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM auditoria WHERE user_id = $1 AND detalhe ILIKE '%' || $2 || '%'",
    [u.outraEmpresa.id, LISTAS.grande.nome],
  );
  expect(logs.n).toBe(0);
  await ctx.close();
});

test("queda real de internet: alterações, pausa, fechar e reabrir, sincronizar", async ({
  browser,
}) => {
  await sql(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTAS.pequena.id],
  );
  const ctx = await celular(browser);
  let page = await ctx.newPage();
  await entrar(page, APP_V2, u.conferenteA.email);
  await iniciarV2(page, LISTAS.pequena.id);
  await esperarFilaVazia(page, u.conferenteA.id);
  // Espera o service worker assumir (o app precisa abrir sem internet)
  await page.reload();
  await expect(page.getByTestId("item-atual")).toBeVisible({ timeout: 30_000 });

  await ctx.setOffline(true);
  await expect(page.getByTestId("estado-sync")).toHaveAttribute("data-estado", "OFFLINE");
  await contar(page, "1");
  await contar(page, "2");
  await contar(page, "3");
  await page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" }).click();
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "RETOMAR CONFERÊNCIA" }).click();
  await expect(page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" })).toBeVisible();

  // Fecha o app e abre de novo, ainda sem internet
  await page.close();
  page = await ctx.newPage();
  await page.goto(`${APP_V2}/unidade/${LISTAS.pequena.id}`);
  await expect(page.getByTestId("item-atual")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("progresso")).toHaveText("3 / 8");
  await contar(page, "4");
  await contar(page, "5");
  await expect.poll(() => filaPendente(page, u.conferenteA.id)).toBeGreaterThanOrEqual(7);

  // Internet volta
  await ctx.setOffline(false);
  await esperarFilaVazia(page, u.conferenteA.id);
  const conf = await ultimaConferencia(LISTAS.pequena.id);
  const itens = await contagens(conf.id);
  expect(
    itens.filter((i) => i.quantidade_contada !== null).map((i) => i.quantidade_contada),
  ).toEqual(["1", "2", "3", "4", "5"]);
  expect(itens.every((i) => i.n === 1)).toBe(true);
  const [c] = await sql<{ pausas: number; pausado: number; dup: number; status: string }>(
    `SELECT quantidade_pausas::int AS pausas, total_tempo_pausado::int AS pausado, status,
            (SELECT count(*) - count(DISTINCT event_id) FROM conferencia_eventos WHERE conferencia_id = c.id)::int AS dup
       FROM conferencias c WHERE id = $1`,
    [conf.id],
  );
  expect(c.status).toBe("em_andamento");
  expect(c.pausas).toBe(1);
  expect(c.pausado).toBeGreaterThanOrEqual(4);
  expect(c.pausado).toBeLessThanOrEqual(8);
  expect(c.dup).toBe(0);
  expect(await filaPendente(page, u.conferenteA.id)).toBe(0);
  medidas.pausa_registrada_s = c.pausado;
  await ctx.close();
});

const CPU = Number(process.env.HOMOLOG_CPU ?? 4);

test(`desempenho: lista de 1.000 itens no celular (CPU ${CPU}× mais lenta)`, async ({
  browser,
}) => {
  await sql(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTAS.grande.id],
  );
  const ctx = await celular(browser);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const tLogin = Date.now();
  await entrar(page, APP_V2, u.conferenteA.email);
  medidas.login_ms_cpu = Date.now() - tLogin;
  const t0 = Date.now();
  await abrirLista(page, LISTAS.grande.id);
  medidas.abrir_lista_1000_ms_cpu = Date.now() - t0;
  medidas.iniciar_1000_ms_cpu = await iniciarV2(page, LISTAS.grande.id);
  await expect(page.getByTestId("progresso")).toHaveText("0 / 1000");
  const tc = Date.now();
  await contar(page, "3");
  await expect(page.getByTestId("progresso")).toHaveText("1 / 1000");
  medidas.confirmar_1000_ms_cpu = Date.now() - tc;
  const tb = Date.now();
  const busca = page.getByLabel("Buscar por código, descrição ou localização");
  await busca.fill("H0999");
  await busca.press("Enter");
  await expect(page.getByTestId("codigo-atual")).toHaveText("H0999");
  medidas.buscar_1000_ms_cpu = Date.now() - tb;
  const tl = Date.now();
  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  await expect(page.getByTestId("lista-itens")).toBeVisible();
  medidas.abrir_lista_itens_1000_ms_cpu = Date.now() - tl;
  // Travamento: maior tarefa longa durante a rolagem da lista
  const maior = await page.evaluate(async () => {
    let pior = 0;
    const obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) pior = Math.max(pior, e.duration);
    });
    obs.observe({ type: "longtask", buffered: false });
    const el = document.querySelector('[data-testid="lista-itens"]')!;
    for (let i = 0; i < 40; i++) {
      el.scrollTop += 400;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await new Promise((r) => setTimeout(r, 300));
    obs.disconnect();
    return Math.round(pior);
  });
  medidas.maior_travamento_rolagem_ms_cpu = maior;
  const ts = Date.now();
  await esperarFilaVazia(page, u.conferenteA.id);
  medidas.sincronizar_1000_ms_cpu = Date.now() - ts;
  medidas.cpu_reduzida_x = CPU;
  medidas.heap_mb = await page.evaluate(() =>
    Math.round(
      ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
        0) / 1048576,
    ),
  );
  await ctx.close();
});
