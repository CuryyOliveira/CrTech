/**
 * Sincronização rápida da Frota de caminhões — um segundo formato, ao lado da sincronização
 * geral (que continua igual e roda logo depois).
 *
 * Baixa só o necessário para operar a Frota sem internet: o essencial para entrar e navegar
 * (perfil, permissões, empresa e módulos) e, do módulo Frota de caminhões, todas as listas,
 * seus materiais e as conferências (abertas com os itens; encerradas recentes só o cabeçalho,
 * para o histórico). Assim a Frota fica pronta em poucos segundos, sem esperar o restante.
 *
 * Usa o mesmo cache local da sincronização geral (mescla registro a registro, sem apagar
 * pendências) e não mexe nas marcas d'água dela. O envio do que foi feito offline continua
 * sendo pela fila de sempre.
 */
import { supabase } from "@/integrations/supabase/client";
import { chavePrimaria, guardarLinhas, lerFila, lerLinhas, type Linha } from "./fila";
import { estaOffline } from "./estado";
import { gravarLocal, hidratarOffline, lerLocal } from "./idb";
import { TABELAS, atualizar, baixarTabela, progressoOffline } from "./precarregar";

// Consulta do Supabase sem tipos gerados para estas tabelas (como em ./precarregar).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = any;
const sb = supabase as unknown as { from: (t: string) => Consulta };

/** Tipo das listas do módulo Frota de caminhões. */
export const TIPO_FROTA = "caminhao";

/** O essencial para entrar e navegar offline (mesmas tabelas e regras da sincronização geral). */
const ESSENCIAIS = [
  "user_profiles",
  "permissoes_perfil",
  "permissoes_usuario",
  "configuracoes_sistema",
  "cadastros_mestres",
  "empresas",
  "empresa_usuarios",
  "empresa_setores",
  "empresa_modulos",
  "planos",
];

const CHAVE_ULTIMA = "cr:precarga:frota";
const PAGINA = 400;
/** Lotes de ids por consulta (mantém a URL da consulta curta). */
const LOTE_IDS = 100;
/** Ao voltar a internet várias vezes seguidas, não repete a carga completa da Frota. */
const INTERVALO_MINIMO_MS = 2 * 60_000;

let rodando = false;

export type ResultadoFrota = { listas: number; materiais: number; conferencias: number };

/** Data/hora da última sincronização rápida da Frota concluída (ISO) ou null. */
export function ultimaPrecargaFrota(): string | null {
  return lerLocal<string | null>(CHAVE_ULTIMA, null);
}

/** O que da Frota já está no aparelho (para mostrar na tela). */
export function resumoFrotaLocal(): ResultadoFrota {
  const listas = lerLinhas("unidades").filter((u) => u["tipo"] === TIPO_FROTA);
  const ids = new Set(listas.map((u) => String(u["id"])));
  return {
    listas: listas.length,
    materiais: lerLinhas("materiais").filter((m) => ids.has(String(m["unidade_id"]))).length,
    conferencias: lerLinhas("conferencias").filter((c) => ids.has(String(c["unidade_id"]))).length,
  };
}

function lotes<T>(v: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < v.length; i += n) out.push(v.slice(i, i + n));
  return out;
}

/** Baixa todas as linhas da consulta, em páginas (ordenadas por id para paginar com segurança). */
async function baixarTudo(tabela: string, filtrar: (q: Consulta) => Consulta): Promise<Linha[]> {
  const todas: Linha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await filtrar(sb.from(tabela).select("*"))
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const linhas = (data ?? []) as Linha[];
    todas.push(...linhas);
    if (linhas.length < PAGINA) return todas;
  }
}

async function baixarPorIds(
  tabela: string,
  coluna: string,
  ids: string[],
  extra = (q: Consulta) => q,
) {
  const todas: Linha[] = [];
  for (const lote of lotes(ids, LOTE_IDS))
    todas.push(...(await baixarTudo(tabela, (q) => extra(q.in(coluna, lote)))));
  return todas;
}

/**
 * Registros com alteração feita offline ainda não enviada (na fila) ficam como estão no
 * aparelho: a cópia do servidor só os substitui depois que a fila for enviada.
 */
