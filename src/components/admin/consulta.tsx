import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { db, fmtDate, fmtDateTime, normalize } from "@/lib/app";
import { useSetoresDisponiveis } from "@/hooks/useSetores";

export const TODOS = "__todos__";

/** Painel de filtros recolhível padrão dos módulos de consulta. */
export function FiltrosPainel({
  aberto,
  onToggle,
  busca,
  onBusca,
  placeholder,
  onLimpar,
  children,
}: {
  aberto: boolean;
  onToggle: () => void;
  busca: string;
  onBusca: (v: string) => void;
  placeholder: string;
  onLimpar: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              value={busca}
              placeholder={placeholder}
              onChange={(e) => onBusca(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={onToggle}>
            <Filter className="mr-1.5 size-4" />
            Filtros
          </Button>
          <Button variant="ghost" size="sm" onClick={onLimpar}>
            Limpar
          </Button>
        </div>
        <Collapsible open={aberto}>
          <CollapsibleContent className="grid gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
            {children}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

export function CampoSelect({
  label,
  valor,
  onChange,
  opcoes,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; label: string }[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CampoPeriodo({
  de,
  ate,
  onDe,
  onAte,
}: {
  de: string;
  ate: string;
  onDe: (v: string) => void;
  onAte: (v: string) => void;
}) {
  return (
    <>
      <div>
        <Label>Período — de</Label>
        <Input type="date" value={de} onChange={(e) => onDe(e.target.value)} />
      </div>
      <div>
        <Label>Período — até</Label>
        <Input type="date" value={ate} onChange={(e) => onAte(e.target.value)} />
      </div>
    </>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {texto}
    </div>
  );
}

export function Carregando() {
  return (
    <div className="flex justify-center p-10">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export const PAGINA = 100;

/** Setores da empresa atual (a empresa legada mantém Agrícola e Indústria). */
export function useSetoresFiltro() {
  const { opcoes } = useSetoresDisponiveis();
  return opcoes;
}

/** Listas (unidades) cadastradas para alimentar o filtro de lista conferida. */
export function useListasFiltro() {
  return useQuery({
    queryKey: ["filtro-listas"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await db.from("unidades").select("nome").order("nome");
      const nomes = [...new Set(((data ?? []) as { nome: string }[]).map((u) => u.nome))];
      return nomes.map((n) => ({ valor: n, label: n }));
    },
  });
}


/** Lista de usuários existentes para alimentar os filtros dos dois módulos. */
export function useUsuariosFiltro() {
  return useQuery({
    queryKey: ["filtro-usuarios"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await db.from("user_profiles").select("user_id,nome,perfil,setor").order("nome");
      return (data ?? []) as { user_id: string; nome: string | null; perfil: string; setor: string | null }[];
    },
  });
}

export function useBuscaLocal<T>(itens: T[], busca: string, campos: (i: T) => (string | null | undefined)[]) {
  return useMemo(() => {
    const q = normalize(busca);
    if (!q) return itens;
    return itens.filter((i) => campos(i).some((c) => normalize(c).includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, busca]);
}

export function useEstadoFiltros<T extends Record<string, string>>(inicial: T) {
  const [filtros, setFiltros] = useState<T>(inicial);
  const [aberto, setAberto] = useState(false);
  const set = (k: keyof T, v: string) => setFiltros((f) => ({ ...f, [k]: v }));
  return { filtros, set, limpar: () => setFiltros(inicial), aberto, alternar: () => setAberto((a) => !a) };
}

export { fmtDate, fmtDateTime };
