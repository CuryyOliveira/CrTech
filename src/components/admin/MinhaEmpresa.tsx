import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, CalendarClock, CreditCard, Loader2, Save, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { useAcesso } from "@/hooks/useAcesso";
import { atualizarMinhaEmpresa } from "@/lib/empresa.functions";
import { STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { fmtDataHoraLocal } from "@/lib/datas";
import { supabase } from "@/integrations/supabase/client";

function moeda(centavos: number | null | undefined, m: string | null | undefined) {
  if (centavos == null) return "—";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: m || "BRL" });
}

/** FASE 10 — Dados da empresa, plano contratado, situação e uso de licenças. */
export function MinhaEmpresa() {
  const { carregando, acesso, recarregar } = useAcesso();
  const queryClient = useQueryClient();
  const salvarEmpresa = useServerFn(atualizarMinhaEmpresa);
  const [form, setForm] = useState({ nome: "", cnpj: "", email: "", telefone: "" });
  const [salvando, setSalvando] = useState(false);

  const empresaId = acesso?.empresaId ?? null;

  const { data: empresa } = useQuery({
    queryKey: ["minha-empresa", empresaId],
    enabled: Boolean(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("nome,cnpj,email_contato,telefone,created_at")
        .eq("id", empresaId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  useEffect(() => {
    if (!empresa) return;
    setForm({
      nome: empresa.nome ?? "",
      cnpj: empresa.cnpj ?? "",
      email: empresa.email_contato ?? "",
      telefone: empresa.telefone ?? "",
    });
  }, [empresa]);

  if (carregando) return <SkeletonLista linhas={3} />;

  if (!empresaId) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Seu usuário não está vinculado a nenhuma empresa.
      </div>
    );
  }

  const plano = acesso?.plano ?? null;
  const status = plano?.status ?? null;
  const usados = acesso?.usuariosUsados ?? 0;
  const limite = acesso?.usuariosLimite ?? null;

  async function salvar() {
    setSalvando(true);
    try {
      await salvarEmpresa({ data: form });
      await queryClient.invalidateQueries({ queryKey: ["minha-empresa", empresaId] });
      await recarregar();
      toast.success("Dados da empresa atualizados");
    } catch (e) {
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <CreditCard className="size-4 text-primary" /> Plano
            </p>
            <p className="text-lg font-bold">{plano?.plano_codigo ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {moeda(plano?.valor_centavos, plano?.moeda)}
              {plano?.periodicidade ? ` · ${plano.periodicidade}` : ""}
            </p>
            {status && (
              <Badge
                className={
                  status === "ativa" || status === "trial"
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500 text-black"
                }
              >
                {STATUS_ASSINATURA_LABEL[status] ?? status}
              </Badge>
            )}
            {acesso?.legado && <Badge variant="secondary">Empresa existente preservada</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <CalendarClock className="size-4 text-primary" /> Ciclo
            </p>
            <p className="text-sm">
              Teste até: {plano?.trial_fim ? fmtDataHoraLocal(plano.trial_fim) : "—"}
            </p>
            <p className="text-sm">
              Próxima cobrança:{" "}
              {plano?.proxima_cobranca ? fmtDataHoraLocal(plano.proxima_cobranca) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <Users className="size-4 text-primary" /> Usuários
            </p>
            <p className="text-lg font-bold">
              {usados}
              {limite != null ? ` / ${limite}` : " / ilimitado"}
            </p>
            <p className="text-xs text-muted-foreground">
              {limite != null
                ? `${Math.max(0, limite - usados)} licença(s) disponível(is)`
                : "Sem limite contratado"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4 text-primary" /> Dados da empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="emp-nome">Nome</Label>
              <Input
                id="emp-nome"
                value={form.nome}
                maxLength={120}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="emp-cnpj">CNPJ</Label>
              <Input
                id="emp-cnpj"
                value={form.cnpj}
                maxLength={18}
                onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="emp-email">E-mail de contato</Label>
              <Input
                id="emp-email"
                type="email"
                value={form.email}
                maxLength={255}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="emp-telefone">Telefone</Label>
              <Input
                id="emp-telefone"
                value={form.telefone}
                maxLength={20}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
              />
            </div>
          </div>
          <Button onClick={() => void salvar()} disabled={salvando || form.nome.trim().length < 2}>
            {salvando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar dados
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
