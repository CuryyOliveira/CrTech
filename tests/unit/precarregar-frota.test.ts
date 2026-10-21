/**
 * Sincronização rápida da Frota de caminhões: baixa só o essencial e a Frota (listas,
 * materiais, conferências abertas com itens e encerradas recentes), mescla no cache local sem
 * apagar o que já existe e não mexe nas marcas d'água da sincronização geral.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
const banco: Record<string, Linha[]> = {};
const consultas: { tabela: string; filtros: string[] }[] = [];

/** Supabase falso: só os filtros usados pela pré-carga. */
function consulta(tabela: string) {
  const filtros: string[] = [];
  const testes: ((l: Linha) => boolean)[] = [];
  let de = 0;
  let ate = Infinity;
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filtros.push(`eq.${c}`), testes.push((l) => l[c] === v), q),
    in: (c: string, v: unknown[]) => (
      filtros.push(`in.${c}`),
      testes.push((l) => v.includes(l[c])),
      q
    ),
    gt: (c: string, v: string) => (
      filtros.push(`gt.${c}`),
      testes.push((l) => String(l[c]) > v),
      q
    ),
    gte: (c: string, v: string) => (
      filtros.push(`gte.${c}`),
      testes.push((l) => String(l[c]) >= v),
      q
    ),
    order: () => q,
    range: (a: number, b: number) => ((de = a), (ate = b), q),
    then: (ok: (r: { data: Linha[]; error: null }) => void) => {
      consultas.push({ tabela, filtros });
      const linhas = (banco[tabela] ?? []).filter((l) => testes.every((t) => t(l)));
      ok({ data: linhas.slice(de, ate + 1), error: null });
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => consulta(t) },
}));

const { precarregarFrota, resumoFrotaLocal } = await import("@/lib/offline/precarregar-frota");
const { lerLinhas, guardarLinhas, gravarFila } = await import("@/lib/offline/fila");
const { lerLocal } = await import("@/lib/offline/idb");

const agora = Date.now();
const dia = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  consultas.length = 0;
  for (const k of Object.keys(banco)) delete banco[k];
  Object.assign(banco, {
    empresas: [{ id: "e1", updated_at: iso(agora) }],
    unidades: [
      { id: "f1", tipo: "caminhao", nome: "JOHN DEERE", created_at: iso(agora) },
      { id: "f2", tipo: "caminhao", nome: "CH950", created_at: iso(agora) },
      { id: "p1", tipo: "prateleira", nome: "LUBRIFICANTES", created_at: iso(agora) },
      { id: "c1", tipo: "caixa", nome: "Fulano", created_at: iso(agora) },
    ],
    materiais: [
      ...Array.from({ length: 450 }, (_, i) => ({ id: `mf1-${i}`, unidade_id: "f1" })),
      { id: "mf2", unidade_id: "f2" },
      { id: "mp1", unidade_id: "p1" },
      { id: "mc1", unidade_id: "c1" },
    ],
    conferencias: [
      { id: "aberta", unidade_id: "f1", status: "pausada", created_at: iso(agora - 90 * dia) },
      { id: "recente", unidade_id: "f2", status: "finalizada", created_at: iso(agora - 2 * dia) },
      { id: "antiga", unidade_id: "f2", status: "finalizada", created_at: iso(agora - 90 * dia) },
      { id: "outra", unidade_id: "p1", status: "em_andamento", created_at: iso(agora) },
    ],
    conferencia_itens: [
      { id: "i1", conferencia_id: "aberta" },
      { id: "i2", conferencia_id: "recente" },
      { id: "i3", conferencia_id: "outra" },
    ],
  });
});

