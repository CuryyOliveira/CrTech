/**
 * Modelo institucional dos e-mails automáticos: cabeçalho com identidade
 * visual, título destacado, informações em tabela e rodapé padrão.
 */
import {
  conteudoNotificacao,
  dataHoraLocal,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";

export const SISTEMA_NOME = "Conferência de Materiais";
export const SISTEMA_VERSAO = "1.0";

const LARANJA = "#ea580c";
const CINZA = "#f4f4f5";
const TEXTO = "#18181b";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function corDoTipo(gravidade: string) {
  if (gravidade === "critica") return "#dc2626";
  if (gravidade === "atencao") return "#ca8a04";
  if (gravidade === "sucesso") return "#059669";
  return LARANJA;
}

/** Monta o HTML final do e-mail de uma notificação. */
export function htmlNotificacao(n: NotificacaoConferenciaRow, gravidade: string) {
  const c = conteudoNotificacao(n);
  const cor = corDoTipo(gravidade);
  const { data, hora } = dataHoraLocal();

  const linhas = c.linhas
    .map(
      (l) => `<tr>
        <td style="padding:10px 12px;background:${CINZA};font-size:13px;color:#52525b;width:38%;border-bottom:1px solid #e4e4e7">${esc(l.rotulo)}</td>
        <td style="padding:10px 12px;font-size:13px;color:${TEXTO};border-bottom:1px solid #e4e4e7;white-space:pre-wrap">${esc(l.valor)}</td>
      </tr>`,
    )
    .join("");

  const divergencias = c.divergencias.length
    ? `<h3 style="margin:24px 0 8px;font-size:15px;color:${cor}">Divergências encontradas (${c.divergencias.length})</h3>
       <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e4e7">
         <tr style="background:${CINZA}">
           ${["Código", "Descrição", "Esperada", "Encontrada", "Diferença"]
             .map(
               (h) =>
                 `<th align="left" style="padding:8px 10px;font-size:12px;color:#52525b;border-bottom:1px solid #e4e4e7">${h}</th>`,
             )
             .join("")}
         </tr>
         ${c.divergencias
           .map((d) => {
             const dif =
               d.encontrada != null && d.esperada != null
                 ? String(Number(d.encontrada) - Number(d.esperada))
                 : "—";
             return `<tr>
               <td style="padding:8px 10px;font-size:12px;border-bottom:1px solid #f1f1f4">${esc(d.codigo ?? "—")}</td>
               <td style="padding:8px 10px;font-size:12px;border-bottom:1px solid #f1f1f4">${esc(d.descricao ?? "—")}</td>
               <td style="padding:8px 10px;font-size:12px;border-bottom:1px solid #f1f1f4">${esc(String(d.esperada ?? "—"))}</td>
               <td style="padding:8px 10px;font-size:12px;border-bottom:1px solid #f1f1f4">${esc(String(d.encontrada ?? "—"))}</td>
               <td style="padding:8px 10px;font-size:12px;font-weight:bold;color:#dc2626;border-bottom:1px solid #f1f1f4">${esc(dif)}</td>
             </tr>`;
           })
           .join("")}
       </table>`
    : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 0;background:#ffffff;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden">
      <tr><td style="background:${LARANJA};padding:18px 24px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:42px">
            <div style="width:36px;height:36px;border-radius:8px;background:#ffffff;color:${LARANJA};font-size:18px;font-weight:bold;text-align:center;line-height:36px">CM</div>
          </td>
          <td style="padding-left:10px;color:#ffffff;font-size:16px;font-weight:bold">${SISTEMA_NOME}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px">
        <h2 style="margin:0 0 6px;font-size:19px;color:${cor};text-transform:uppercase">${esc(c.titulo)}</h2>
        <p style="margin:0 0 18px;font-size:14px;color:#52525b">${esc(c.intro)}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e4e7">${linhas}</table>
        ${divergencias}
        <p style="margin:22px 0 0;font-size:13px;color:#52525b">Acesse a Central Administrativa para acompanhar em tempo real.</p>
      </td></tr>
      <tr><td style="background:${CINZA};padding:16px 24px;font-size:11px;color:#71717a">
        ${esc(data.split("-").reverse().join("/"))} às ${esc(hora)} · ${SISTEMA_NOME} · versão ${SISTEMA_VERSAO}<br>
        Este é um e-mail automático. Não responda.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
