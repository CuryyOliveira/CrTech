/**
 * FASE 0 — Seção WhatsApp da Central de Notificações.
 *
 * Aqui apenas cadastramos até 5 números por empresa. Nenhuma mensagem é
 * enviada: a integração com a API oficial ainda não foi configurada.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Carregando, Vazio } from "@/components/admin/consulta";
import {
  MAX_DESTINATARIOS_WHATSAPP,
  erroTelefone,
  formatarTelefone,
  type DestinatarioWhatsapp,
} from "@/lib/whatsapp";
import {
  alternarDestinatarioWhatsapp,
  excluirDestinatarioWhatsapp,
  listarDestinatariosWhatsapp,
  listarEnviosWhatsapp,
  reenviarWhatsappPendentesEmpresa,
  salvarDestinatarioWhatsapp,
} from "@/lib/whatsapp.functions";

type Rascunho = { nome: string; telefone: string; inicio: boolean; conclusao: boolean };

const VAZIO: Rascunho = { nome: "", telefone: "", inicio: true, conclusao: true };

export function WhatsappDestinatarios() {
  const qc = useQueryClient();
  const listar = useServerFn(listarDestinatariosWhatsapp);
  const salvar = useServerFn(salvarDestinatarioWhatsapp);
  const alternar = useServerFn(alternarDestinatarioWhatsapp);
  const excluir = useServerFn(excluirDestinatarioWhatsapp);

  const [novo, setNovo] = useState<Rascunho | null>(null);
  const [edicao, setEdicao] = useState<Record<string, Rascunho>>({});

  const { data: lista = [], isLoading, error } = useQuery({
    queryKey: ["whatsapp-destinatarios"],
    queryFn: async () => (await listar({})) as DestinatarioWhatsapp[],
    retry: 0,
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["whatsapp-destinatarios"] });

  const mutSalvar = useMutation({
    mutationFn: (dados: {
      id?: string | null;
      nome: string;
      telefone: string;
      ativo?: boolean;
      receber_inicio_conferencia: boolean;
      receber_conclusao_conferencia: boolean;
    }) => salvar({ data: dados }),
    onSuccess: () => {
      toast.success("Destinatário salvo.");
      setNovo(null);
      setEdicao({});
      void recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutAlternar = useMutation({
    mutationFn: (dados: { id: string; ativo: boolean }) => alternar({ data: dados }),
    onSuccess: () => {
      toast.success("Situação atualizada.");
      void recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutExcluir = useMutation({
    mutationFn: (id: string) => excluir({ data: { id } }),
    onSuccess: () => {
      toast.success("Destinatário excluído.");
      void recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativos = lista.filter((d) => d.ativo).length;
  const limiteAtingido = ativos >= MAX_DESTINATARIOS_WHATSAPP;

  const enviar = (r: Rascunho, id?: string, ativo?: boolean) => {
    const erro = erroTelefone(r.telefone);
    if (erro) return toast.error(erro);
    if (r.nome.trim().length < 2) return toast.error("Informe o nome do destinatário.");
    if (lista.some((d) => d.id !== id && d.nome.trim() === r.nome.trim() && d.telefone === r.telefone))
      return toast.error("Este número já está cadastrado.");
    mutSalvar.mutate({
      id: id ?? null,
      nome: r.nome,
      telefone: r.telefone,
      ativo: ativo ?? true,
      receber_inicio_conferencia: r.inicio,
      receber_conclusao_conferencia: r.conclusao,
    });
  };

  if (isLoading) return <Carregando />;

  if (error)
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Somente administradores da empresa podem configurar os números de WhatsApp.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <MessageCircle className="size-5 text-primary" />
          <div className="min-w-40 flex-1">
            <p className="font-semibold">WhatsApp</p>
            <p className="text-sm text-muted-foreground">
              Os números ativos recebem automaticamente o aviso de início e de conclusão de cada
              conferência.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {ativos} de {MAX_DESTINATARIOS_WHATSAPP} números ativos
        </p>
        <Button size="sm" disabled={limiteAtingido || !!novo} onClick={() => setNovo({ ...VAZIO })}>
          <Plus className="mr-1.5 size-4" />
          Adicionar número
        </Button>
      </div>

      <EnviosWhatsapp />

      {limiteAtingido && (
        <p className="text-sm text-muted-foreground">Limite de 5 números atingido.</p>
      )}

      {novo && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-semibold">Novo destinatário</p>
            <Formulario valor={novo} onChange={setNovo} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={mutSalvar.isPending} onClick={() => enviar(novo)}>
                Salvar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setNovo(null)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!lista.length && !novo ? (
        <Vazio texto="Nenhum número de WhatsApp cadastrado." />
      ) : (
        <ul className="space-y-3">
          {lista.map((d, i) => {
            const rascunho: Rascunho =
              edicao[d.id] ?? {
                nome: d.nome,
                telefone: d.telefone || d.telefone_normalizado,
                inicio: d.receber_inicio_conferencia,
                conclusao: d.receber_conclusao_conferencia,
              };
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        {i + 1}. {formatarTelefone(d.telefone_normalizado)}
                      </p>
                      <Badge variant={d.ativo ? "default" : "outline"}>
                        {d.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <Formulario
                      valor={rascunho}
                      onChange={(v) => setEdicao((prev) => ({ ...prev, [d.id]: v }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={mutSalvar.isPending}
                        onClick={() => enviar(rascunho, d.id, d.ativo)}
                      >
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutAlternar.isPending}
                        onClick={() => mutAlternar.mutate({ id: d.id, ativo: !d.ativo })}
                      >
                        {d.ativo ? "Desativar" : "Ativar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={mutExcluir.isPending}
                        onClick={() => mutExcluir.mutate(d.id)}
                      >
                        <Trash2 className="mr-1.5 size-4" />
                        Excluir
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Formulario({
  valor,
  onChange,
}: {
  valor: Rascunho;
  onChange: (v: Rascunho) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input
            value={valor.nome}
            maxLength={80}
            placeholder="Ex.: João da Silva"
            onChange={(e) => onChange({ ...valor, nome: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>WhatsApp</Label>
          <Input
            value={valor.telefone}
            maxLength={40}
            inputMode="tel"
            placeholder="(17) 99999-9999"
            onChange={(e) => onChange({ ...valor, telefone: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={valor.inicio}
            onCheckedChange={(c) => onChange({ ...valor, inicio: c === true })}
          />
          Receber início da conferência
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={valor.conclusao}
            onCheckedChange={(c) => onChange({ ...valor, conclusao: c === true })}
          />
          Receber conclusão da conferência
        </label>
      </div>
    </div>
  );
}

/** Últimos envios de WhatsApp da empresa, com reenvio das falhas/pendências. */
function EnviosWhatsapp() {
  const qc = useQueryClient();
  const listar = useServerFn(listarEnviosWhatsapp);
  const reenviar = useServerFn(reenviarWhatsappPendentesEmpresa);

  const { data: envios = [] } = useQuery({
    queryKey: ["whatsapp-envios"],
    queryFn: () => listar({}),
    retry: 0,
    refetchInterval: 30000,
  });

  const mut = useMutation({
    mutationFn: () => reenviar({}),
    onSuccess: (r) => {
      const res = r as { enviados: number; falhas: number; motivo?: string };
      toast.success(
        res.enviados > 0
          ? `${res.enviados} mensagem(ns) enviada(s).`
          : (res.motivo ?? "Nada pendente para reenviar."),
      );
      void qc.invalidateQueries({ queryKey: ["whatsapp-envios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendentes = envios.filter((e) => e.status !== "enviado").length;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Últimos envios</p>
          <Button size="sm" variant="outline" disabled={mut.isPending} onClick={() => mut.mutate()}>
            Reenviar pendentes{pendentes ? ` (${pendentes})` : ""}
          </Button>
        </div>
        {envios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum envio registrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={e.status === "enviado" ? "outline" : "destructive"}>
                  {e.status === "enviado" ? "Enviado" : e.status === "erro" ? "Erro" : "Pendente"}
                </Badge>
                <span className="text-muted-foreground">
                  {e.tipo_evento === "CONFERENCIA_INICIADA" ? "Início" : "Conclusão"} ·{" "}
                  {e.telefone_mascarado ?? "—"}
                </span>
                {e.erro && <span className="text-destructive">{e.erro}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
