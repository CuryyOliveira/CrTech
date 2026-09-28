/**
 * Sincronização automática das operações feitas em modo offline.
 * A fila é aplicada em ordem (FIFO) usando upsert por chave primária,
 * o que preserva a integridade e evita conferências/registros duplicados.
 *
 * Nada é descartado por falha de rede: a operação permanece na fila com o
 * último erro registrado e é reenviada com espera progressiva.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  chavePrimaria,
  lerFila,
  marcarTentativa,
  podeTentar,
  registrarConflito,
  removerDaFila,
  type Operacao,
} from "./fila";
import { definirEstado, erroDeRede, marcarQueda } from "./estado";

const sb = supabase as unknown as { from: (t: string) => any };
const MAX_TENTATIVAS = 8;

let rodando = false;

type ErroBanco = { message?: string; code?: string } | null;

/** Remove de um payload uma coluna que não existe na tabela do servidor. */
function semColuna(payload: unknown, coluna: string): unknown {
  const tirar = (l: Record<string, unknown>) => {
    const { [coluna]: _fora, ...resto } = l;
    return resto;
  };
  return Array.isArray(payload)
    ? payload.map((l) => tirar(l as Record<string, unknown>))
    : tirar((payload ?? {}) as Record<string, unknown>);
}

async function enviar(op: Operacao, payload: unknown): Promise<ErroBanco> {
  const pk = chavePrimaria(op.tabela);
  let q: any = sb.from(op.tabela);
  if (op.tipo === "insert" || op.tipo === "upsert") {
    q = q.upsert(payload, { onConflict: pk });
  } else if (op.tipo === "update") {
    q = q.update(payload);
    for (const f of op.filtros) q = q.eq(f.coluna, f.valor);
  } else {
    q = q.delete();
    for (const f of op.filtros) q = q.eq(f.coluna, f.valor);
  }
  const { error } = await q;
  return error as ErroBanco;
}

async function aplicar(op: Operacao): Promise<ErroBanco> {
  let payload: unknown = op.payload;
  // Campos preenchidos offline que a tabela não possui são removidos e a
  // operação é reenviada, em vez de ficar presa na fila.
  for (let i = 0; i < 5; i++) {
    const erro = await enviar(op, payload);
    const coluna = /Could not find the '([^']+)' column/.exec(erro?.message ?? "")?.[1];
    if (!erro || !coluna) return erro;
    payload = semColuna(payload, coluna);
  }
  return { message: "Campos incompatíveis com a tabela" };
}

/**
 * Tabelas em que a mesma linha pode ser alterada no servidor enquanto o
 * aparelho está offline. A coluna indica quando a linha mudou no servidor.
 */
const COLUNA_VERSAO: Record<string, string> = {
  conferencia_itens: "updated_at",
  historico_conferencias: "updated_at",
  notificacoes_conferencia: "updated_at",
};

/** Identificador da linha alvo da operação (quando conhecido). */
function alvoDaOperacao(op: Operacao): string | null {
  if (op.entidade_id) return op.entidade_id;
  const pk = chavePrimaria(op.tabela);
  const filtro = op.filtros.find((f) => f.coluna === pk);
  if (filtro?.valor != null) return String(filtro.valor);
  const payload = Array.isArray(op.payload) ? op.payload[0] : op.payload;
  const v = payload?.[pk];
  return v == null ? null : String(v);
}

/**
 * Estratégia de conflito: uma alteração feita offline nunca sobrepõe uma
 * resolução mais recente feita no servidor (ex.: divergência já tratada pelo
 * gestor no navegador). Nesses casos o servidor é preservado e o conflito fica
 * registrado para consulta na Central Administrativa.
 *
 * Retorna true quando a operação deve ser descartada.
 */