describe("Sincronização rápida da Frota de caminhões", () => {
  it("baixa só a Frota (todas as listas e materiais) e as conferências que ela usa", async () => {
    // Algo que já estava no aparelho (de outra lista) não é apagado.
    guardarLinhas("materiais", [{ id: "ja-no-aparelho", unidade_id: "p9" }]);

    const r = await precarregarFrota({ forcar: true });
    expect(r).toEqual({ listas: 2, materiais: 451, conferencias: 2 });

    const unidades = lerLinhas("unidades").map((u) => u.id);
    expect(unidades).toEqual(expect.arrayContaining(["f1", "f2"]));
    expect(unidades).not.toContain("p1");
    expect(unidades).not.toContain("c1");

    const materiais = lerLinhas("materiais").map((m) => m.id);
    expect(materiais).toHaveLength(452); // 450 + 1 da Frota (em mais de uma página) + o que já havia
    expect(materiais).toContain("ja-no-aparelho");
    expect(materiais).not.toContain("mp1");

    expect(
      lerLinhas("conferencias")
        .map((c) => c.id)
        .sort(),
    ).toEqual(["aberta", "recente"]);
    // Itens só da conferência aberta (para retomar offline).
    expect(lerLinhas("conferencia_itens").map((i) => i.id)).toEqual(["i1"]);
    expect(resumoFrotaLocal()).toEqual({ listas: 2, materiais: 451, conferencias: 2 });
  });

  it("o essencial (empresa, permissões…) vem antes, e as tabelas grandes nunca inteiras", async () => {
    await precarregarFrota({ forcar: true });
    const ordem = consultas.map((c) => c.tabela);
    expect(ordem.indexOf("empresas")).toBeLessThan(ordem.indexOf("unidades"));
    for (const c of consultas.filter((x) => x.tabela === "materiais"))
      expect(c.filtros).toContain("in.unidade_id");
    for (const c of consultas.filter((x) => x.tabela === "conferencia_itens"))
      expect(c.filtros).toContain("in.conferencia_id");
    expect(consultas.some((c) => c.tabela === "historico_conferencias")).toBe(false);
    expect(consultas.some((c) => c.tabela === "material_imagens")).toBe(false);
  });

  it("não mexe nas marcas d'água da sincronização geral das listas e materiais", async () => {
    await precarregarFrota({ forcar: true });
    const marcas = lerLocal<Record<string, string>>("cr:precarga:marcas", {});
    expect(marcas).not.toHaveProperty("unidades");
    expect(marcas).not.toHaveProperty("materiais");
    expect(marcas).not.toHaveProperty("conferencias");
  });

  it("ao voltar a internet seguidas vezes, não repete a carga em menos de 2 minutos", async () => {
    await precarregarFrota({ forcar: true });
    consultas.length = 0;
    expect(await precarregarFrota()).toBeNull();
    expect(consultas).toHaveLength(0);
    expect(await precarregarFrota({ forcar: true })).not.toBeNull();
  });

  it("não sobrepõe o que foi alterado offline e ainda não foi enviado", async () => {
    guardarLinhas("conferencias", [{ id: "aberta", unidade_id: "f1", status: "em_andamento" }]);
    guardarLinhas("conferencia_itens", [{ id: "i1", conferencia_id: "aberta", quantidade: 7 }]);
    gravarFila([
      {
        id: "op1",
        tabela: "conferencias",
        tipo: "update",
        payload: { status: "em_andamento" },
        filtros: [{ coluna: "id", valor: "aberta" }],
        criado_em: new Date().toISOString(),
        tentativas: 0,
      },
      {
        id: "op2",
        tabela: "conferencia_itens",
        tipo: "update",
        payload: { quantidade: 7 },
        filtros: [{ coluna: "conferencia_id", valor: "aberta" }],
        criado_em: new Date().toISOString(),
        tentativas: 0,
      },
    ]);
    try {
      await precarregarFrota({ forcar: true });
      // No servidor ainda está "pausada": o aparelho mantém a alteração local até enviar.
      expect(lerLinhas("conferencias").find((c) => c.id === "aberta")?.status).toBe("em_andamento");
      expect(lerLinhas("conferencia_itens").find((i) => i.id === "i1")?.quantidade).toBe(7);
      // O restante é atualizado normalmente.
      expect(lerLinhas("conferencias").map((c) => c.id)).toContain("recente");
    } finally {
      gravarFila([]);
    }
  });

  it("sem internet não faz nada", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      expect(await precarregarFrota({ forcar: true })).toBeNull();
      expect(consultas).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
