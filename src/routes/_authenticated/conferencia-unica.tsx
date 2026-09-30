import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Layers, Play } from "lucide-react";
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

const NOME_UNIDADE = (modulo: ModuloResolvido) => `Conferência única — ${modulo.titulo}`;

function ConferenciaUnica() {
  const { modulos, carregando } = useModulos();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modulo, setModulo] = useState<ModuloResolvido | null>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);

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

  const alternar = (id: string) =>
    setSelecionadas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
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

      // Reúne os itens das listas escolhidas (sem duplicar códigos).
      let consultaMateriais = db
        .from("materiais")
        .select("codigo,descricao,locacao,quantidade_esperada");
      consultaMateriais = selecionadas.length
        ? consultaMateriais.in("unidade_id", selecionadas)
        : consultaMateriais.in(
            "unidade_id",
            listas.map((l) => l.id),
          );
      const { data: materiaisOrigem, error: eMat } = await consultaMateriais;
      if (eMat) throw eMat;
      const vistos = new Set<string>();
      const itens = (
        (materiaisOrigem ?? []) as {
          codigo: string;
          descricao: string;
          locacao: string | null;
          quantidade_esperada: number;
        }[]
      )
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
      if (!itens.length) throw new Error("Nenhum item encontrado nas listas selecionadas");

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
        })
        .select()
        .single();
      if (eConf) throw eConf;
      const { data: materiaisNovos, error: eLer } = await db
        .from("materiais")
        .select("*")
        .eq("unidade_id", unidade.id);
      if (eLer) throw eLer;
      const { error: eItens } = await db.from("conferencia_itens").insert(
        (materiaisNovos ?? []).map((m: any) => ({
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
          detalhe: `Conferência única iniciada com ${r.itens} itens`,
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
