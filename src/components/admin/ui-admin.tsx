import { useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText, Printer, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  relatorioCSV,
  relatorioExcel,
  relatorioImprimir,
  relatorioPDF,
  type Coluna,
} from "@/lib/relatorios";

/** Skeleton padrão das listas administrativas. */
export function SkeletonLista({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: linhas }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Estado vazio padronizado, com ação opcional. */
export function EstadoVazio({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  );
}

/** Paginação incremental padronizada. */
export function Paginacao({
  total,
  visiveis,
  onMais,
  passo,
}: {
  total: number;
  visiveis: number;
  onMais: () => void;
  passo: number;
}) {
  if (total <= visiveis) return <p className="text-center text-xs text-muted-foreground">{total} registro(s)</p>;
  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="outline" size="sm" onClick={onMais}>
        Carregar mais {Math.min(passo, total - visiveis)}
      </Button>
      <p className="text-xs text-muted-foreground">
        Exibindo {visiveis} de {total} registro(s)
      </p>
    </div>
  );
}

/** Confirmação padronizada para ações destrutivas. */
export function Confirmar({
  aberto,
  onAberto,
  titulo,
  descricao,
  confirmar = "Confirmar",
  onConfirmar,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  titulo: string;
  descricao: string;
  confirmar?: string;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog open={aberto} onOpenChange={onAberto}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmar}>{confirmar}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Hook utilitário de confirmação. */
export function useConfirmacao() {
  const [pedido, setPedido] = useState<{ titulo: string; descricao: string; acao: () => void } | null>(
    null,
  );
  return {
    pedir: (titulo: string, descricao: string, acao: () => void) =>
      setPedido({ titulo, descricao, acao }),
    elemento: pedido ? (
      <Confirmar
        aberto
        onAberto={(v) => !v && setPedido(null)}
        titulo={pedido.titulo}
        descricao={pedido.descricao}
        onConfirmar={() => {
          pedido.acao();
          setPedido(null);
        }}
      />
    ) : null,
  };
}

/** Menu de exportação padrão (PDF, Excel, CSV e impressão). */
export function MenuExportar<T>({
  titulo,
  subtitulo,
  colunas,
  linhas,
  onExportado,
}: {
  titulo: string;
  subtitulo: string;
  colunas: Coluna<T>[];
  linhas: T[];
  onExportado?: (formato: string) => void;
}) {
  const meta = { titulo, subtitulo, geradoEm: new Date().toLocaleString("pt-BR") };

  function exportar(formato: "pdf" | "xlsx" | "csv" | "imprimir") {
    if (!linhas.length) return toast.error("Nenhum registro para exportar.");
    if (formato === "pdf") relatorioPDF(colunas, linhas, meta);
    if (formato === "xlsx") relatorioExcel(colunas, linhas, meta);
    if (formato === "csv") relatorioCSV(colunas, linhas, meta);
    if (formato === "imprimir" && !relatorioImprimir(colunas, linhas, meta))
      return toast.error("Permita as janelas pop-up para imprimir.");
    onExportado?.(formato);
    if (formato !== "imprimir") toast.success("Exportação gerada.");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-1.5 size-4" /> Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportar("pdf")}>
          <FileText className="mr-2 size-4" /> PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportar("xlsx")}>
          <FileSpreadsheet className="mr-2 size-4" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportar("csv")}>
          <Table2 className="mr-2 size-4" /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportar("imprimir")}>
          <Printer className="mr-2 size-4" /> Imprimir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
