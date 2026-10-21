/**
 * "Importar arquivo": planilha (Excel/CSV) segue direto, como sempre; PDF passa antes pela
 * escolha das colunas a carregar. O resultado tem o mesmo formato da leitura de planilha,
 * então o restante da importação (mesclagem, atualização sem duplicar) é o mesmo.
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readSheet } from "@/lib/export";
import {
  CAMPOS_LISTA,
  ehPdf,
  lerPdf,
  linhasParaImportacao,
  quantidadeNaLista,
  sugerirMapeamento,
  type CampoLista,
  type TabelaPdf,
} from "@/lib/importacao-pdf";

export const ACEITA_ARQUIVO = ".xlsx,.xls,.csv,.pdf,application/pdf";

type Linhas = Record<string, unknown>[];
type Pedido = { tabela: TabelaPdf; arquivo: string; responder: (l: Linhas | null) => void };

/**
 * `ler(arquivo)` devolve as linhas do arquivo, ou null se a pessoa cancelar a escolha das
 * colunas do PDF. Renderize `dialogo` na tela que importa.
 */
export function useLeitorArquivo() {
  const [pedido, setPedido] = useState<Pedido | null>(null);

  const ler = useCallback(async (file: File): Promise<Linhas | null> => {
    if (!ehPdf(file)) return readSheet(file);
    const tabela = await lerPdf(file);
    if (!tabela)
      throw new Error(
        "não foi encontrado o cabeçalho das colunas no PDF (o PDF precisa ter texto, não imagem)",
      );
    if (!tabela.linhas.length) return [];
    return new Promise<Linhas | null>((resolve) =>
      setPedido({ tabela, arquivo: file.name, responder: resolve }),
    );
  }, []);

  const fechar = (linhas: Linhas | null) => {
    pedido?.responder(linhas);
    setPedido(null);
  };

  const dialogo = pedido ? (
    <SeletorColunasPdf
      tabela={pedido.tabela}
      arquivo={pedido.arquivo}
      onConfirmar={(linhas) => fechar(linhas)}
      onCancelar={() => fechar(null)}
    />
  ) : null;

  return { ler, dialogo };
}

function SeletorColunasPdf({
  tabela,
  arquivo,
  onConfirmar,
  onCancelar,
}: {
  tabela: TabelaPdf;
  arquivo: string;
  onConfirmar: (linhas: Linhas) => void;
  onCancelar: () => void;
}) {
  const [mapa, setMapa] = useState(() => sugerirMapeamento(tabela.colunas));

  const campoDa = (coluna: string) =>
    CAMPOS_LISTA.find(({ campo }) => mapa[campo] === coluna)?.campo ?? "";

  function escolher(coluna: string, campo: CampoLista | "") {
    setMapa((m) => {
      const novo = { ...m };
      for (const c of CAMPOS_LISTA) if (novo[c.campo] === coluna) novo[c.campo] = null;
      if (campo) novo[campo] = coluna;
      return novo;
    });
  }

  const exemplos = (coluna: string) =>
    tabela.linhas
      .map((l) => l[coluna])
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");

  const previa = useMemo(
    () =>
      tabela.linhas.slice(0, 3).map((l) => ({
        codigo: mapa.codigo ? l[mapa.codigo] : "",
        descricao: mapa.descricao ? l[mapa.descricao] : "",
        locacao: mapa.locacao ? l[mapa.locacao] : "",
        quantidade: mapa.quantidade ? quantidadeNaLista(l[mapa.quantidade] ?? "") : "",
      })),
    [tabela, mapa],
  );

  const falta = !mapa.quantidade
    ? "Escolha a coluna da Quantidade esperada."
    : !mapa.codigo && !mapa.descricao
      ? "Escolha ao menos a coluna do Código ou da Descrição."
      : null;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onCancelar()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Colunas encontradas no PDF</DialogTitle>
          <DialogDescription>
            {tabela.linhas.length} item(ns) em {tabela.paginas} página(s) — {arquivo}. Escolha o que
            carregar de cada coluna; as demais ficam só como referência.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2" data-testid="colunas-pdf">
          {tabela.colunas.map((coluna) => (
            <li
              key={coluna}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{coluna}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {exemplos(coluna) || "—"}
                </div>
              </div>
              <select
                aria-label={`Carregar a coluna ${coluna} como`}
                className="h-10 w-40 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                value={campoDa(coluna)}
                onChange={(e) => escolher(coluna, e.target.value as CampoLista | "")}
              >
                <option value="">Só referência</option>
                {CAMPOS_LISTA.map((c) => (
                  <option key={c.campo} value={c.campo}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Prévia na lista
          </div>
          {previa.map((p, i) => (
            <div key={i} className="rounded-lg border border-border px-3 py-2">
              <div className="truncate font-medium">{p.descricao || p.codigo || "—"}</div>
              <div className="truncate text-sm text-muted-foreground">
                {p.codigo || "—"} {p.locacao ? `• ${p.locacao}` : ""} • Qtd: {p.quantidade || "—"}
              </div>
            </div>
          ))}
        </div>

        {falta && <p className="text-sm text-destructive">{falta}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            disabled={!!falta}
            onClick={() => onConfirmar(linhasParaImportacao(tabela, mapa))}
          >
            Carregar {tabela.linhas.length} item(ns)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
