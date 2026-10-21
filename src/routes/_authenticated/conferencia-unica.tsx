import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Columns3, Layers, Play, Rows3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconeModulo } from "@/components/IconeModulo";
import { useModulos } from "@/hooks/useModulos";
import { db, salvarMateriais, type Unidade } from "@/lib/app";
import { dataLocalISO, agoraLocalISO } from "@/lib/datas";
import { registrarAuditoria } from "@/lib/audit";
import {
  ajustarFiltro,
  descreverFiltro,
  fileirasDasPrateleiras,
  resumirLocacoes,
  selecionarItens,
} from "@/lib/conferencia-unica-filtro";
import type { ModuloResolvido } from "@/lib/modulos";

export const Route = createFileRoute("/_authenticated/conferencia-unica")({
  head: () => ({
    meta: [
      { title: "Conferência Única — Conferência Rápida" },
      {
        name: "description",
        content:
          "Abra uma conferência avulsa reunindo itens de um ou mais módulos, sem mexer nas conferências em andamento.",
      },
      { property: "og:title", content: "Conferência Única — Conferência Rápida" },
      {
        property: "og:description",
        content: "Abra uma conferência avulsa reunindo itens de um ou mais módulos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConferenciaUnica,
});

type ListaOrigem = Pick<Unidade, "id" | "nome" | "tipo">;
type MaterialOrigem = {
  codigo: string;
  descricao: string;
  locacao: string | null;
  quantidade_esperada: number;
};

/** Materiais das listas, em páginas (o servidor devolve no máximo 1.000 linhas por consulta). */
async function materiaisDasListas(ids: string[]) {
  const todos: MaterialOrigem[] = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db
      .from("materiais")
      .select("codigo,descricao,locacao,quantidade_esperada")
      .in("unidade_id", ids)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = (data ?? []) as MaterialOrigem[];
    todos.push(...lote);
    if (lote.length < PAGINA) return todos;
  }
}

const NOME_UNIDADE = (modulo: ModuloResolvido) => `Conferência única — ${modulo.titulo}`;

function ConferenciaUnica() {
  const { modulos, carregando } = useModulos();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modulo, setModulo] = useState<ModuloResolvido | null>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  // Prateleira (ex.: "P02 − B01" → P02) e, dentro dela, fileira (→ B). Nenhuma marcada = todas.
  const [prateleiras, setPrateleiras] = useState<string[]>([]);
  const [fileiras, setFileiras] = useState<string[]>([]);
  const limparFiltro = () => {
    setPrateleiras([]);
    setFileiras([]);
  };

  // Listas (unidades) do módulo escolhido, exceto a unidade da conferência única.
  const { data: listas = [], isLoading: carregandoListas } = useQuery({
    queryKey: ["listas-unica", modulo?.chave],
    enabled: Boolean(modulo),
    queryFn: async () => {
      let consulta = db.from("unidades").select("id,nome,tipo").eq("ativo", true);
      consulta = modulo!.moduloId
        ? consulta.eq("modulo_id", modulo!.moduloId)
        : consulta.eq("tipo", modulo!.tipoUnidade);
      const { data, error } = await consulta.order("nome");
      if (error) throw error;
      const nomeUnica = NOME_UNIDADE(modulo!);
      return ((data ?? []) as ListaOrigem[]).filter((u) => u.nome !== nomeUnica);
    },
  });

  const alternar = (id: string) => {
    limparFiltro();
    setSelecionadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  };
  // Listas consideradas: as marcadas ou, sem nenhuma marcada, todas do módulo.
  const idsListas = selecionadas.length ? selecionadas : listas.map((l) => l.id);

  // Itens das listas consideradas (em páginas de 1.000), para descobrir prateleiras e fileiras.
  const { data: materiaisListas, isFetching: carregandoItens } = useQuery({
    queryKey: ["locacoes-unica", modulo?.chave, [...idsListas].sort().join(",")],
    enabled: Boolean(modulo) && idsListas.length > 0,
    queryFn: () => materiaisDasListas(idsListas),
  });
  const resumo = useMemo(
    () => (materiaisListas ? resumirLocacoes(materiaisListas) : null),
    [materiaisListas],
  );
  // Filtro efetivo: só prateleiras existentes e fileiras existentes DENTRO delas.
  const filtro = useMemo(
    () =>
      resumo ? ajustarFiltro(resumo, { prateleiras, fileiras }) : { prateleiras: [], fileiras: [] },
    [resumo, prateleiras, fileiras],
  );
  const fileirasDisponiveis = useMemo(
    () => (resumo ? fileirasDasPrateleiras(resumo, filtro.prateleiras) : null),
    [resumo, filtro.prateleiras],
  );
  const totalSelecionado = useMemo(
    () => (materiaisListas ? selecionarItens(materiaisListas, filtro).length : null),
    [materiaisListas, filtro],
  );

  const alternarPrateleira = (p: string) => {
    const novas = prateleiras.includes(p)
      ? prateleiras.filter((x) => x !== p)
      : [...prateleiras, p];
    setPrateleiras(novas);
    // Fileiras que deixaram de existir nas prateleiras marcadas saem da seleção.
    if (resumo) setFileiras(ajustarFiltro(resumo, { prateleiras: novas, fileiras }).fileiras);
  };
  const alternarFileira = (letra: string) =>
    setFileiras((atual) =>
      atual.includes(letra) ? atual.filter((x) => x !== letra) : [...atual, letra].sort(),
    );

  const iniciar = useMutation({
    mutationFn: async () => {
      if (!modulo) throw new Error("Escolha um módulo");
      const escopo = modulo.moduloId ? { modulo_id: modulo.moduloId } : {};
      const nomeUnica = NOME_UNIDADE(modulo);

      // Encontra (ou cria) a unidade reservada às conferências únicas do módulo.
      let busca = db.from("unidades").select("*").eq("nome", nomeUnica);
      busca = modulo.moduloId
        ? busca.eq("modulo_id", modulo.moduloId)
        : busca.eq("tipo", modulo.tipoUnidade);
      const { data: existente } = await busca.maybeSingle();
      let unidade = existente as Unidade | null;
      if (!unidade) {
        const { data, error } = await db
          .from("unidades")
          .insert({ tipo: modulo.tipoUnidade, nome: nomeUnica, ...escopo })
          .select()
          .single();
        if (error) throw error;
        unidade = data as Unidade;
      }

      // Se já houver conferência aberta na unidade única, retoma em vez de duplicar.
      const { data: aberta } = await db
        .from("conferencias")
        .select("*")
        .eq("unidade_id", unidade.id)
        .in("status", ["em_andamento", "pausada"])
        .order("hora_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (aberta) return { unidade, retomada: true };

      // Reúne os itens das listas escolhidas (sem duplicar códigos), só da prateleira/fileira
      // marcadas. Releitura no momento de iniciar: vale o estado atual das listas.
      const itens = selecionarItens(await materiaisDasListas(idsListas), filtro).map((m) => ({
        codigo: m.codigo,
        descricao: m.descricao,
        locacao: m.locacao,
        quantidade_esperada: m.quantidade_esperada,
      }));
      if (!itens.length)
        throw new Error(
          descreverFiltro(filtro)
            ? "Nenhum item na prateleira/fileira escolhida"
            : "Nenhum item encontrado nas listas selecionadas",
        );

      // Substitui a lista anterior da unidade única pelos itens escolhidos agora.
      const { error: eDel } = await db.from("materiais").delete().eq("unidade_id", unidade.id);
      if (eDel) throw eDel;
      await salvarMateriais(unidade.id, itens);

      // Abre a conferência com data/hora locais.
      const { data: conf, error: eConf } = await db
        .from("conferencias")
        .insert({
          unidade_id: unidade.id,
          tipo: modulo.tipoUnidade,
          data: dataLocalISO(),
          hora_inicio: agoraLocalISO(),
          ...(descreverFiltro(filtro) ? { observacoes: descreverFiltro(filtro) } : {}),
        })
        .select()
        .single();
      if (eConf) throw eConf;
      // Lê em páginas: a unidade única pode ter mais de 1.000 itens.
      const materiaisNovos: {
        id: string;
        codigo: string;
        descricao: string;
        locacao: string | null;
        quantidade_esperada: number;
      }[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error: eLer } = await db
          .from("materiais")
          .select("id,codigo,descricao,locacao,quantidade_esperada")
          .eq("unidade_id", unidade.id)
          .order("id")
          .range(de, de + 999);
        if (eLer) throw eLer;
        materiaisNovos.push(...((data ?? []) as typeof materiaisNovos));
        if ((data ?? []).length < 1000) break;
      }
      const { error: eItens } = await db.from("conferencia_itens").insert(
        materiaisNovos.map((m) => ({
          conferencia_id: conf.id,
          material_id: m.id,
          codigo: m.codigo,
          descricao: m.descricao,
          locacao: m.locacao,
          quantidade_esperada: m.quantidade_esperada,
        })),
      );
      if (eItens) throw eItens;
      return {
        unidade,
        conferencia: conf,
        itens: itens.length,
        filtro: descreverFiltro(filtro),
        retomada: false,
      };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["conferencias", r.unidade.id] });
      if (r.retomada) {
        toast.info("Já havia uma conferência única aberta — retomando");
      } else {
        registrarAuditoria({
          tipo: "operacao",
          acao: "conferencia_unica_iniciada",
          detalhe: `Conferência única iniciada com ${r.itens} itens${
            r.filtro ? ` (${r.filtro})` : ""
          }`,
          modulo: modulo?.chave ?? null,
          lista: r.unidade.nome,
        });
        // O aviso de início é enviado pelo servidor ao confirmar a conferência.
        toast.success("Conferência única iniciada");
      }
      navigate({ to: "/unidade/$id", params: { id: r.unidade.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/menu" aria-label="Voltar ao menu">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="flex-1 text-lg font-bold tracking-tight">Conferência Única</h1>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4">
        <p className="text-sm text-muted-foreground">
          Abra uma conferência avulsa reunindo os itens de um módulo, sem mexer nas conferências em
          andamento dos cards.
        </p>

        {/* Etapa 1: módulo */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-primary" /> 1. Escolha o módulo
          </h2>
          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando módulos…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {modulos.map((m) => (
                <button
                  key={m.chave}
                  type="button"
                  onClick={() => {
                    setModulo(m);
                    setSelecionadas([]);
                    limparFiltro();
                  }}
                  className="text-left"
                >
                  <Card
                    className={`h-full transition-all hover:border-primary ${
                      modulo?.chave === m.chave ? "border-primary ring-2 ring-primary/30" : ""
                    }`}
                  >
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <IconeModulo nome={m.icone} className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{m.titulo}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.descricao}</p>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Etapa 2: itens */}
        {modulo && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="size-4 text-primary" /> 2. Escolha as listas de itens
            </h2>
            <Card>
              <CardContent className="space-y-3 p-4">
                {carregandoListas ? (
                  <p className="text-sm text-muted-foreground">Carregando listas…</p>
                ) : listas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Este módulo ainda não tem listas com itens cadastrados.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Nenhuma marcada = todos os itens do módulo.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {listas.map((l) => (
                        <label
                          key={l.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm hover:border-primary"
                        >
                          <Checkbox
                            checked={selecionadas.includes(l.id)}
                            onCheckedChange={() => alternar(l.id)}
                          />
                          <span className="flex-1 truncate">{l.nome}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {l.tipo}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {resumo && resumo.prateleiras.length > 0 && (
                  <div className="space-y-2 border-t pt-3" data-testid="etapa-prateleiras">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Columns3 className="size-4 text-primary" /> 3. Prateleira — opcional
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Ex.: <strong>P02</strong> − B01 é a prateleira P02. Nenhuma marcada = todos os
                      itens.
                      {resumo.semPrateleira > 0 &&
                        ` ${resumo.semPrateleira} ${
                          resumo.semPrateleira === 1
                            ? "item sem prateleira só entra"
                            : "itens sem prateleira só entram"
                        } sem filtro.`}
                    </p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Prateleiras">
                      {resumo.prateleiras.map((p) => {
                        const ativa = filtro.prateleiras.includes(p.prateleira);
                        return (
                          <Button
                            key={p.prateleira}
                            type="button"
                            size="sm"
                            variant={ativa ? "default" : "outline"}
                            aria-pressed={ativa}
                            className="h-11 min-w-20 gap-1 text-base font-bold"
                            data-testid={`prateleira-${p.prateleira}`}
                            onClick={() => alternarPrateleira(p.prateleira)}
                          >
                            {p.prateleira}
                            <span className="text-xs font-normal opacity-80">({p.total})</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {filtro.prateleiras.length > 0 && fileirasDisponiveis && (
                  <div className="space-y-2 border-t pt-3" data-testid="etapa-fileiras">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Rows3 className="size-4 text-primary" /> 4. Fileira (letra da locação) —
                      opcional
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Prateleira{filtro.prateleiras.length > 1 ? "s" : ""} selecionada
                      {filtro.prateleiras.length > 1 ? "s" : ""}:{" "}
                      <strong>{filtro.prateleiras.join(", ")}</strong>. Nenhuma fileira marcada =
                      toda a prateleira.
                      {fileirasDisponiveis.semFileira > 0 &&
                        ` ${fileirasDisponiveis.semFileira} ${
                          fileirasDisponiveis.semFileira === 1
                            ? "item sem fileira só entra"
                            : "itens sem fileira só entram"
                        } sem fileira marcada.`}
                    </p>
                    {fileirasDisponiveis.fileiras.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Nenhuma fileira com letra nesta prateleira.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Fileiras">
                        {fileirasDisponiveis.fileiras.map(([letra, qtd]) => {
                          const ativa = filtro.fileiras.includes(letra);
                          return (
                            <Button
                              key={letra}
                              type="button"
                              size="sm"
                              variant={ativa ? "default" : "outline"}
                              aria-pressed={ativa}
                              className="h-11 min-w-16 gap-1 text-base font-bold"
                              data-testid={`fileira-${letra}`}
                              onClick={() => alternarFileira(letra)}
                            >
                              {letra}
                              <span className="text-xs font-normal opacity-80">({qtd})</span>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {totalSelecionado !== null && (
                  <p
                    className={`text-sm font-medium ${
                      totalSelecionado === 0 ? "text-destructive" : "text-primary"
                    }`}
                    data-testid="resumo-selecao"
                    aria-live="polite"
                  >
                    {totalSelecionado === 0
                      ? "Nenhum item nesta seleção."
                      : `${totalSelecionado} ${totalSelecionado === 1 ? "item" : "itens"} serão conferidos${
                          descreverFiltro(filtro) ? ` · ${descreverFiltro(filtro)}` : ""
                        }.`}
                  </p>
                )}
                <Button
                  className="w-full gap-2"
                  disabled={
                    iniciar.isPending ||
                    carregandoListas ||
                    listas.length === 0 ||
                    (Boolean(filtro.prateleiras.length) && carregandoItens) ||
                    totalSelecionado === 0
                  }
                  onClick={() => iniciar.mutate()}
                >
                  <Play className="size-4" />
                  {iniciar.isPending ? "Preparando…" : "Iniciar conferência única"}
                </Button>
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}
