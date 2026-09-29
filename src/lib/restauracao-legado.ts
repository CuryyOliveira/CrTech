/**
 * Restauração dos dados exportados da Lovable Cloud (arquivos CSV do Painel "Cloud → Database").
 * Lê os CSVs no navegador e envia em lotes para o servidor, que grava mantendo os IDs originais.
 */

/** Ordem de gravação: tabelas referenciadas antes das que dependem delas. */
export const ORDEM_RESTAURACAO = [
  "empresas",
  "empresa_setores",
  "empresa_modulos",
  "empresa_usuarios",
  "profiles",
  "user_profiles",
  "user_roles",
  "permissoes_perfil",
  "permissoes_usuario",
  "cadastros_mestres",
  "integracoes",
  "configuracoes_sistema",
  "planos",
  "assinaturas",
  "assinatura_pagamentos",
  "avisos_sistema",
  "aviso_leituras",
  "metas",
  "unidades",
  "materiais",
  "material_imagens",
  "conferencias",
  "conferencia_itens",
  "conferencia_pausas",
  "historico_conferencias",
  "notificacoes_conferencia",
  "notificacao_emails",
  "notificacao_leituras",
  "auditoria",
] as const;

export type TabelaRestauracao = (typeof ORDEM_RESTAURACAO)[number];

/** Tabelas exportadas que não são restauradas (eventos de teste de pagamento). */
export const TABELAS_IGNORADAS = ["webhook_eventos_pagamento"];

/** Nome da tabela a partir do arquivo exportado (ex.: "materiais-export-2026-09-28_20-57-53.csv"). */
export function tabelaDoArquivo(nome: string): string | null {
  const m = /^(?:[0-9a-f]{8}-)?([a-z_]+)-export-/i.exec(nome);
  return m ? m[1].toLowerCase() : null;
}

/** Lê um CSV (separador ";" e aspas duplas, como exportado pela Lovable Cloud). */
export function lerCsv(texto: string): Record<string, string>[] {
  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  const [cabecalho, ...dados] = linhas.filter((l) => !(l.length === 1 && l[0] === ""));
  if (!cabecalho) return [];
  return dados.map((l) => Object.fromEntries(cabecalho.map((c, i) => [c, l[i] ?? ""])));
}

/** Divide os registros em lotes de até ~700 KB ou 500 linhas. */
export function emLotes(registros: Record<string, string>[]) {
  const lotes: Record<string, string>[][] = [];
  let atual: Record<string, string>[] = [];
  let tamanho = 0;
  for (const r of registros) {
    const t = JSON.stringify(r).length;
    if (atual.length && (tamanho + t > 700_000 || atual.length >= 500)) {
      lotes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(r);
    tamanho += t;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