function guardarSemSobrepor(tabela: string, linhas: Linha[]) {
  const pk = chavePrimaria(tabela);
  const pendentes = new Set<string>();
  for (const op of lerFila()) {
    if (op.tabela !== tabela) continue;
    if (op.entidade_id) pendentes.add(String(op.entidade_id));
    for (const f of op.filtros) pendentes.add(String(f.valor));
    const payload = Array.isArray(op.payload) ? op.payload : op.payload ? [op.payload] : [];
    for (const l of payload) if (l[pk] != null) pendentes.add(String(l[pk]));
  }
  guardarLinhas(
    tabela,
    pendentes.size
      ? linhas.filter(
          (l) => !pendentes.has(String(l[pk])) && !pendentes.has(String(l["conferencia_id"])),
        )
      : linhas,
  );
}

/**
 * Sincronização rápida da Frota. Retorna o que foi baixado, ou null quando não rodou
 * (sem internet, já em andamento ou feita há menos de 2 minutos, a menos que `forcar`).
 */
export async function precarregarFrota(
  opcoes: { forcar?: boolean } = {},
): Promise<ResultadoFrota | null> {
  if (rodando || estaOffline()) return null;
  const ultima = ultimaPrecargaFrota();
  if (!opcoes.forcar && ultima && Date.now() - Date.parse(ultima) < INTERVALO_MINIMO_MS)
    return null;
  rodando = true;
  const essenciais = TABELAS.filter((t) => ESSENCIAIS.includes(t.tabela));
  const total = essenciais.length + 3;
  let feito = 0;
  atualizar({
    ativo: true,
    pronto: false,
    atual: 0,
    total,
    etapa: "Preparando a Frota de caminhões…",
  });
  try {
    await hidratarOffline();
    for (const t of essenciais) {
      try {
        await baixarTabela(t);
      } catch {
        /* uma tabela sem permissão não impede as demais */
      }
      atualizar({ atual: ++feito });
    }

    atualizar({ etapa: "Baixando as listas da Frota de caminhões…" });
    const listas = await baixarTudo("unidades", (q) => q.eq("tipo", TIPO_FROTA));
    guardarSemSobrepor("unidades", listas);
    const ids = listas.map((u) => String(u["id"]));
    atualizar({ atual: ++feito });

    atualizar({ etapa: "Baixando os materiais da Frota de caminhões…" });
    const materiais = await baixarPorIds("materiais", "unidade_id", ids);
    guardarSemSobrepor("materiais", materiais);
    atualizar({ atual: ++feito });

    // Conferências: abertas (com os itens, para retomar offline) e encerradas nos últimos
    // 30 dias (só o cabeçalho, para o histórico) — o mesmo recorte do motor de conferência.
    atualizar({ etapa: "Baixando as conferências da Frota de caminhões…" });
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const porId = new Map<string, Linha>();
    for (const c of [
      ...(await baixarPorIds("conferencias", "unidade_id", ids, (q) =>
        q.in("status", ["em_andamento", "pausada"]),
      )),
      ...(await baixarPorIds("conferencias", "unidade_id", ids, (q) => q.gte("created_at", desde))),
    ])
      porId.set(String(c["id"]), c);
    const conferencias = [...porId.values()];
    guardarSemSobrepor("conferencias", conferencias);
    const abertas = conferencias
      .filter((c) => c["status"] === "em_andamento" || c["status"] === "pausada")
      .map((c) => String(c["id"]));
    guardarSemSobrepor(
      "conferencia_itens",
      await baixarPorIds("conferencia_itens", "conferencia_id", abertas),
    );
    atualizar({ atual: total });

    gravarLocal(CHAVE_ULTIMA, new Date().toISOString());
    const pronta = "Frota de caminhões pronta para uso offline.";
    atualizar({ etapa: pronta, pronto: true });
    // Se a sincronização geral não começar em seguida, o aviso some sozinho.
    setTimeout(() => {
      if (progressoOffline().etapa === pronta) atualizar({ ativo: false });
    }, 2500);
    return {
      listas: listas.length,
      materiais: materiais.length,
      conferencias: conferencias.length,
    };
  } catch (e) {
    atualizar({ ativo: false });
    throw e;
  } finally {
    rodando = false;
  }
}
