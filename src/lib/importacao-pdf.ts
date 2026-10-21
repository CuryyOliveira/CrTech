/**
 * Leitura de listas em PDF (relatórios do ERP em fonte de largura fixa, como o
 * "RELATORIO DE MATERIAIS"). O PDF não tem colunas de verdade: cada texto tem só a posição
 * na página, e o ERP às vezes junta descrição e localização no mesmo bloco de texto. Por isso
 * cada linha é remontada caractere a caractere e cortada nas posições dos títulos do
 * cabeçalho — o mesmo que se faz ao converter o PDF em planilha à mão.
 *
 * Tudo roda no aparelho: o arquivo não é enviado a nenhum serviço.
 */
import { normalize } from "@/lib/texto";

/** Um bloco de texto do PDF: posição (pontos, origem embaixo à esquerda) e largura. */
export type TextoPdf = { str: string; x: number; y: number; largura: number };

export type TabelaPdf = {
  /** Títulos das colunas, na ordem do cabeçalho. */
  colunas: string[];
  /** Uma linha por item, indexada pelo título da coluna (textos já sem espaços extras). */
  linhas: Record<string, string>[];
  paginas: number;
};

/** Destinos possíveis de uma coluna do PDF na lista do app. */
export type CampoLista = "codigo" | "descricao" | "locacao" | "quantidade";

export const CAMPOS_LISTA: { campo: CampoLista; rotulo: string }[] = [
  { campo: "codigo", rotulo: "Código" },
  { campo: "descricao", rotulo: "Descrição" },
  { campo: "locacao", rotulo: "Localização" },
  { campo: "quantidade", rotulo: "Qtd. esperada" },
];

/** Palavras que identificam a linha de cabeçalho. */
const TITULOS = ["codigo", "cod", "descricao", "localizacao", "locacao", "uni", "qde", "qtd"];

/** Sugestão inicial (a pessoa confirma ou troca na tela de seleção de colunas). */
const SUGESTAO: Record<CampoLista, string[]> = {
  codigo: ["codigo", "cod"],
  descricao: ["descricao", "material"],
  locacao: ["localizacao", "locacao", "local", "endereco"],
  quantidade: ["qde atu", "qtd atu", "qde atual", "quantidade atual", "qde", "qtd", "saldo"],
};

const chave = (s: string) =>
  normalize(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();

function mediana(v: number[]) {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

/** Agrupa os textos de uma página em linhas (de cima para baixo). */
function linhasDaPagina(itens: TextoPdf[]) {
  const ordenados = itens.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: TextoPdf[][] = [];
  for (const it of ordenados) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima[0].y - it.y) <= 2) ultima.push(it);
    else linhas.push([it]);
  }
  return linhas.map((l) => l.sort((a, b) => a.x - b.x));
}

/** Monta o texto da linha em uma grade de caracteres (uma posição por caractere). */
function grade(linha: TextoPdf[], larguraChar: number) {
  const chars: string[] = [];
  for (const it of linha) {
    const inicio = Math.max(0, Math.round(it.x / larguraChar));
    for (let i = 0; i < it.str.length; i++) chars[inicio + i] = it.str[i];
  }
  return Array.from(chars, (c) => c ?? " ").join("");
}

type Coluna = { nome: string; inicio: number; fim: number };

function ehCabecalho(texto: string) {
  const palavras = new Set(chave(texto).split(" "));
  return TITULOS.filter((t) => palavras.has(t)).length >= 2;
}

/** Títulos do cabeçalho, com o início e o fim (em caracteres) de cada um. */
function colunasDoCabecalho(linha: TextoPdf[], larguraChar: number): Coluna[] {
  return linha.map((it) => {
    const inicio = Math.round(it.x / larguraChar);
    return { nome: limpar(it.str), inicio, fim: inicio + it.str.length };
  });
}

/**
 * Um título de duas palavras pode vir em dois blocos ("VAL." "ESTOQUE"). O bloco que fica
 * sempre vazio nos dados e está colado no seguinte (até um espaço) vira parte do título dele.
 */
function juntarTitulosPartidos(colunas: Coluna[], linhas: string[][]) {
  const cols = colunas.map((c, k) => ({ ...c, k }));
  for (let i = cols.length - 2; i >= 0; i--) {
    const vazia = linhas.every((l) => !l[cols[i].k]);
    if (vazia && cols[i + 1].inicio - cols[i].fim <= 1) {
      cols[i + 1] = {
        ...cols[i + 1],
        nome: `${cols[i].nome} ${cols[i + 1].nome}`,
        inicio: cols[i].inicio,
      };
      cols.splice(i, 1);
    }
  }
  // Nomes repetidos ganham sufixo para não sobrescrever valores.
  const vistos = new Map<string, number>();
  return cols.map((c) => {
    const n = (vistos.get(c.nome) ?? 0) + 1;
    vistos.set(c.nome, n);
    return { nome: n > 1 ? `${c.nome} (${n})` : c.nome, k: c.k };
  });
}

/**
 * Corta a linha nas colunas. Um texto que atravessa o limite entre duas colunas (ex.: um
 * número alinhado à direita mais largo que o título) fica inteiro do lado onde está a maior
 * parte dele.
 */
function cortar(texto: string, colunas: Coluna[]) {
  const espaco = (i: number) => i < 0 || i >= texto.length || texto[i] === " ";
  const limites = colunas.map((c, i) => {
    if (i === 0) return 0;
    const b = c.inicio;
    if (espaco(b - 1) || espaco(b)) return b;
    let ini = b;
    while (!espaco(ini - 1)) ini--;
    let fim = b;
    while (!espaco(fim)) fim++;
    return b - ini > fim - b ? fim : ini;
  });
  return colunas.map((_, i) =>
    limpar(texto.slice(limites[i], i + 1 < limites.length ? limites[i + 1] : undefined)),
  );
}