async function servidorMaisRecente(op: Operacao, jaAplicadas: Set<string>): Promise<boolean> {
  const coluna = COLUNA_VERSAO[op.tabela];
  if (!coluna) return false;
  if (op.tipo !== "update" && op.tipo !== "upsert" && op.tipo !== "insert") return false;
  const alvo = alvoDaOperacao(op);
  if (!alvo) return false;
  // A linha já foi atualizada por uma operação anterior desta MESMA fila
  // (ex.: pausar → retomar → finalizar). O "updated_at" novo é obra nossa,
  // não de outra pessoa: as etapas seguintes devem ser aplicadas normalmente.
  if (jaAplicadas.has(`${op.tabela}:${alvo}`)) return false;

  const pk = chavePrimaria(op.tabela);
  const { data, error } = await sb.from(op.tabela).select(`${pk}, ${coluna}`).eq(pk, alvo).maybeSingle();
  if (error || !data) return false; // linha nova no servidor: segue o fluxo normal

  const servidor = data[coluna] ? new Date(String(data[coluna])).getTime() : 0;
  const offline = new Date(op.criado_em).getTime();
  if (!servidor || !offline || servidor <= offline) return false;

  registrarConflito({
    tabela: op.tabela,
    tipo: op.tipo,
    entidade_id: alvo,
    alterado_offline_em: op.criado_em,
    alterado_servidor_em: String(data[coluna]),
    decisao: "servidor_preservado",
    detalhe:
      "A informação já havia sido alterada no servidor depois da edição feita offline. A versão do servidor foi mantida.",
  });
  return true;
}

/** Conflito já resolvido no servidor: a operação pode ser considerada concluída. */
function conflitoResolvido(op: Operacao, erro: ErroBanco) {
  if (!erro) return false;
  // Registro já removido/alterado no servidor: exclusão offline não tem o que fazer.
  if (op.tipo === "delete" && (erro.code === "PGRST116" || erro.code === "23503")) return true;
  return false;
}

export type ResultadoSync = { enviadas: number; falhas: number; conflitos?: number };

/**
 * Envia todas as pendências ao servidor. Retorna quantas operações foram
 * sincronizadas (0 quando não havia nada ou a conexão continua indisponível).
 */
export async function sincronizarPendencias(): Promise<number> {
  return (await sincronizar()).enviadas;
}

export async function sincronizar(): Promise<ResultadoSync> {
  if (rodando) return { enviadas: 0, falhas: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return { enviadas: 0, falhas: 0 };
  const fila = lerFila();
  if (!fila.length) {
    definirEstado("online");
    return { enviadas: 0, falhas: 0 };
  }

  rodando = true;
  definirEstado("sincronizando");
  let enviadas = 0;
  let falhas = 0;
  let conflitos = 0;
  // Linhas alteradas por esta própria fila (tabela:id): etapas seguintes da
  // mesma conferência não podem ser tratadas como conflito.
  const jaAplicadas = new Set<string>();
  try {
    for (const op of fila) {
      if (!podeTentar(op)) continue;
      try {
        if (await servidorMaisRecente(op, jaAplicadas)) {
          removerDaFila(op.id);
          conflitos++;
          continue;
        }
        const erro = await aplicar(op);
        if (erro && !conflitoResolvido(op, erro)) {
          falhas++;
          marcarTentativa(op.id, erro.message ?? "Falha ao sincronizar");
          const atual = lerFila().find((o) => o.id === op.id);
          // Falha permanente de regra/permissão: descarta para não travar a fila.
          if ((atual?.tentativas ?? 0) >= MAX_TENTATIVAS) removerDaFila(op.id);
          continue;
        }
        const alvo = alvoDaOperacao(op);
        if (alvo) jaAplicadas.add(`${op.tabela}:${alvo}`);
        removerDaFila(op.id);
        enviadas++;
      } catch (e) {
        if (erroDeRede(e)) {
          // Conexão caiu durante a sincronização: nada é perdido.
          marcarQueda();
          return { enviadas, falhas, conflitos };
        }
        falhas++;
        marcarTentativa(op.id, (e as Error)?.message ?? "Erro inesperado");
      }
    }
    definirEstado("online");
    return { enviadas, falhas, conflitos };
  } finally {
    rodando = false;
  }
}
