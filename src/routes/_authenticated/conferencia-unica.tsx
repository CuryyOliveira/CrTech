import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Layers, Play, Rows3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconeModulo } from "@/components/IconeModulo";
import { useModulos } from "@/hooks/useModulos";
import { db, normalize, salvarMateriais, type Unidade } from "@/lib/app";
import { dataLocalISO, agoraLocalISO } from "@/lib/datas";
import { registrarAuditoria } from "@/lib/audit";
import { fileiraDaLocacao } from "@/lib/texto";
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
  // Fileiras (letra da locação, ex.: "P01 − A01" → A). Nenhuma marcada = todas.
  const [fileiras, setFileiras] = useState<string[]>([]);

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
    setFileiras([]);
    setSelecionadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  };
  const alternarFileira = (letra: string) =>
    setFileiras((atual) =>
      atual.includes(letra) ? atual.filter((x) => x !== letra) : [...atual, letra].sort(),
    );

  // Listas consideradas: as marcadas ou, sem nenhuma marcada, todas do módulo.
  const idsListas = selecionadas.length ? selecionadas : listas.map((l) => l.id);

  // Fileiras existentes nas locações das listas consideradas (com quantidade de itens).
  const { data: resumoFileiras } = useQuery({
    queryKey: ["fileiras-unica", modulo?.chave, [...idsListas].sort().join(",")],
    enabled: Boolean(modulo) && idsListas.length > 0,
    queryFn: async () => {
      const contagem = new Map<string, number>();
      let semFileira = 0;
      for (const m of await materiaisDasListas(idsListas)) {
        const letra = fileiraDaLocacao(m.locacao);
        if (letra) contagem.set(letra, (contagem.get(letra) ?? 0) + 1);
        else semFileira++;
      }
      return {
        letras: [...contagem.entries()].sort(([a], [b]) => a.localeCompare(b)),
        semFileira,
      };
    },
  });

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

      // Reúne os itens das listas escolhidas (sem duplicar códigos), só das fileiras marcadas.
      const filtro = new Set(fileiras);
      const materiaisOrigem = (await materiaisDasListas(idsListas)).filter(
        (m) => filtro.size === 0 || filtro.has(fileiraDaLocacao(m.locacao) ?? ""),
      );
      const vistos = new Set<string>();
      const itens = materiaisOrigem
        .filter((m) => {
          const chave = normalize(m.codigo) || normalize(m.descricao);
          if (vistos.has(chave)) return false;
          vistos.add(chave);
          return true;
        })
        .map((m) => ({
          codigo: m.codigo,
          descricao: m.descricao,
          locacao: m.locacao,
          quantidade_esperada: m.quantidade_esperada,
        }));
      if (!itens.length)
        throw new Error(
          fileiras.length
            ? "Nenhum item nas fileiras escolhidas"
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
          ...(fileiras.length ? { observacoes: `Fileiras: ${fileiras.join(", ")}` } : {}),
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
      return { unidade, conferencia: conf, itens: itens.length, retomada: false };
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
            fileiras.length ? ` (fileiras ${fileiras.join(", ")})` : ""
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
                    setFileiras([]);
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
                {resumoFileiras && resumoFileiras.letras.length > 0 && (
                  <div className="space-y-2 border-t pt-3" data-testid="etapa-fileiras">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <Rows3 className="size-4 text-primary" /> 3. Fileira (letra da locação) —
                      opcional
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Ex.: P01 − <strong>A</strong>01 é a fileira A. Nenhuma marcada = todas as
                      fileiras.
                      {resumoFileiras.semFileira > 0 &&
                        ` ${resumoFileiras.semFileira} ${
                          resumoFileiras.semFileira === 1
                            ? "item sem fileira só entra"
                            : "itens sem fileira só entram"
                        } sem filtro.`}
                    </p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Fileiras">
                      {resumoFileiras.letras.map(([letra, qtd]) => {
                        const ativa = fileiras.includes(letra);
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
                    {fileiras.length > 0 && (
                      <p className="text-xs font-medium text-primary">
                        Conferindo só a{fileiras.length > 1 ? "s fileiras" : " fileira"}{" "}
                        {fileiras.join(", ")}.
                      </p>
                    )}
                  </div>
                )}
                <Button
                  className="w-full gap-2"
                  disabled={iniciar.isPending || carregandoListas || listas.length === 0}
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
