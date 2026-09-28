import { MODULOS, type Tipo } from "@/lib/permissions";
import { registrarAuditoria, type TipoAcao } from "@/lib/audit";
import { dbOffline } from "@/lib/offline/db";
import { dataLocalISO, horaLocal } from "@/lib/datas";



export type { Tipo };


export type Unidade = {
  id: string;
  tipo: string;
  nome: string;
  placa: string | null;
  modelo: string | null;
  frota: string | null;
  ano: string | null;
  setor: string | null;
  matricula: string | null;
  gestor: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
};

export type Material = {
  id: string;
  unidade_id: string;
  codigo: string;
  descricao: string;
  quantidade_esperada: number;
  locacao: string | null;
  funcionario_nome: string | null;
  funcionario_codigo: string | null;
  imagem_principal: string | null;
};

export type Conferencia = {
  id: string;
  unidade_id: string;
  tipo: string;
  data: string;
  hora_inicio: string;
  hora_fim: string | null;
  conferente: string | null;
  responsavel: string | null;
  almoxarife: string | null;
  codigo_almoxarife: string | null;
  assinatura: string | null;
  assinatura_gestor: string | null;
  observacoes: string | null;
  status: string;
  total_tempo_pausado?: number | null;
  ultima_pausa?: string | null;
  ultima_retomada?: string | null;
  tempo_trabalhado?: number | null;
};

export type ItemConferencia = {
  id: string;
  conferencia_id: string;
  material_id: string | null;
  codigo: string | null;
  descricao: string | null;
  locacao: string | null;
  quantidade_esperada: number;
  quantidade_contada: number | null;
  observacoes: string | null;
  fotos: string[];
  status: string;
  /** "lista" (importada/cadastrada) ou "adicionado" (incluído durante a conferência). */
  origem?: string | null;
  motivo_inclusao?: string | null;
  incluido_por?: string | null;
  incluido_por_nome?: string | null;
  incluido_em?: string | null;
};

/** Valor de `origem` usado nos itens incluídos durante a conferência. */
export const ORIGEM_ADICIONADO = "adicionado";

export const ORIGEM_ADICIONADO_LABEL = "Adicionado durante a conferência";

export function foiAdicionadoNaConferencia(i: Pick<ItemConferencia, "origem">) {
  return i.origem === ORIGEM_ADICIONADO;
}


export const TIPO_LABEL: Record<string, string> = Object.fromEntries(
  MODULOS.map((m) => [m.tipo, m.titulo]),
);


/**
 * Acesso ao banco com suporte offline: online é 100% Supabase (comportamento
 * inalterado) e, sem internet, lê do cache local e enfileira as alterações.
 */
export const db = dbOffline as unknown as { from: (t: string) => any };


const TIPO_POR_ACAO: Record<string, TipoAcao> = {
  cadastro: "usuarios",
  exclusao: "administracao",
  importacao: "importacao",
  conferencia: "operacao",
  assinatura: "operacao",
  exportacao: "exportacao",
  login: "autenticacao",
  logout: "autenticacao",
};

/** Registro rápido no Log de Auditoria (compatível com as chamadas existentes). */
export async function log(
  acao: string,
  detalhe?: string,
  extra?: { tipo?: TipoAcao; modulo?: string | null; lista?: string | null; resultado?: "sucesso" | "erro" | "negado" },
) {
  await registrarAuditoria({
    tipo: extra?.tipo ?? TIPO_POR_ACAO[acao] ?? "operacao",
    acao,
    detalhe: detalhe ?? null,
    modulo: extra?.modulo ?? null,
    lista: extra?.lista ?? null,
    ...(extra?.resultado ? { resultado: extra.resultado } : {}),
  });
}


/**
 * Datas sempre no fuso da operação. Strings de data pura (YYYY-MM-DD) são
 * formatadas sem conversão — nunca interpretadas como UTC (o que jogava a
 * conferência para o dia anterior).
 */
export function fmtDate(v?: string | null) {
  if (!v) return "—";
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  return dataLocalISO(v).split("-").reverse().join("/");
}

export function fmtTime(v?: string | null) {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return "—";
  return horaLocal(v);
}

export function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return `${fmtDate(v)} ${fmtTime(v)}`;
}


/** Compress an image file to a small JPEG data URL. */
export function compressImage(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function normalize(s: unknown) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Natural (alphanumeric) comparison: A1 < A2 < A10. */
export function natCompare(a?: string | null, b?: string | null) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x) return y ? 1 : 0;
  if (!y) return -1;
  return x.localeCompare(y, "pt-BR", { numeric: true, sensitivity: "base" });
}

/** Sort items by locação (menor para maior), falling back to código. */
export function ordenarPorLocacao<T extends { locacao?: string | null; codigo?: string | null }>(
  arr: T[],
) {
  return [...arr].sort((a, b) => natCompare(a.locacao, b.locacao) || natCompare(a.codigo, b.codigo));
}

