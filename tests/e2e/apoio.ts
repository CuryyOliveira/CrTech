/** Apoio dos testes E2E: preparação do banco de teste e ações comuns na tela. */
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const U = {
  ESTQ_A: "00000000-0000-4000-8000-00000000a002",
  ADMIN_A: "00000000-0000-4000-8000-00000000a001",
};
export const EMPRESA_A = "00000000-0000-4000-8000-000000000e0a";
export const LISTA_A = "00000000-0000-4000-8000-0000000001a1";

const base = () => `http://localhost:${process.env.E2E_PORTA ?? 4173}`;

export async function sql<T = Record<string, unknown>>(texto: string, params: unknown[] = []) {
  const r = await fetch(`${base()}/api/_sql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: texto, params }),
  });
  if (!r.ok) throw new Error(`SQL falhou: ${await r.text()}`);
  return (await r.json()) as T[];
}

/** Banco novo (cópia limpa do modelo) + lista A com `extras` materiais adicionais. */
export async function prepararBanco(extras = 20) {
  await fetch(`${base()}/api/_reset`, { method: "POST" });
  await sql(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA_A],
  );
  for (let i = 1; i <= extras; i++) {
    const corredor = String(1 + Math.floor(i / 10)).padStart(2, "0");
    await sql(
      "INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada, locacao) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        randomUUID(),
        LISTA_A,
        `E-${String(i).padStart(4, "0")}`,
        `Material de teste ${i}`,
        (i % 5) + 1,
        `C${corredor}-P${String.fromCharCode(65 + (i % 4))}-${String(i).padStart(2, "0")}`,
      ],
    );
  }
}

export async function abrirConferencia(page: Page, usuario = U.ESTQ_A) {
  await page.goto(`/?usuario=${usuario}&lista=${LISTA_A}&empresa=${EMPRESA_A}`);
  const iniciar = page.getByRole("button", { name: "INICIAR CONFERÊNCIA" });
  await expect(iniciar.or(page.getByTestId("item-atual"))).toBeVisible();
  if (await iniciar.isVisible()) await iniciar.click();
  await expect(page.getByTestId("item-atual")).toBeVisible();
}

export async function offline(page: Page, sim: boolean) {
  await page.evaluate((v) => {
    window.__cr!.rede.offline = v;
    window.dispatchEvent(new Event(v ? "offline" : "online"));
  }, sim);
}

export async function sincronizar(page: Page) {
  await page.getByRole("button", { name: "SINCRONIZAR AGORA" }).first().click();
}

/** Espera o motor terminar de enviar tudo (fila vazia e servidor refletido). */
export async function esperarSincronizado(page: Page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.__cr!.motor.sincronizarAgora());
        return page.evaluate(async () => (await window.__cr!.motor.fila()).length);
      },
      { timeout: 30_000, intervals: [300, 500, 1000] },
    )
    .toBe(0);
}

export async function conferenciaNoServidor() {
  const [c] = await sql<{ id: string; status: string }>(
    "SELECT id, status FROM conferencias WHERE unidade_id = $1 ORDER BY created_at DESC LIMIT 1",
    [LISTA_A],
  );
  return c;
}

/** Quantidade: digita e confirma. */
export async function contar(page: Page, qtd: string) {
  const campo = page.getByLabel("QUANTIDADE CONFERIDA");
  await campo.fill(qtd);
  await page.getByRole("button", { name: "CONFIRMAR" }).click();
}

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DwH4hhDAYGAC7mA/2NZ7hDAAAAAElFTkSuQmCC",
  "base64",
);