const SEPARADOR = /^[\s=\-−–—_.*]+$/;

/**
 * Converte os textos do PDF (uma lista por página) na tabela de itens. Ignora cabeçalhos
 * e rodapés de página, linhas separadoras e a linha de total. Retorna null quando o PDF não
 * tem um cabeçalho de colunas reconhecível (ex.: PDF escaneado, sem texto).
 */
export function montarTabela(paginas: TextoPdf[][]): TabelaPdf | null {
  const larguras = paginas
    .flat()
    .filter((i) => i.str.trim().length >= 3 && i.largura > 0)
    .map((i) => i.largura / i.str.length);
  const larguraChar = mediana(larguras);
  if (!larguraChar) return null;

  let colunas: Coluna[] | null = null;
  let assinatura = "";
  const linhas: string[][] = [];

  for (const pagina of paginas) {
    const todas = linhasDaPagina(pagina);
    let i = 0;
    if (!colunas) {
      const h = todas.findIndex((l) => ehCabecalho(l.map((t) => t.str).join(" ")));
      if (h < 0) continue;
      colunas = colunasDoCabecalho(todas[h], larguraChar);
      assinatura = chave(todas[h].map((t) => t.str).join(" "));
      i = h + 1;
    } else {
      // Páginas seguintes: começa depois do cabeçalho repetido (se houver).
      const h = todas.findIndex((l) => chave(l.map((t) => t.str).join(" ")) === assinatura);
      if (h >= 0) i = h + 1;
    }

    for (; i < todas.length; i++) {
      const texto = grade(todas[i], larguraChar);
      if (SEPARADOR.test(texto)) continue;
      if (chave(texto) === assinatura) continue;
      const celulas = cortar(texto, colunas);
      if (celulas.every((c) => !c)) continue;
      if (chave(celulas[0]).startsWith("total")) continue;

      // Continuação de texto quebrado em duas linhas (só uma coluna, sem código).
      const preenchidas = celulas.map((c, k) => (c ? k : -1)).filter((k) => k >= 0);
      const anterior = linhas[linhas.length - 1];
      if (!celulas[0] && anterior && preenchidas.length === 1) {
        const k = preenchidas[0];
        anterior[k] = limpar(`${anterior[k]} ${celulas[k]}`);
        continue;
      }
      if (!celulas[0]) continue;
      linhas.push(celulas);
    }
  }

  if (!colunas) return null;
  const finais = juntarTitulosPartidos(colunas, linhas);
  return {
    colunas: finais.map((c) => c.nome),
    linhas: linhas.map((l) => Object.fromEntries(finais.map((c) => [c.nome, l[c.k]]))),
    paginas: paginas.length,
  };
}

/** Coluna sugerida para cada campo da lista (null quando nenhuma combina). */
export function sugerirMapeamento(colunas: string[]): Record<CampoLista, string | null> {
  const usadas = new Set<string>();
  const achar = (aliases: string[]) => {
    for (const a of aliases) {
      const hit =
        colunas.find((c) => !usadas.has(c) && chave(c) === a) ??
        colunas.find((c) => !usadas.has(c) && chave(c).startsWith(a));
      if (hit) {
        usadas.add(hit);
        return hit;
      }
    }
    return null;
  };
  return {
    codigo: achar(SUGESTAO.codigo),
    descricao: achar(SUGESTAO.descricao),
    locacao: achar(SUGESTAO.locacao),
    quantidade: achar(SUGESTAO.quantidade),
  };
}

/**
 * Linhas no mesmo formato da leitura de planilha, só com as colunas escolhidas, para seguir
 * pelo mesmo caminho de importação (mesclagem de repetidos, atualização sem duplicar).
 */
export function linhasParaImportacao(
  tabela: TabelaPdf,
  mapa: Record<CampoLista, string | null>,
): Record<string, unknown>[] {
  const nomes: Record<CampoLista, string> = {
    codigo: "codigo",
    descricao: "descricao",
    locacao: "locacao",
    quantidade: "quantidade esperada",
  };
  return tabela.linhas.map((l) => {
    const out: Record<string, unknown> = {};
    for (const { campo } of CAMPOS_LISTA) {
      const col = mapa[campo];
      if (col) out[nomes[campo]] = l[col] ?? "";
    }
    return out;
  });
}

/** Lê o PDF no aparelho (pdf.js) e devolve a tabela de itens. */
export function lerPdf(file: File): Promise<TabelaPdf | null> {
  // Fora do navegador (build do servidor) o pdf.js nem entra no pacote.
  return import.meta.env.SSR
    ? Promise.reject(new Error("Leitura de PDF disponível só no aparelho."))
    : lerNoAparelho(file);
}

async function lerNoAparelho(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: worker } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const paginas: TextoPdf[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pagina = await doc.getPage(p);
      const conteudo = await pagina.getTextContent();
      paginas.push(
        conteudo.items.flatMap((it) =>
          "str" in it
            ? [{ str: it.str, x: it.transform[4], y: it.transform[5], largura: it.width }]
            : [],
        ),
      );
    }
    return montarTabela(paginas);
  } finally {
    void doc.destroy();
  }
}

/** Quantidade como aparece na lista ("30,000" → "30"); texto original se não for número. */
export function quantidadeNaLista(v: string) {
  const s = v.replace(/[^\d,.-]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return s && Number.isFinite(n) ? String(n) : v;
}

export function ehPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
