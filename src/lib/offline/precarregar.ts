/**
 * Pré-carga e sincronização incremental (delta sync) dos dados usados offline.
 *
 * Após o primeiro login online tudo é baixado em segundo plano e guardado no
 * IndexedDB. Nas próximas vezes só as linhas alteradas desde a última carga são
 * baixadas (marca d'água por tabela), sem apagar conferências pendentes.
 */
import { supabase } from "@/integrations/supabase/client";
import { guardarLinhas, lerLinhas, type Linha } from "./fila";
import { estaOffline } from "./estado";
import { gravarLocal, hidratarOffline, lerLocal } from "./idb";

const sb = supabase as unknown as { from: (t: string) => any };

type Tabela = {
  tabela: string;
  rotulo: string;
  /** Coluna usada para o delta sync (null = tabela pequena, recarrega inteira). */
  delta?: string | null;
  limite?: number;
};

/** Tabelas replicadas localmente, na ordem em que são baixadas. */
const TABELAS: Tabela[] = [
  { tabela: "user_profiles", rotulo: "Perfis de acesso", delta: "updated_at" },
  { tabela: "permissoes_perfil", rotulo: "Permissões", delta: "updated_at" },
  { tabela: "permissoes_usuario", rotulo: "Permissões do usuário", delta: "updated_at" },
  { tabela: "configuracoes_sistema", rotulo: "Configurações", delta: "updated_at" },
  { tabela: "cadastros_mestres", rotulo: "Cadastros", delta: "updated_at" },
  { tabela: "empresas", rotulo: "Empresa", delta: "updated_at", limite: 50 },
  { tabela: "empresa_usuarios", rotulo: "Usuários da empresa", delta: "updated_at", limite: 500 },
  { tabela: "empresa_setores", rotulo: "Setores da empresa", delta: "updated_at", limite: 300 },
  { tabela: "empresa_modulos", rotulo: "Módulos da empresa", delta: "updated_at", limite: 200 },
  { tabela: "planos", rotulo: "Planos", delta: "updated_at", limite: 50 },
  { tabela: "unidades", rotulo: "Frotas e unidades", delta: "created_at" },
  { tabela: "materiais", rotulo: "Materiais e listas", delta: "created_at", limite: 50000 },
  { tabela: "material_imagens", rotulo: "Imagens dos materiais", delta: "created_at", limite: 8000 },
  { tabela: "conferencias", rotulo: "Conferências", delta: "created_at", limite: 4000 },
  { tabela: "conferencia_itens", rotulo: "Itens conferidos", delta: "updated_at", limite: 40000 },
  { tabela: "avisos_sistema", rotulo: "Avisos", delta: "updated_at", limite: 300 },
  {
    tabela: "historico_conferencias",
    rotulo: "Histórico",
    delta: "updated_at",
    limite: 2000,
  },
];

const CHAVE_ULTIMA = "cr:precarga";
const CHAVE_MARCAS = "cr:precarga:marcas";
/** Páginas menores evitam que o banco cancele a consulta por tempo excedido. */
const PAGINA = 400;

export type ProgressoOffline = {
  ativo: boolean;
  etapa: string;
  atual: number;
  total: number;
  pronto: boolean;
};

let progresso: ProgressoOffline = {
  ativo: false,
  etapa: "",
  atual: 0,
  total: TABELAS.length,
  pronto: false,
};

const ouvintes = new Set<(p: ProgressoOffline) => void>();

function atualizar(p: Partial<ProgressoOffline>) {
  progresso = { ...progresso, ...p };
  for (const fn of ouvintes) fn(progresso);
}

export function progressoOffline() {
  return progresso;
}

export function assinarProgresso(fn: (p: ProgressoOffline) => void) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

let rodando = false;

/** Data/hora da última pré-carga concluída (ISO) ou null. */
export function ultimaPrecarga(): string | null {
  return lerLocal<string | null>(CHAVE_ULTIMA, null);
}

function marcas(): Record<string, string> {
  return lerLocal<Record<string, string>>(CHAVE_MARCAS, {});
}

function salvarMarca(tabela: string, valor: string | null) {
  if (!valor) return;
  gravarLocal(CHAVE_MARCAS, { ...marcas(), [tabela]: valor });
}

function maiorValor(linhas: Linha[], coluna: string) {
  let maior: string | null = null;
  for (const l of linhas) {
    const v = l[coluna] ? String(l[coluna]) : null;
    if (v && (!maior || v > maior)) maior = v;
  }
  return maior;
}

/** Baixa uma tabela em páginas, aplicando o filtro incremental quando existir. */
async function baixarTabela({ tabela, delta, limite }: Tabela) {
  const desde = delta ? marcas()[tabela] : undefined;
  const teto = limite ?? 10000;
  let de = 0;
  let baixadas = 0;
  let marca: string | null = desde ?? null;

  while (de < teto) {
    let q: any = sb.from(tabela).select("*");
    if (delta && desde) q = q.gt(delta, desde);
    if (delta) q = q.order(delta, { ascending: true });
    q = q.range(de, Math.min(de + PAGINA, teto) - 1);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) break;
    const linhas = data as Linha[];
    if (linhas.length) {
      guardarLinhas(tabela, linhas);
      baixadas += linhas.length;
      if (delta) {
        const m = maiorValor(linhas, delta);
        if (m && (!marca || m > marca)) marca = m;
      }
    }
    if (linhas.length < PAGINA) break;
    de += PAGINA;
  }

  if (delta) salvarMarca(tabela, marca);
  return baixadas;
}

/**
 * Sincroniza todos os dados de uso offline em segundo plano.
 * Retorna a quantidade de tabelas sincronizadas (0 quando offline ou já rodando).
 */
export async function precarregarDadosOffline(): Promise<number> {
  if (rodando || estaOffline()) return 0;
  rodando = true;
  await hidratarOffline();
  const primeira = !ultimaPrecarga();
  atualizar({
    ativo: true,
    pronto: false,
    atual: 0,
    total: TABELAS.length,
    etapa: primeira ? "Preparando aplicativo…" : "Verificando atualizações…",
  });

  let ok = 0;
  try {
    for (const t of TABELAS) {
      atualizar({ etapa: `${primeira ? "Baixando" : "Atualizando"} ${t.rotulo.toLowerCase()}…` });
      try {
        await baixarTabela(t);
        ok++;
      } catch {
        /* uma tabela sem permissão não impede as demais */
      }
      atualizar({ atual: progresso.atual + 1 });
    }
    if (ok) gravarLocal(CHAVE_ULTIMA, new Date().toISOString());
    atualizar({ etapa: "Aplicativo pronto para uso offline.", pronto: true });
    setTimeout(() => atualizar({ ativo: false }), 2500);
    return ok;
  } finally {
    rodando = false;
  }
}

/** Quantidade de registros guardados localmente por tabela (diagnóstico). */
export function resumoLocal() {
  return TABELAS.map((t) => ({ tabela: t.tabela, rotulo: t.rotulo, linhas: lerLinhas(t.tabela).length }));
}
