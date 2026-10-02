/** Ações comuns da homologação no app REAL (login real, Supabase local). */
import { expect, type Page } from "@playwright/test";
import { SENHA, sql } from "./ambiente";

export async function entrar(page: Page, base: string, email: string) {
  await page.goto(`${base}/entrar`);
  await page.locator("#login-email").fill(email);
  await page.locator("#login-senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/menu/, { timeout: 30_000 });
}

export async function sair(page: Page, base: string) {
  if (!/\/menu/.test(page.url())) await page.goto(`${base}/menu`);
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar|\/$/, { timeout: 30_000 });
}

export async function assinar(page: Page, canvas: ReturnType<Page["locator"]>) {
  await canvas.scrollIntoViewIfNeeded();
  const c = (await canvas.boundingBox())!;
  await page.mouse.move(c.x + 20, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 50, { steps: 8 });
  await page.mouse.move(c.x + 200, c.y + 25, { steps: 8 });
  await page.mouse.up();
}

/** Itens da fila do motor V2 deste usuário que ainda não chegaram ao servidor. */
export async function filaPendente(page: Page, userId: string) {
  return page.evaluate(async (uid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const q = indexedDB.open(`cr-v2:${uid}`);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    if (!Array.from(db.objectStoreNames).includes("fila")) return -1;
    const itens: { status: string }[] = await new Promise((res) => {
      const q = db.transaction("fila").objectStore("fila").getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return itens.filter((i) => i.status !== "SYNCED" && i.status !== "RESOLVED").length;
  }, userId);
}

export async function esperarFilaVazia(page: Page, userId: string, timeout = 60_000) {
  await expect
    .poll(() => filaPendente(page, userId), { timeout, intervals: [300, 500, 1000] })
    .toBe(0);
}

export async function conferenciaAberta(unidadeId: string) {
  const [c] = await sql<{ id: string; status: string }>(
    "SELECT id, status FROM conferencias WHERE unidade_id = $1 AND status IN ('em_andamento','pausada') ORDER BY hora_inicio DESC LIMIT 1",
    [unidadeId],
  );
  return c;
}

export async function ultimaConferencia(unidadeId: string) {
  const [c] = await sql<{ id: string; status: string }>(
    "SELECT id, status FROM conferencias WHERE unidade_id = $1 ORDER BY hora_inicio DESC LIMIT 1",
    [unidadeId],
  );
  return c;
}

export async function contagens(conferenciaId: string) {
  return sql<{ codigo: string; quantidade_contada: string | null; n: number }>(
    `SELECT codigo, max(quantidade_contada)::text AS quantidade_contada, count(*)::int AS n
       FROM conferencia_itens WHERE conferencia_id = $1 GROUP BY codigo ORDER BY codigo`,
    [conferenciaId],
  );
}