/** Normalized header key: "QDE.ESPERADA" -> "qde esperada". */
export function chaveColuna(s: unknown) {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find a value in a spreadsheet row by fuzzy column name. */
export function pick(row: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(row);
  for (const k of keys) {
    const alvo = chaveColuna(k);
    const hit =
      entries.find(([col]) => chaveColuna(col) === alvo) ??
      entries.find(([col]) => chaveColuna(col).includes(alvo));
    if (hit && hit[1] !== undefined && hit[1] !== null && String(hit[1]).trim() !== "")
      return String(hit[1]).trim();
  }
  return "";
}

/** Aliases aceitos para a coluna de quantidade esperada (ordem = prioridade). */
export const COLUNAS_QUANTIDADE = [
  "quantidade esperada",
  "qtd esperada",
  "qtde esperada",
  "qde esperada",
  "qtd do sistema",
  "qtde do sistema",
  "qtd sistema",
  "quantidade sistema",
  "quantidade prevista",
  "saldo estoque",
  "saldo",
  "estoque",
  "quantidade",
  "qtde",
  "qtd",
  "qde",
];

/**
 * Localiza o nome real da coluna de quantidade nas linhas lidas da planilha.
 * Retorna null quando nenhuma variação compatível existe (importação deve abortar).
 */
export function acharColunaQuantidade(
  rows: Record<string, unknown>[],
  keys: string[] = COLUNAS_QUANTIDADE,
) {
  const colunas = new Set<string>();
  for (const r of rows) for (const c of Object.keys(r)) colunas.add(c);
  const lista = [...colunas];
  for (const k of keys) {
    const alvo = chaveColuna(k);
    const hit =
      lista.find((c) => chaveColuna(c) === alvo) ?? lista.find((c) => chaveColuna(c).includes(alvo));
    if (hit) return hit;
  }
  return null;
}

/** Alias genérico: localiza o nome real de uma coluna a partir de aliases. */
export const acharColuna = acharColunaQuantidade;

/** Lista todos os cabeçalhos presentes nas linhas lidas da planilha. */
export function listarColunas(rows: Record<string, unknown>[]) {
  const set = new Set<string>();
  for (const r of rows) for (const c of Object.keys(r)) set.add(c);
  return [...set];
}



/** Converte texto de planilha ("1.234,50", "12 PC") em número; null quando não numérico. */
export function toNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}


/** Limpa espaços extras e caracteres invisíveis de textos de planilha. */
export function limparTexto(v: unknown) {
  return String(v ?? "")
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave de unicidade de material dentro de uma lista: código + locação. */
export function chaveMaterial(codigo?: string | null, locacao?: string | null) {
  return `${limparTexto(codigo).toUpperCase()}||${limparTexto(locacao).toUpperCase()}`;
}

export type MaterialImportado = {
  codigo: string;
  descricao: string;
  locacao?: string | null;
  quantidade_esperada: number;
  funcionario_nome?: string | null;
  funcionario_codigo?: string | null;
};

export type ResultadoGravacao = { inseridos: number; atualizados: number; mesclados: number };

/**
 * Grava materiais de uma importação sem nunca criar duplicidade:
 * linhas repetidas na planilha são mescladas (quantidades somadas) e códigos
 * já existentes na lista são atualizados em vez de duplicados.
 */
export async function salvarMateriais(
  unidadeId: string,
  itens: MaterialImportado[],
): Promise<ResultadoGravacao> {
  const mapa = new Map<string, MaterialImportado>();
  let mesclados = 0;
  for (const bruto of itens) {
    const item: MaterialImportado = {
      ...bruto,
      codigo: limparTexto(bruto.codigo) || "—",
      descricao: limparTexto(bruto.descricao),
      locacao: limparTexto(bruto.locacao) || null,
    };
    const k = chaveMaterial(item.codigo, item.locacao);
    const atual = mapa.get(k);
    if (atual) {
      atual.quantidade_esperada += item.quantidade_esperada;
      atual.descricao = atual.descricao || item.descricao;
      mesclados++;
    } else {
      mapa.set(k, item);
    }
  }

  const { data: existentes, error } = await db
    .from("materiais")
    .select("id,codigo,locacao")
    .eq("unidade_id", unidadeId);
  if (error) throw new Error(error.message);

  const porChave = new Map<string, string>();
  for (const e of (existentes ?? []) as { id: string; codigo: string; locacao: string | null }[])
    porChave.set(chaveMaterial(e.codigo, e.locacao), e.id);

  const novos: Record<string, unknown>[] = [];
  let atualizados = 0;
  for (const [k, item] of mapa) {
    const id = porChave.get(k);
    if (id) {
      const { error: erroUp } = await db.from("materiais").update(item).eq("id", id);
      if (erroUp) throw new Error(erroUp.message);
      atualizados++;
    } else {
      novos.push({ unidade_id: unidadeId, ...item });
    }
  }
  let inseridos = novos.length;
  if (novos.length) {
    const { error: erroIns } = await db.from("materiais").insert(novos);
    if (erroIns) {
      // Conflito com item já existente (normalização do banco difere do texto da
      // planilha): grava linha por linha e atualiza o que já estiver cadastrado.
      if (erroIns.code !== "23505") throw new Error(erroIns.message);
      inseridos = 0;
      for (const novo of novos) {
        const { error: erroUnico } = await db.from("materiais").insert(novo);
        if (!erroUnico) {
          inseridos++;
          continue;
        }
        if (erroUnico.code !== "23505") throw new Error(erroUnico.message);
        const { unidade_id: _u, ...campos } = novo;
        const { error: erroMerge } = await db
          .from("materiais")
          .update(campos)
          .eq("unidade_id", unidadeId)
          .eq("codigo", String(novo.codigo ?? ""));
        if (erroMerge) throw new Error(erroMerge.message);
        atualizados++;
      }
    }
  }
  return { inseridos, atualizados, mesclados };
}

