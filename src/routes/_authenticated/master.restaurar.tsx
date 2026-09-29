import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MasterShell } from "@/components/master/MasterShell";
import { restaurarDadosMaster } from "@/lib/master.functions";
import {
  ORDEM_RESTAURACAO,
  TABELAS_IGNORADAS,
  emLotes,
  lerCsv,
  tabelaDoArquivo,
} from "@/lib/restauracao-legado";

export const Route = createFileRoute("/_authenticated/master/restaurar")({
  head: () => ({
    meta: [
      { title: "Restaurar dados — Painel Master" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RestaurarDadosPage,
});

type Item = {
  tabela: string;
  arquivo: string;
  registros: Record<string, string>[];
  status: "pendente" | "enviando" | "ok" | "erro" | "ignorada";
  gravados: number;
  erro?: string;
};

function RestaurarDadosPage() {
  const restaurar = useServerFn(restaurarDadosMaster);
  const [itens, setItens] = useState<Item[]>([]);
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  async function selecionar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const porTabela = new Map<string, Item>();
    for (const arquivo of Array.from(arquivos)) {
      const tabela = tabelaDoArquivo(arquivo.name);
      if (!tabela || porTabela.has(tabela)) continue;
      const conhecida = (ORDEM_RESTAURACAO as readonly string[]).includes(tabela);
      const registros = conhecida ? lerCsv(await arquivo.text()) : [];
      porTabela.set(tabela, {
        tabela,
        arquivo: arquivo.name,
        registros,
        status: conhecida && !TABELAS_IGNORADAS.includes(tabela) ? "pendente" : "ignorada",
        gravados: 0,
      });
    }
    const ordem = (t: string) => {
      const i = (ORDEM_RESTAURACAO as readonly string[]).indexOf(t);
      return i < 0 ? 999 : i;
    };
    setItens([...porTabela.values()].sort((a, b) => ordem(a.tabela) - ordem(b.tabela)));
    setProgresso(0);
  }

  async function iniciar() {
    setRodando(true);
    const lista = [...itens];
    const total = lista
      .filter((i) => i.status !== "ignorada")
      .reduce((s, i) => s + Math.max(1, i.registros.length), 0);
    let feitos = 0;
    for (let idx = 0; idx < lista.length; idx++) {
      const item = lista[idx];
      if (item.status === "ignorada" || item.status === "ok") continue;
      item.status = "enviando";
      item.gravados = 0;
      setItens([...lista]);
      try {
        for (const lote of emLotes(item.registros)) {
          const r = await restaurar({ data: { tabela: item.tabela, registros: lote } });
          item.gravados += r.gravados;
          feitos += lote.length;
          setProgresso(Math.round((feitos / total) * 100));
          setItens([...lista]);
        }
        if (!item.registros.length) feitos += 1;
        item.status = "ok";
      } catch (e) {
        item.status = "erro";
        item.erro = e instanceof Error ? e.message : String(e);
        setItens([...lista]);
        toast.error(`Falha em ${item.tabela}. A restauração foi interrompida.`);
        break;
      }
      setItens([...lista]);
    }
    setProgresso((p) => (lista.some((i) => i.status === "erro") ? p : 100));
    setRodando(false);
    if (!lista.some((i) => i.status === "erro")) toast.success("Dados restaurados!");
  }

  const pendentes = itens.filter((i) => i.status !== "ignorada");

  return (
    <MasterShell
      titulo="Restaurar dados"
      descricao="Importa os arquivos CSV exportados da Lovable Cloud, mantendo os IDs originais."
    >
      <Card>
        <CardContent className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            Selecione de uma vez todos os arquivos <strong>.csv</strong> exportados. As tabelas são
            gravadas na ordem certa; registros já existentes com o mesmo ID são atualizados, então a
            restauração pode ser repetida com segurança.
          </p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm hover:bg-muted">
            <Upload className="size-4" />
            <span>Escolher arquivos CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              disabled={rodando}
              onChange={(e) => void selecionar(e.target.files)}
            />
          </label>
          {pendentes.length > 0 && (
            <div className="space-y-2">
              <Progress value={progresso} />
              <Button className="w-full" size="lg" disabled={rodando} onClick={() => void iniciar()}>
                {rodando ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Restaurando… {progresso}%
                  </>
                ) : (
                  `Restaurar ${pendentes.length} tabela(s)`
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {itens.length > 0 && (
        <div className="space-y-2">
          {itens.map((i) => (
            <Card key={i.tabela}>
              <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="flex-1 font-medium">{i.tabela}</span>
                <span className="text-muted-foreground">{i.registros.length} registro(s)</span>
                {i.status === "ok" && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">
                    <CheckCircle2 className="mr-1 size-3.5" /> {i.gravados} gravado(s)
                  </Badge>
                )}
                {i.status === "enviando" && (
                  <Badge variant="secondary">
                    <Loader2 className="mr-1 size-3.5 animate-spin" /> {i.gravados} gravado(s)
                  </Badge>
                )}
                {i.status === "pendente" && <Badge variant="outline">Aguardando</Badge>}
                {i.status === "ignorada" && <Badge variant="outline">Não restaurada</Badge>}
                {i.status === "erro" && (
                  <Badge variant="destructive">
                    <CircleAlert className="mr-1 size-3.5" /> Erro
                  </Badge>
                )}
                {i.erro && <p className="w-full text-xs text-destructive">{i.erro}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </MasterShell>
  );
}
