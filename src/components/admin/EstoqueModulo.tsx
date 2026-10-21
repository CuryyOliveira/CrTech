/**
 * Estoque por módulo — visão de acompanhamento, sem abrir a conferência.
 *
 * Não existe lançamento manual de estoque no sistema: o saldo é a última
 * contagem oficial de cada material. Entradas e saídas são as variações
 * entre contagens consecutivas do mesmo material (aumento = entrada,
 * redução = saída), sempre a partir de conferências finalizadas.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Boxes, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useModulos } from "@/hooks/useModulos";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { fmtDataHoraLocal } from "@/lib/datas";

type ItemEstoque = {
  chave: string;
  codigo: string;
  descricao: string;
  locacao: string | null;
  unidades: Set<string>;
  esperado: number;
  saldo: number;
  entradas: number;
  saidas: number;
  contagens: number;
  ultimaContagem: string | null;
};

type LinhaItem = {
  conferencia_id: string;
  codigo: string | null;
  descricao: string | null;
  locacao: string | null;
  quantidade_esperada: number | null;
  quantidade_contada: number | null;
  status: string;
};

async function carregarEstoque(chave: string, legado: boolean, moduloId: string | null) {
  let unidadesQuery = supabase.from("unidades").select("id,nome").eq("ativo", true);
  unidadesQuery = legado
    ? unidadesQuery.eq("tipo", chave)
    : unidadesQuery.eq("modulo_id", moduloId as string);
  const { data: unidades, error: erroUnidades } = await unidadesQuery;
  if (erroUnidades) throw new Error(erroUnidades.message);

  const lista = (unidades ?? []) as { id: string; nome: string }[];
  if (!lista.length) return { itens: [] as ItemEstoque[], unidades: 0, conferencias: 0 };

  const { data: confs, error: erroConfs } = await supabase
    .from("conferencias")
    .select("id,unidade_id,data,hora_inicio")
    .in(
      "unidade_id",
      lista.map((u) => u.id),
    )
    .eq("status", "finalizada")
    .order("hora_inicio", { ascending: true })
    .limit(300);
  if (erroConfs) throw new Error(erroConfs.message);

  const conferencias = (confs ?? []) as {
    id: string;
    unidade_id: string;
    data: string;
    hora_inicio: string;
  }[];
  if (!conferencias.length) return { itens: [] as ItemEstoque[], unidades: lista.length, conferencias: 0 };

  const { data: itens, error: erroItens } = await supabase
    .from("conferencia_itens")
    .select("conferencia_id,codigo,descricao,locacao,quantidade_esperada,quantidade_contada,status")
    .in(
      "conferencia_id",
      conferencias.map((c) => c.id),
    );
  if (erroItens) throw new Error(erroItens.message);

  const nomeUnidade = new Map(lista.map((u) => [u.id, u.nome]));
  const infoConf = new Map(conferencias.map((c) => [c.id, c]));
  const ordem = new Map(conferencias.map((c, i) => [c.id, i]));

  const porItem = new Map<string, ItemEstoque>();
  const ultimoValor = new Map<string, number>();

  const ordenados = ((itens ?? []) as LinhaItem[])
    .filter((i) => i.status === "conferido" || i.status === "divergencia")
    .sort((a, b) => (ordem.get(a.conferencia_id) ?? 0) - (ordem.get(b.conferencia_id) ?? 0));

  for (const i of ordenados) {
    const codigo = (i.codigo ?? "").trim();
    const descricao = (i.descricao ?? "").trim();
    const chaveItem = (codigo || descricao).toUpperCase();
    if (!chaveItem) continue;

    const conf = infoConf.get(i.conferencia_id);
    let atual = porItem.get(chaveItem);
    if (!atual) {
      atual = {
        chave: chaveItem,
        codigo: codigo || "—",
        descricao: descricao || codigo,
        locacao: i.locacao ?? null,
        unidades: new Set<string>(),
        esperado: 0,
        saldo: 0,
        entradas: 0,
        saidas: 0,
        contagens: 0,
        ultimaContagem: null,
      };
      porItem.set(chaveItem, atual);
    }

    const contado = Number(i.quantidade_contada ?? 0);
    const anterior = ultimoValor.get(chaveItem);
    if (anterior !== undefined) {
      const delta = contado - anterior;
      if (delta > 0) atual.entradas += delta;
      if (delta < 0) atual.saidas += -delta;
    }
    ultimoValor.set(chaveItem, contado);

    atual.saldo = contado;
    atual.esperado = Number(i.quantidade_esperada ?? 0);
    atual.contagens++;
    atual.locacao = i.locacao ?? atual.locacao;
    if (conf) {
      atual.unidades.add(nomeUnidade.get(conf.unidade_id) ?? "—");
      atual.ultimaContagem = conf.hora_inicio;
    }
  }

  const resultado = [...porItem.values()].sort((a, b) => a.descricao.localeCompare(b.descricao));
  return { itens: resultado, unidades: lista.length, conferencias: conferencias.length };
}

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export function EstoqueModulo() {
  const { modulos, carregando: carregandoModulos } = useModulos();
  const [selecionado, setSelecionado] = useState<string>("");
  const [busca, setBusca] = useState("");

  const modulo = modulos.find((m) => m.chave === selecionado) ?? modulos[0] ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["estoque-modulo", modulo?.chave],
    enabled: Boolean(modulo),
    staleTime: 30_000,
    queryFn: () => carregarEstoque(modulo!.chave, modulo!.legado, modulo!.moduloId),
  });

  const itens = data?.itens ?? [];
  const filtrados = useMemo(() => {
    const t = busca.trim().toUpperCase();
    if (!t) return itens;
    return itens.filter((i) => i.codigo.toUpperCase().includes(t) || i.descricao.toUpperCase().includes(t));
  }, [itens, busca]);

  const totais = useMemo(
    () => ({
      saldo: itens.reduce((a, i) => a + i.saldo, 0),
      entradas: itens.reduce((a, i) => a + i.entradas, 0),
      saidas: itens.reduce((a, i) => a + i.saidas, 0),
      divergentes: itens.filter((i) => i.saldo !== i.esperado).length,
    }),
    [itens],
  );

  if (carregandoModulos) return <SkeletonLista />;

  if (!modulos.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma área de conferência cadastrada ainda. Crie um módulo para acompanhar o estoque.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={modulo?.chave ?? ""} onValueChange={setSelecionado}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Área de conferência">
            <SelectValue placeholder="Escolha a área" />
          </SelectTrigger>
          <SelectContent>
            {modulos.map((m) => (
              <SelectItem key={m.chave} value={m.chave}>
                {m.titulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar código ou material..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar material"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Saldo atual (soma)</p>
            <p className="text-2xl font-bold">{num(totais.saldo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowUpRight className="size-3.5 text-emerald-600" /> Entradas
            </p>
            <p className="text-2xl font-bold text-emerald-600">{num(totais.entradas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowDownRight className="size-3.5 text-destructive" /> Saídas
            </p>
            <p className="text-2xl font-bold text-destructive">{num(totais.saidas)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Boxes className="size-3.5" /> Materiais
            </p>
            <p className="text-2xl font-bold">{num(itens.length)}</p>
            <p className="text-xs text-muted-foreground">
              {num(totais.divergentes)} fora do previsto
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Saldo = última contagem finalizada. Entradas e saídas são as variações entre contagens do
        mesmo material. {data ? `${num(data.conferencias)} conferências em ${num(data.unidades)} listas.` : ""}
      </p>

      {isLoading ? (
        <SkeletonLista />
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum material com contagem finalizada nesta área.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Código</th>
                <th className="p-3 font-medium">Material</th>
                <th className="p-3 text-right font-medium">Previsto</th>
                <th className="p-3 text-right font-medium">Entradas</th>
                <th className="p-3 text-right font-medium">Saídas</th>
                <th className="p-3 text-right font-medium">Saldo</th>
                <th className="p-3 font-medium">Última contagem</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.chave} className="border-t">
                  <td className="p-3 font-mono text-xs">{i.codigo}</td>
                  <td className="p-3">
                    <p className="font-medium">{i.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {[i.locacao, [...i.unidades].join(", ")].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="p-3 text-right">{num(i.esperado)}</td>
                  <td className="p-3 text-right text-emerald-600">
                    {i.entradas ? `+${num(i.entradas)}` : "—"}
                  </td>
                  <td className="p-3 text-right text-destructive">
                    {i.saidas ? `-${num(i.saidas)}` : "—"}
                  </td>
                  <td className="p-3 text-right font-semibold">
                    {num(i.saldo)}
                    {i.saldo !== i.esperado && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {i.saldo > i.esperado ? "sobra" : "falta"}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {i.ultimaContagem ? fmtDataHoraLocal(i.ultimaContagem) : "—"}
                    {i.contagens > 1 ? ` · ${i.contagens} contagens` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
