/**
 * Adicionar material à conferência: pesquisa primeiro (na conferência e no cadastro guardado
 * no aparelho) para evitar duplicidade; se não existir, permite incluir manualmente.
 * A inclusão é o evento MATERIAL_ADDED do motor V2 (idempotente; autorização no servidor).
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buscar, chaveBusca, lerQuantidade } from "@/lib/conferencia-v2/apresentacao";
import { normalize } from "@/lib/texto";
import type { MotorSync } from "@/lib/sync-v2";
import type { ItemLocal } from "@/lib/sync-v2/tipos";
import { executar } from "./useConferenciaV2";

type Material = {
  id: string;
  codigo: string;
  descricao: string;
  locacao: string | null;
  quantidade_esperada: number;
};

export function ConferenceAdditionalMaterial({
  motor,
  conferenciaId,
  itens,
  aberto,
  onFechar,
  onIrParaItem,
}: {
  motor: MotorSync;
  conferenciaId: string;
  itens: ItemLocal[];
  aberto: boolean;
  onFechar: () => void;
  onIrParaItem: (k: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const [catalogo, setCatalogo] = useState<Material[]>([]);
  const [selecionado, setSelecionado] = useState<Material | null>(null);
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [locacao, setLocacao] = useState("");
  const [qtd, setQtd] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    void motor.todosMateriais().then((lista) =>
      setCatalogo(
        lista.map((m) => ({
          id: String(m.id),
          codigo: String(m.codigo ?? ""),
          descricao: String(m.descricao ?? ""),
          locacao: (m.locacao as string | null) ?? null,
          quantidade_esperada: Number(m.quantidade_esperada ?? 0),
        })),
      ),
    );
  }, [aberto, motor]);

  function limpar() {
    setTermo("");
    setSelecionado(null);
    setCodigo("");
    setDescricao("");
    setLocacao("");
    setQtd("1");
    setMotivo("");
  }

  const t = termo.trim();
  const naConferencia = useMemo(
    () => (t.length >= 2 ? buscar(itens, t).slice(0, 5) : []),
    [itens, t],
  );
  const noCadastro = useMemo(() => {
    if (t.length < 2) return [];
    const tc = chaveBusca(t);
    const tn = normalize(t);
    return catalogo
      .filter((m) => chaveBusca(m.codigo).includes(tc) || normalize(m.descricao).includes(tn))
      .slice(0, 20);
  }, [catalogo, t]);

  const duplicado = itens.some(
    (i) =>
      (selecionado && i.material_id === selecionado.id) ||
      (codigo.trim() !== "" && chaveBusca(i.codigo) === chaveBusca(codigo)),
  );
  const n = lerQuantidade(qtd);
  const valido =
    codigo.trim() !== "" &&
    descricao.trim() !== "" &&
    motivo.trim() !== "" &&
    n !== null &&
    !Number.isNaN(n) &&
    n > 0 &&
    !duplicado;

  async function adicionar() {
    setSalvando(true);
    const k = await executar(
      () =>
        motor.adicionarMaterial(conferenciaId, {
          material_id: selecionado?.id ?? null,
          codigo: codigo.trim(),
          descricao: descricao.trim(),
          locacao: locacao.trim() || selecionado?.locacao || null,
          quantidade: n!,
          motivo: motivo.trim(),
        }),
      "Material adicionado à conferência.",
    );
    setSalvando(false);
    if (k) {
      limpar();
      onFechar();
      onIrParaItem(k);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(o) => {
        if (!o) {
          limpar();
          onFechar();
        }
      }}
    >
      <DialogContent className="cr-alto-contraste max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar material</DialogTitle>
          <DialogDescription>
            Pesquise primeiro. Se o material não estiver na lista nem no cadastro, preencha os
            campos para incluí-lo nesta conferência.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-12 pl-10 text-base"
              aria-label="Pesquisar material por código ou descrição"
              placeholder="Código, descrição ou código de barras"
              value={termo}
              onChange={(e) => {
                setTermo(e.target.value);
                setSelecionado(null);
                setCodigo(e.target.value.trim());
              }}
            />
          </div>

          {naConferencia.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                JÁ ESTÁ NESTA CONFERÊNCIA
              </p>
              {naConferencia.map((i) => (
                <button
                  key={i.k}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/50 p-3 text-left text-sm"
                  onClick={() => {
                    limpar();
                    onFechar();
                    onIrParaItem(i.k);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold">{i.codigo}</span>
                    <span className="block truncate text-muted-foreground">{i.descricao}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary">
                    IR PARA O ITEM
                  </span>
                </button>
              ))}
            </div>
          )}

          {noCadastro.length > 0 && (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              <p className="text-xs font-semibold text-muted-foreground">NO CADASTRO</p>
              {noCadastro.map((m) => {
                const ja = itens.some(
                  (i) => i.material_id === m.id || chaveBusca(i.codigo) === chaveBusca(m.codigo),
                );
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={ja}
                    aria-pressed={selecionado?.id === m.id}
                    className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm ${
                      selecionado?.id === m.id ? "border-primary bg-accent" : "bg-card"
                    } ${ja ? "opacity-50" : "hover:border-primary"}`}
                    onClick={() => {
                      setSelecionado(m);
                      setCodigo(m.codigo);
                      setDescricao(m.descricao);
                      setLocacao(m.locacao ?? "");
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-semibold">{m.codigo}</span>
                      <span className="block truncate text-muted-foreground">{m.descricao}</span>
                    </span>
                    {m.locacao && <span className="shrink-0 text-xs">{m.locacao}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {t.length >= 2 && naConferencia.length === 0 && noCadastro.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Não encontrado. Você pode incluir o material manualmente abaixo.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="add-codigo">Código *</Label>
              <Input
                id="add-codigo"
                className="h-11"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-qtd">Quantidade encontrada *</Label>
              <Input
                id="add-qtd"
                className="h-11"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(e.target.value.replace(/[^\d.,]/g, ""))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-descricao">Descrição *</Label>
            <Input
              id="add-descricao"
              className="h-11"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-locacao">Localização</Label>
            <Input
              id="add-locacao"
              className="h-11"
              placeholder="Ex.: Corredor 03 · Prateleira B · Posição 12"
              value={locacao}
              onChange={(e) => setLocacao(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-motivo">Motivo da inclusão *</Label>
            <Textarea
              id="add-motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: encontrado na prateleira e ausente na lista"
            />
          </div>
          {duplicado && (
            <p role="alert" className="text-sm font-medium text-destructive">
              Este material já faz parte desta conferência.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-12" onClick={onFechar}>
            Cancelar
          </Button>
          <Button className="h-12" disabled={!valido || salvando} onClick={() => void adicionar()}>
            ADICIONAR À CONFERÊNCIA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
