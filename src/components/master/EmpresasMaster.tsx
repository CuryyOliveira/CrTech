import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Ban,
  Building2,
  Loader2,
  Power,
  RotateCcw,
  Search,
  Trash2,
  Unlock,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { fmtDataHoraLocal } from "@/lib/datas";
import {
  bloquearEmpresaMaster,
  desativarEmpresaMaster,
  desbloquearEmpresaMaster,
  detalheEmpresaMaster,
  excluirEmpresaMaster,
  listarEmpresasMaster,
  reativarEmpresaMaster,
  type EmpresaResumoMaster,
} from "@/lib/master.functions";

const POR_PAGINA = 20;

function moeda(centavos: number | null | undefined, m: string | null | undefined) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: m || "BRL" });
}

function cnpjFmt(v: string | null) {
  const d = (v ?? "").replace(/\D+/g, "");
  if (d.length !== 14) return v || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function StatusBadge({ status }: { status: EmpresaResumoMaster["status"] }) {
  if (status === "desativada") return <Badge variant="destructive">Desativada</Badge>;
  if (status === "bloqueada")
    return <Badge className="bg-amber-500 text-black hover:bg-amber-500">Bloqueada</Badge>;
  return <Badge variant="secondary">Ativa</Badge>;
}

/** Gestão de empresas do SaaS: pesquisa, detalhes, bloqueio e desativação. */
export function EmpresasMaster() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const listar = useServerFn(listarEmpresasMaster);
  const { data, isLoading } = useQuery({
    queryKey: ["master-empresas", termo, pagina],
    queryFn: () => listar({ data: { busca: termo, pagina, porPagina: POR_PAGINA } }),
  });

  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setTermo(busca);
        }}
      >
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar por nome da empresa ou CNPJ..."
            aria-label="Pesquisar empresa"
          />
        </div>
        <Button type="submit">Pesquisar</Button>
        {termo && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setBusca("");
              setTermo("");
              setPagina(1);
            }}
          >
            Limpar
          </Button>
        )}
      </form>

      {isLoading ? (
        <SkeletonLista />
      ) : !data?.empresas.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma empresa encontrada.
        </div>
      ) : (
        <div className="space-y-2">
          {data.empresas.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Building2 className="size-5 text-primary" />
                <div className="min-w-40 flex-1">
                  <p className="font-semibold">{e.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    CNPJ {cnpjFmt(e.cnpj)} · criada em {fmtDataHoraLocal(e.criadaEm)}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{e.planoCodigo ?? "Sem plano"}</p>
                  <p>
                    {e.statusAssinatura
                      ? (STATUS_ASSINATURA_LABEL[e.statusAssinatura] ?? e.statusAssinatura)
                      : "Sem assinatura"}
                    {e.periodoAtualFim ? ` · até ${fmtDataHoraLocal(e.periodoAtualFim)}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" />
                  {e.usuarios}
                  {e.usuariosLimite != null ? ` / ${e.usuariosLimite}` : ""}
                </Badge>
                <StatusBadge status={e.status} />
                <Button size="sm" variant="outline" onClick={() => setAbertaId(e.id)}>
                  Detalhes
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {pagina} de {paginas} · {total} empresas
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pagina >= paginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      {abertaId && (
        <DetalheEmpresa
          empresaId={abertaId}
          onFechar={() => setAbertaId(null)}
          onAtualizado={() => queryClient.invalidateQueries({ queryKey: ["master-empresas"] })}
        />
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{valor}</span>
    </div>
  );
}

function DetalheEmpresa({
  empresaId,
  onFechar,
  onAtualizado,
}: {
  empresaId: string;
  onFechar: () => void;
  onAtualizado: () => void;
}) {
  const queryClient = useQueryClient();
  const carregar = useServerFn(detalheEmpresaMaster);
  const bloquear = useServerFn(bloquearEmpresaMaster);
  const desbloquear = useServerFn(desbloquearEmpresaMaster);
  const desativar = useServerFn(desativarEmpresaMaster);
  const reativar = useServerFn(reativarEmpresaMaster);
  const excluir = useServerFn(excluirEmpresaMaster);

  const [motivo, setMotivo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [confirmaExclusao, setConfirmaExclusao] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["master-empresa", empresaId],
    queryFn: () => carregar({ data: { empresaId } }),
  });

  const atualizar = () => {
    queryClient.invalidateQueries({ queryKey: ["master-empresa", empresaId] });
    onAtualizado();
  };

  const executar = async (acao: () => Promise<unknown>, sucesso: string) => {
    setOcupado(true);
    try {
      await acao();
      toast.success(sucesso);
      setMotivo("");
      setConfirmacao("");
      atualizar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
    } finally {
      setOcupado(false);
    }
  };

  const empresa = data?.empresa;
  const assinatura = data?.assinatura ?? null;

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{empresa?.nome ?? "Empresa"}</DialogTitle>
          <DialogDescription>
            Consulta completa e ações administrativas. Nenhum dado operacional é apagado.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !empresa ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <section className="space-y-1">
              <h3 className="font-semibold">Cadastro</h3>
              <Linha rotulo="CNPJ" valor={cnpjFmt(empresa.cnpj)} />
              <Linha rotulo="E-mail de contato" valor={empresa.emailContato ?? "—"} />
              <Linha rotulo="Telefone" valor={empresa.telefone ?? "—"} />
              <Linha rotulo="Criada em" valor={fmtDataHoraLocal(empresa.criadaEm)} />
              <Linha
                rotulo="Administrador responsável"
                valor={
                  empresa.administrador
                    ? `${empresa.administrador.nome ?? "—"} (${empresa.administrador.email ?? "—"})`
                    : "—"
                }
              />
            </section>

            <section className="space-y-1">
              <h3 className="font-semibold">Assinatura (somente leitura)</h3>
              <Linha rotulo="Plano" valor={assinatura?.planoNome ?? assinatura?.planoCodigo ?? "—"} />
              <Linha rotulo="Periodicidade" valor={assinatura?.periodicidade ?? "—"} />
              <Linha
                rotulo="Situação"
                valor={
                  assinatura
                    ? (STATUS_ASSINATURA_LABEL[assinatura.status] ?? assinatura.status)
                    : "Sem assinatura"
                }
              />
              <Linha rotulo="Valor" valor={moeda(assinatura?.valorCentavos, assinatura?.moeda)} />
              <Linha
                rotulo="Início"
                valor={assinatura?.dataInicio ? fmtDataHoraLocal(assinatura.dataInicio) : "—"}
              />
              <Linha
                rotulo="Vigência atual até"
                valor={
                  assinatura?.periodoAtualFim ? fmtDataHoraLocal(assinatura.periodoAtualFim) : "—"
                }
              />
              <Linha
                rotulo="Próxima cobrança"
                valor={
                  assinatura?.proximaCobranca ? fmtDataHoraLocal(assinatura.proximaCobranca) : "—"
                }
              />
              <Linha
                rotulo="Licenças em uso"
                valor={`${data.usuariosUsados}${data.usuariosLimite != null ? ` de ${data.usuariosLimite}` : ""}`}
              />
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Usuários vinculados ({data.usuarios.length})</h3>
              <div className="rounded-lg border">
                {data.usuarios.map((u) => (
                  <div
                    key={u.userId}
                    className="flex flex-wrap items-center gap-2 border-b p-2 last:border-0"
                  >
                    <div className="min-w-40 flex-1">
                      <p className="font-medium">{u.nome ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{u.email ?? "—"}</p>
                    </div>
                    <Badge variant="outline">{u.papel ?? u.perfil ?? "—"}</Badge>
                    {u.bloqueado && <Badge variant="destructive">Bloqueado</Badge>}
                    {!u.ativo && <Badge variant="secondary">Inativo</Badge>}
                  </div>
                ))}
                {!data.usuarios.length && (
                  <p className="p-3 text-xs text-muted-foreground">Nenhum usuário vinculado.</p>
                )}
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-destructive/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex-1 font-semibold">Ações administrativas</h3>
                <StatusBadge status={empresa.status} />
              </div>

              {empresa.status !== "ativa" && (
                <p className="text-xs text-muted-foreground">
                  {empresa.status === "bloqueada"
                    ? `Bloqueada em ${fmtDataHoraLocal(empresa.bloqueadaEm)}`
                    : `Desativada em ${fmtDataHoraLocal(empresa.desativadaEm)}`}
                  {empresa.motivoBloqueio ? ` · Motivo: ${empresa.motivoBloqueio}` : ""}
                </p>
              )}

              {empresa.status === "ativa" && (
                <div className="space-y-2">
                  <Label htmlFor="motivo-bloqueio">Motivo (obrigatório para bloquear)</Label>
                  <Textarea
                    id="motivo-bloqueio"
                    value={motivo}
                    maxLength={300}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: inadimplência confirmada, uso indevido, solicitação do cliente..."
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={ocupado || motivo.trim().length < 5}
                      onClick={() =>
                        executar(
                          () => bloquear({ data: { empresaId, motivo } }),
                          "Empresa bloqueada.",
                        )
                      }
                    >
                      <Ban className="mr-1 size-4" /> Bloquear acesso
                    </Button>
                  </div>
                </div>
              )}

              {empresa.status === "bloqueada" && (
                <Button
                  variant="outline"
                  disabled={ocupado}
                  onClick={() =>
                    executar(
                      () => desbloquear({ data: { empresaId } }),
                      "Bloqueio removido.",
                    )
                  }
                >
                  <Unlock className="mr-1 size-4" /> Remover bloqueio
                </Button>
              )}

              {empresa.status === "desativada" ? (
                <Button
                  variant="outline"
                  disabled={ocupado}
                  onClick={() =>
                    executar(() => reativar({ data: { empresaId } }), "Empresa reativada.")
                  }
                >
                  <RotateCcw className="mr-1 size-4" /> Reativar empresa
                </Button>
              ) : (
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="confirmar-nome">
                    Desativar empresa — digite <strong>{empresa.nome}</strong> para confirmar
                  </Label>
                  <Input
                    id="confirmar-nome"
                    value={confirmacao}
                    onChange={(e) => setConfirmacao(e.target.value)}
                    placeholder={empresa.nome}
                  />
                  <p className="text-xs text-muted-foreground">
                    A desativação impede o acesso de todos os usuários da empresa. Os dados
                    permanecem preservados e a ação pode ser revertida.
                  </p>
                  <Button
                    variant="destructive"
                    disabled={ocupado || confirmacao.trim() !== empresa.nome.trim()}
                    onClick={() =>
                      executar(
                        () =>
                          desativar({
                            data: { empresaId, confirmacao, motivo: motivo || undefined },
                          }),
                        "Empresa desativada.",
                      )
                    }
                  >
                    <Power className="mr-1 size-4" /> Desativar empresa
                  </Button>
                </div>
              )}

              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="confirmar-exclusao">
                  Excluir empresa definitivamente — digite <strong>{empresa.nome}</strong> para
                  confirmar
                </Label>
                <Input
                  id="confirmar-exclusao"
                  value={confirmaExclusao}
                  onChange={(e) => setConfirmaExclusao(e.target.value)}
                  placeholder={empresa.nome}
                />
                <p className="text-xs text-destructive">
                  Atenção: esta ação é irreversível. O cadastro da empresa, os vínculos dos
                  usuários e o histórico de assinaturas serão apagados. As contas de login dos
                  usuários continuam existindo, mas ficam sem empresa.
                </p>
                <Button
                  variant="destructive"
                  disabled={ocupado || confirmaExclusao.trim() !== empresa.nome.trim()}
                  onClick={async () => {
                    setOcupado(true);
                    try {
                      await excluir({
                        data: {
                          empresaId,
                          confirmacao: confirmaExclusao,
                          motivo: motivo || undefined,
                        },
                      });
                      toast.success("Empresa excluída definitivamente.");
                      onAtualizado();
                      onFechar();
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Não foi possível excluir a empresa.",
                      );
                    } finally {
                      setOcupado(false);
                    }
                  }}
                >
                  <Trash2 className="mr-1 size-4" /> Excluir empresa
                </Button>
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
