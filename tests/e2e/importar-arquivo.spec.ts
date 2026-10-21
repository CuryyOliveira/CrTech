/**
 * "Importar arquivo" no navegador real: PDF lido no aparelho (pdf.js + worker), escolha das
 * colunas antes de carregar, cancelamento, e planilha seguindo direto como antes.
 */
import { expect, test, type Page } from "@playwright/test";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

/** Relatório no formato do ERP (Courier: largura fixa), com 2 páginas e linha de total. */
function pdfDoErp() {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("courier", "normal");
  const tamanho = 6.9;
  doc.setFontSize(tamanho);
  const cw = tamanho * 0.6;
  const escrever = (y: number, partes: [number, string][]) => {
    for (const [col, txt] of partes) doc.text(txt, col * cw, y);
  };
  const cabecalho = (pagina: number) => {
    escrever(30, [
      [7, "ALCOESTE"],
      [68, "20/10/2026"],
      [127, "PAGINA"],
      [137, String(pagina)],
    ]);
    escrever(42, [[7, "=".repeat(132)]]);
    escrever(54, [
      [7, "CODIGO"],
      [15, "DESCRICAO"],
      [46, "LOCALIZACAO"],
      [59, "UNI"],
      [72, "ULT.PRECO"],
      [83, "EST.MIN."],
      [93, "EST.MAX."],
      [105, "QDE.ATU."],
      [115, "CUSTO MEDIO"],
      [127, "VAL."],
      [132, "ESTOQUE"],
    ]);
    escrever(66, [[7, "-".repeat(132)]]);
  };
  cabecalho(1);
  escrever(78, [
    [7, "00007-7"],
    [15, "PARAFUSO 10 x 20mm ACO 8.8"],
    [46, "P36- A11"],
    [59, "PC"],
    [77, "9,38"],
    [84, "100,000"],
    [94, "300,000"],
    [107, "30,000"],
    [122, "0,42"],
    [134, "12,60"],
  ]);
  escrever(90, [
    [7, "00190-0"],
    [15, 'PARAFUSO 1/2x2" ALLEN CAB.CIL. P36 - E19'],
    [59, "PC"],
    [77, "1,14"],
    [84, "100,000"],
    [94, "200,000"],
    [107, "30,000"],
    [122, "1,21"],
    [134, "36,30"],
  ]);
  doc.addPage();
  cabecalho(2);
  escrever(78, [
    [7, "20044-0"],
    [15, 'CHAVE IMPACTO PNEUMATICA 3/4"'],
    [46, "P09 - G08"],
    [59, "PC"],
    [73, "1.608,00"],
    [86, "0,000"],
    [96, "0,000"],
    [108, "1,000"],
    [118, "1.771,31"],
    [131, "1.771,31"],
  ]);
  escrever(90, [[7, "-".repeat(132)]]);
  escrever(102, [
    [7, "TOTAL"],
    [13, "DE PRODUTOS :"],
    [29, "3"],
    [130, "1.820,21"],
  ]);
  return Buffer.from(doc.output("arraybuffer"));
}

async function enviar(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto("/?importar=1");
  await page.getByLabel("Importar arquivo").setInputFiles({ name, mimeType, buffer });
}

const resultado = (page: Page) => page.getByTestId("resultado-importacao");

test("PDF: mostra as colunas, sugere Qde.Atu. como quantidade e carrega só as escolhidas", async ({
  page,
}) => {
  await enviar(page, "ALMOXARIFADO.pdf", "application/pdf", pdfDoErp());
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("Colunas encontradas no PDF")).toBeVisible();
  await expect(dialogo).toContainText("3 item(ns) em 2 página(s)");
  for (const coluna of ["CODIGO", "DESCRICAO", "LOCALIZACAO", "UNI", "QDE.ATU.", "VAL. ESTOQUE"])
    await expect(dialogo.getByLabel(`Carregar a coluna ${coluna} como`)).toBeVisible();
  await expect(dialogo.getByLabel("Carregar a coluna QDE.ATU. como")).toHaveValue("quantidade");
  await expect(dialogo.getByLabel("Carregar a coluna UNI como")).toHaveValue("");
  // Prévia no mesmo formato da lista: descrição e "código • localização • Qtd".
  await expect(dialogo).toContainText("00190-0 • P36 - E19 • Qtd: 30");

  // Sem quantidade não carrega.
  await dialogo.getByLabel("Carregar a coluna QDE.ATU. como").selectOption("");
  await expect(dialogo.getByRole("button", { name: /Carregar 3/ })).toBeDisabled();
  await dialogo.getByLabel("Carregar a coluna QDE.ATU. como").selectOption("quantidade");

  await dialogo.getByRole("button", { name: "Carregar 3 item(ns)" }).click();
  await expect(dialogo).toBeHidden();
  const linhas = JSON.parse((await resultado(page).textContent()) ?? "[]");
  expect(linhas).toEqual([
    {
      codigo: "00007-7",
      descricao: "PARAFUSO 10 x 20mm ACO 8.8",
      locacao: "P36- A11",
      "quantidade esperada": "30,000",
    },
    {
      codigo: "00190-0",
      descricao: 'PARAFUSO 1/2x2" ALLEN CAB.CIL.',
      locacao: "P36 - E19",
      "quantidade esperada": "30,000",
    },
    {
      codigo: "20044-0",
      descricao: 'CHAVE IMPACTO PNEUMATICA 3/4"',
      locacao: "P09 - G08",
      "quantidade esperada": "1,000",
    },
  ]);
});

test("PDF: cancelar a escolha das colunas não importa nada", async ({ page }) => {
  await enviar(page, "lista.pdf", "application/pdf", pdfDoErp());
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(resultado(page)).toHaveText("cancelado");
});

test("Excel continua direto, sem a escolha de colunas", async ({ page }) => {
  const ws = XLSX.utils.json_to_sheet([
    { descricao: "Filtro de óleo", codigo: "F-1", "qde.esperada": 4 },
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lista");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await enviar(
    page,
    "lista.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  );
  await expect(resultado(page)).toContainText('"codigo":"F-1"');
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
