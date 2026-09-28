/**
 * Geração de relatórios a partir do Histórico Operacional e do Log de Auditoria.
 * Exportações em PDF, Excel (.xlsx), CSV e impressão.
 */
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { dataLocalISO } from "@/lib/datas";

export type Coluna<T> = { chave: string; titulo: string; valor: (r: T) => string };

type Meta = { titulo: string; subtitulo: string; geradoEm: string };

function matriz<T>(colunas: Coluna<T>[], linhas: T[]) {
  return linhas.map((l) => colunas.map((c) => c.valor(l)));
}

export function relatorioExcel<T>(colunas: Coluna<T>[], linhas: T[], meta: Meta) {
  const aoa = [
    [meta.titulo],
    [meta.subtitulo],
    [`Gerado em: ${meta.geradoEm}`],
    [],
    colunas.map((c) => c.titulo),
    ...matriz(colunas, linhas),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, `${arquivo(meta.titulo)}.xlsx`);
}

export function relatorioCSV<T>(colunas: Coluna<T>[], linhas: T[], meta: Meta) {
  const escapar = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const corpo = [
    colunas.map((c) => c.titulo),
    ...matriz(colunas, linhas),
  ]
    .map((l) => l.map(escapar).join(";"))
    .join("\r\n");
  const conteudo = `\uFEFF${meta.titulo}\r\n${meta.subtitulo}\r\nGerado em: ${meta.geradoEm}\r\n\r\n${corpo}`;
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${arquivo(meta.titulo)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function relatorioPDF<T>(colunas: Coluna<T>[], linhas: T[], meta: Meta) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(meta.titulo, 14, 15);
  doc.setFontSize(9);
  doc.text([meta.subtitulo, `Gerado em: ${meta.geradoEm}`, `Registros: ${linhas.length}`], 14, 22);
  autoTable(doc, {
    startY: 38,
    head: [colunas.map((c) => c.titulo)],
    body: matriz(colunas, linhas),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [234, 88, 12] },
  });
  doc.save(`${arquivo(meta.titulo)}.pdf`);
}

export function relatorioImprimir<T>(colunas: Coluna<T>[], linhas: T[], meta: Meta) {
  const esc = (v: string) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(meta.titulo)}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;color:#111}
h1{font-size:18px;margin:0 0 4px}p{margin:0;font-size:12px;color:#555}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:10px}
th{background:#ea580c;color:#fff;text-align:left}
th,td{border:1px solid #ddd;padding:4px 6px}
tr:nth-child(even) td{background:#fafafa}
</style></head><body>
<h1>${esc(meta.titulo)}</h1><p>${esc(meta.subtitulo)}</p><p>Gerado em: ${esc(meta.geradoEm)} — ${linhas.length} registro(s)</p>
<table><thead><tr>${colunas.map((c) => `<th>${esc(c.titulo)}</th>`).join("")}</tr></thead>
<tbody>${matriz(colunas, linhas)
    .map((l) => `<tr>${l.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>
<script>window.onload=()=>{window.print();}</script>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function arquivo(titulo: string) {
  return `${titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${dataLocalISO()}`;
}
