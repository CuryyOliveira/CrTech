/**
 * Filtro da Conferência única por PRATELEIRA e FILEIRA (letra da locação).
 *
 * Hierarquia: a fileira é sempre escolhida DENTRO das prateleiras marcadas.
 *  - nenhuma prateleira       → todos os itens das listas (comportamento original);
 *  - prateleiras, sem fileira → todos os itens dessas prateleiras (inclusive os sem letra);
 *  - prateleiras + fileiras   → só (prateleira ∈ marcadas E fileira ∈ marcadas).
 * Itens sem letra nunca entram numa combinação prateleira + fileira.
 * A leitura da locação é a mesma do resto do app (`partesDaLocacao`).
 */
import { natCompare, normalize, partesDaLocacao } from "@/lib/texto";

export type ItemLocado = {
  codigo: string;
  descricao: string;
  locacao: string | null;
};

export type FiltroLocacao = { prateleiras: string[]; fileiras: string[] };

export type ResumoPrateleira = {
  prateleira: string;
  total: number;
  /** [letra, quantidade] em ordem alfabética. */
  fileiras: [string, number][];
  semFileira: number;
};

export type ResumoLocacoes = {
  prateleiras: ResumoPrateleira[];
  /** Itens cuja locação não indica prateleira (só entram sem filtro de prateleira). */
  semPrateleira: number;
};

/** Prateleiras encontradas (ordem natural: P2 < P10) com as fileiras de cada uma. */
export function resumirLocacoes(itens: ItemLocado[]): ResumoLocacoes {
  const mapa = new Map<string, { total: number; letras: Map<string, number>; sem: number }>();
  let semPrateleira = 0;
  for (const it of itens) {
    const { prateleira, fileira } = partesDaLocacao(it.locacao);
    if (!prateleira) {
      semPrateleira++;
      continue;
    }
    const p = mapa.get(prateleira) ?? { total: 0, letras: new Map(), sem: 0 };
    p.total++;
    if (fileira) p.letras.set(fileira, (p.letras.get(fileira) ?? 0) + 1);
    else p.sem++;
    mapa.set(prateleira, p);
  }
  return {
    prateleiras: [...mapa.entries()]
      .sort(([a], [b]) => natCompare(a, b))
      .map(([prateleira, p]) => ({
        prateleira,
        total: p.total,
        fileiras: [...p.letras.entries()].sort(([a], [b]) => a.localeCompare(b)),
        semFileira: p.sem,
      })),
    semPrateleira,
  };
}

/** Fileiras disponíveis DENTRO das prateleiras marcadas (quantidade somada entre elas). */
export function fileirasDasPrateleiras(
  resumo: ResumoLocacoes,
  prateleiras: string[],
): { fileiras: [string, number][]; semFileira: number } {
  const marcadas = new Set(prateleiras);
  const soma = new Map<string, number>();
  let semFileira = 0;
  for (const p of resumo.prateleiras) {
    if (!marcadas.has(p.prateleira)) continue;
    semFileira += p.semFileira;
    for (const [letra, n] of p.fileiras) soma.set(letra, (soma.get(letra) ?? 0) + n);
  }
  return {
    fileiras: [...soma.entries()].sort(([a], [b]) => a.localeCompare(b)),
    semFileira,
  };
}

/**
 * Mantém só o que ainda existe: prateleiras presentes no resumo e fileiras presentes nas
 * prateleiras marcadas (sem prateleira, nenhuma fileira vale).
 */
export function ajustarFiltro(resumo: ResumoLocacoes, filtro: FiltroLocacao): FiltroLocacao {
  const existentes = new Set(resumo.prateleiras.map((p) => p.prateleira));
  const prateleiras = filtro.prateleiras.filter((p) => existentes.has(p)).sort(natCompare);
  const letras = new Set(fileirasDasPrateleiras(resumo, prateleiras).fileiras.map(([l]) => l));
  const fileiras = prateleiras.length ? filtro.fileiras.filter((f) => letras.has(f)).sort() : [];
  return { prateleiras, fileiras };
}

/** O item entra no filtro? */
export function itemNoFiltro(locacao: string | null | undefined, filtro: FiltroLocacao) {
  if (!filtro.prateleiras.length) return true;
  const { prateleira, fileira } = partesDaLocacao(locacao);
  if (!prateleira || !filtro.prateleiras.includes(prateleira)) return false;
  if (!filtro.fileiras.length) return true;
  return fileira !== null && filtro.fileiras.includes(fileira);
}

/** Itens da conferência: aplica o filtro e depois tira códigos repetidos (como antes). */
export function selecionarItens<T extends ItemLocado>(itens: T[], filtro: FiltroLocacao): T[] {
  const vistos = new Set<string>();
  return itens
    .filter((m) => itemNoFiltro(m.locacao, filtro))
    .filter((m) => {
      const chave = normalize(m.codigo) || normalize(m.descricao);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

/** Texto do filtro para observações/auditoria; sem filtro → null (nada é inventado). */
export function descreverFiltro(filtro: FiltroLocacao): string | null {
  if (!filtro.prateleiras.length) return null;
  const partes = [`Prateleiras: ${filtro.prateleiras.join(", ")}`];
  if (filtro.fileiras.length) partes.push(`Fileiras: ${filtro.fileiras.join(", ")}`);
  return partes.join(" | ");
}
