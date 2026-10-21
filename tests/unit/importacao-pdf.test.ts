/**
 * Leitura de listas em PDF (relatório do ERP em fonte de largura fixa): colunas pelo
 * cabeçalho, descrição colada na localização, números alinhados à direita, várias páginas,
 * cabeçalho/rodapé de página e linha de total ignorados.
 */
import { describe, expect, it } from "vitest";
import {
  linhasParaImportacao,
  montarTabela,
  quantidadeNaLista,
  sugerirMapeamento,
  type TextoPdf,
} from "@/lib/importacao-pdf";
import { acharColunaQuantidade, pick, toNumero } from "@/lib/app";

const CW = 4.136; // largura de um caractere (pontos)
/** Blocos de texto de uma linha: [coluna em caracteres, texto]. */
const linha = (y: number, partes: [number, string][]): TextoPdf[] =>
  partes.map(([col, str]) => ({ str, x: col * CW, y, largura: str.length * CW }));

const SEP = "=".repeat(132);
const TRACOS = "−".repeat(132);

function pagina(n: number, itens: TextoPdf[][]): TextoPdf[] {
  return [
    ...linha(816, [[7, SEP]]),
    ...linha(804, [
      [7, "ALCOESTE"],
      [68, "20/10/2026"],
      [127, "PAGINA"],
      [137, String(n)],
    ]),
    ...linha(792, [
      [7, "EPR001"],
      [40, "RELATORIO DE MATERIAIS − POSICAO EM 20/10/26"],
    ]),
    ...linha(780, [[7, SEP]]),
    ...linha(768, [
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
    ]),
    ...linha(756, [[7, TRACOS]]),
    ...itens.flat(),
  ];
}

const PAG1 = pagina(1, [
  linha(744, [
    [7, "00007−7"],
    [15, "PARAFUSO 10 x 20mm ACO 8.8"],
    [46, "P36− A11"],
    [59, "PC"],
    [77, "9,38"],
    [84, "100,000"],
    [94, "300,000"],
    [107, "30,000"],
    [122, "0,42"],
    [134, "12,60"],
  ]),
  // Descrição e localização no mesmo bloco de texto.
  linha(732, [
    [7, "00190−0"],
    [15, 'PARAFUSO 1/2x2" ALLEN CAB.CIL. P36 − E19'],
    [59, "PC"],
    [77, "1,14"],
    [84, "100,000"],
    [94, "200,000"],
    [107, "30,000"],
    [122, "1,21"],
    [134, "36,30"],
  ]),
  // Localização e unidade juntas; números largos que passam do início do título.
  linha(720, [
    [7, "20044−0"],
    [15, 'CHAVE IMPACTO PNEUMATICA 3/4"'],
    [46, "P07 − PAREDE PC"],
    [73, "1.608,00"],
    [86, "0,000"],
    [96, "0,000"],
    [108, "1,000"],
    [118, "1.771,31"],
    [131, "2.255,10"],
  ]),
  // Sem localização; texto extra ainda dentro da coluna da descrição.
  linha(708, [
    [7, "05923−9"],
    [15, "OLEO HIDRAULICO"],
    [32, "HV100"],
    [59, "L"],
    [76, "12,87"],
    [83, "1000,000"],
    [93, "3000,000"],
    [107, "11,000"],
    [121, "11,67"],
    [133, "128,37"],
  ]),
]);

const PAG2 = pagina(2, [
  linha(744, [
    [7, "41148−8"],
    [15, "CABO GIRO ELEVADOR JD"],
    [46, "P03 − PAREDE"],
    [59, "PC"],
    [75, "310,98"],
    [86, "5,000"],
    [95, "10,000"],
    [108, "1,000"],
    [120, "279,88"],
    [133, "279,88"],
  ]),
  // Descrição quebrada em duas linhas.
  linha(732, [[15, "CH950"]]),
  linha(720, [[7, TRACOS]]),
  linha(708, [
    [7, "TOTAL"],
    [13, "DE PRODUTOS :"],
    [29, "5"],
    [130, "2.712,14"],
  ]),
]);

