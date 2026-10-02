import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fmtDate,
  fmtDateTime,
  fmtTime,
  foiAdicionadoNaConferencia,
  type Conferencia,
  type ItemConferencia,
} from "./app";

type Ctx = { unidadeNome: string; conf: Conferencia; itens: ItemConferencia[] };

const CAB_ADICIONADOS = [
  "Código",
  "Descrição",
  "Qtd. esperada",
  "Qtd. contada",
  "Motivo da inclusão",
  "Usuário responsável",
  "Data/hora",
];

function linhasAdicionados(itens: ItemConferencia[]) {
  return itens.filter(foiAdicionadoNaConferencia).map((i) => [
    i.codigo ?? "",
    i.descricao ?? "",
    Number(i.quantidade_esperada),
    i.quantidade_contada ?? "",
    i.motivo_inclusao ?? "",
    i.incluido_por_nome ?? "",
    fmtDateTime(i.incluido_em),
  ]);
}


export function exportExcel({ unidadeNome, conf, itens }: Ctx) {
  const head = [
    ["Unidade", unidadeNome],
    ["Data", fmtDate(conf.data)],
    ["Início", fmtTime(conf.hora_inicio)],
    ["Término", fmtTime(conf.hora_fim)],
    ["Conferente", conf.conferente ?? ""],
    ["Responsável", conf.responsavel ?? ""],
    ["Observações", conf.observacoes ?? ""],
    [],
    ["Código", "Descrição", "Locação", "Qtd. esperada", "Qtd. encontrada", "Divergência", "Observações"],
  ];
  const rows = itens.map((i) => [
    i.codigo ?? "",
    i.descricao ?? "",
    i.locacao ?? "",
    Number(i.quantidade_esperada),
    i.quantidade_contada ?? "",
    i.quantidade_contada == null ? "" : Number(i.quantidade_contada) - Number(i.quantidade_esperada),
    i.observacoes ?? "",
  ]);
  const adicionados = linhasAdicionados(itens);
  const secaoAdicionados = adicionados.length
    ? [[], ["MATERIAIS ADICIONADOS DURANTE A CONFERÊNCIA"], CAB_ADICIONADOS, ...adicionados]
    : [];
  const ws = XLSX.utils.aoa_to_sheet([...head, ...rows, ...secaoAdicionados]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conferência");
  if (adicionados.length) {
    const wsAdd = XLSX.utils.aoa_to_sheet([CAB_ADICIONADOS, ...adicionados]);
    XLSX.utils.book_append_sheet(wb, wsAdd, "Adicionados");
  }
  XLSX.writeFile(wb, `conferencia-${unidadeNome}-${conf.data}.xlsx`);
}


export function exportPDF({ unidadeNome, conf, itens }: Ctx) {
  const doc = new jsPDF();
  doc.setFontSize(15);
  doc.text("CONFERÊNCIA DE MATERIAIS", 14, 16);
  doc.setFontSize(10);
  doc.text(
    [
      `Unidade: ${unidadeNome}`,
      `Data: ${fmtDate(conf.data)}   Início: ${fmtTime(conf.hora_inicio)}   Término: ${fmtTime(conf.hora_fim)}`,
      `Conferente: ${conf.conferente ?? "—"}   Responsável: ${conf.responsavel ?? "—"}`,
      conf.almoxarife ? `Almoxarife: ${conf.almoxarife} (${conf.codigo_almoxarife ?? ""})` : "",
      `Observações: ${conf.observacoes ?? "—"}`,
    ].filter(Boolean),
    14,
    24,
  );

  autoTable(doc, {
    startY: 50,
    head: [["Código", "Descrição", "Locação", "Esperado", "Contado", "Diverg."]],
    body: itens.map((i) => [
      i.codigo ?? "",
      i.descricao ?? "",
      i.locacao ?? "",
      String(i.quantidade_esperada),
      i.quantidade_contada == null ? "—" : String(i.quantidade_contada),
      i.quantidade_contada == null
        ? "—"
        : String(Number(i.quantidade_contada) - Number(i.quantidade_esperada)),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [234, 88, 12] },
  });

  const adicionados = linhasAdicionados(itens);
  if (adicionados.length) {
    const yTab =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    doc.setFontSize(11);
    doc.text("MATERIAIS ADICIONADOS DURANTE A CONFERÊNCIA", 14, yTab);
    autoTable(doc, {
      startY: yTab + 4,
      head: [CAB_ADICIONADOS],
      body: adicionados.map((l) => l.map((v) => String(v ?? ""))),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [234, 88, 12] },
    });
  }

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

  if (y > 230) {
    doc.addPage();
    y = 30;
  }
  doc.setFontSize(10);
  doc.text(`Finalizada em: ${fmtDateTime(conf.hora_fim)}`, 14, y);
  y += 8;
  if (conf.assinatura) {
    doc.addImage(conf.assinatura, "PNG", 14, y, 70, 25);
    doc.line(14, y + 27, 84, y + 27);
    doc.text(`Assinatura: ${conf.conferente ?? ""}`, 14, y + 32);
  }
  if (conf.assinatura_gestor) {
    doc.addImage(conf.assinatura_gestor, "PNG", 110, y, 70, 25);
    doc.line(110, y + 27, 180, y + 27);
    doc.text(`Gestor: ${conf.responsavel ?? ""}`, 110, y + 32);
  }
  doc.save(`conferencia-${unidadeNome}-${conf.data}.pdf`);
}

export async function readSheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}