describe("Importação de PDF", () => {
  const tabela = montarTabela([PAG1, PAG2])!;

  it("identifica as colunas do cabeçalho (título em dois blocos vira um só)", () => {
    expect(tabela.colunas).toEqual([
      "CODIGO",
      "DESCRICAO",
      "LOCALIZACAO",
      "UNI",
      "ULT.PRECO",
      "EST.MIN.",
      "EST.MAX.",
      "QDE.ATU.",
      "CUSTO MEDIO",
      "VAL. ESTOQUE",
    ]);
    expect(tabela.paginas).toBe(2);
  });

  it("lê todas as páginas, sem cabeçalho de página, separadores nem total", () => {
    expect(tabela.linhas.map((l) => l.CODIGO)).toEqual([
      "00007−7",
      "00190−0",
      "20044−0",
      "05923−9",
      "41148−8",
    ]);
  });

  it("separa descrição, localização e unidade mesmo quando vêm no mesmo bloco", () => {
    expect(tabela.linhas[1]).toMatchObject({
      DESCRICAO: 'PARAFUSO 1/2x2" ALLEN CAB.CIL.',
      LOCALIZACAO: "P36 − E19",
      UNI: "PC",
    });
    expect(tabela.linhas[2]).toMatchObject({ LOCALIZACAO: "P07 − PAREDE", UNI: "PC" });
    expect(tabela.linhas[3]).toMatchObject({ DESCRICAO: "OLEO HIDRAULICO HV100", LOCALIZACAO: "" });
  });

  it("números alinhados à direita ficam na coluna certa", () => {
    expect(tabela.linhas[2]).toMatchObject({
      "ULT.PRECO": "1.608,00",
      "QDE.ATU.": "1,000",
      "CUSTO MEDIO": "1.771,31",
      "VAL. ESTOQUE": "2.255,10",
    });
    expect(tabela.linhas[3]).toMatchObject({ "EST.MIN.": "1000,000", "EST.MAX.": "3000,000" });
  });

  it("junta a continuação da descrição na linha anterior", () => {
    expect(tabela.linhas[4].DESCRICAO).toBe("CABO GIRO ELEVADOR JD CH950");
  });

  it("sugere código, descrição, localização e QDE.ATU. como quantidade esperada", () => {
    expect(sugerirMapeamento(tabela.colunas)).toEqual({
      codigo: "CODIGO",
      descricao: "DESCRICAO",
      locacao: "LOCALIZACAO",
      quantidade: "QDE.ATU.",
    });
  });

  it("gera linhas que a importação de planilha já entende (só as colunas escolhidas)", () => {
    const rows = linhasParaImportacao(tabela, sugerirMapeamento(tabela.colunas));
    expect(Object.keys(rows[0])).toEqual(["codigo", "descricao", "locacao", "quantidade esperada"]);
    const col = acharColunaQuantidade(rows)!;
    expect(rows.map((r) => toNumero(r[col]))).toEqual([30, 30, 1, 11, 1]);
    expect(pick(rows[1], ["locacao", "local", "endereco"])).toBe("P36 − E19");
    expect(pick(rows[0], ["codigo", "cod"])).toBe("00007−7");
  });

  it("coluna deixada como referência não é carregada", () => {
    const rows = linhasParaImportacao(tabela, {
      codigo: "CODIGO",
      descricao: "DESCRICAO",
      locacao: null,
      quantidade: "QDE.ATU.",
    });
    expect(rows[0]).not.toHaveProperty("locacao");
  });

  it("prévia mostra a quantidade como na lista", () => {
    expect(["30,000", "1.000,500", "2", "", "—"].map(quantidadeNaLista)).toEqual([
      "30",
      "1000.5",
      "2",
      "",
      "—",
    ]);
  });

  it("PDF sem cabeçalho reconhecível (ex.: só imagem) não gera tabela", () => {
    expect(montarTabela([])).toBeNull();
    expect(montarTabela([linha(700, [[7, "Documento digitalizado"]])])).toBeNull();
  });
});
