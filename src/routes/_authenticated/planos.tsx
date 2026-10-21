import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Building2, Check, CreditCard, Loader2, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { SkeletonLista } from "@/components/admin/ui-admin";
import {
  cadastrarMinhaEmpresa,
  iniciarCheckoutMercadoPago,
  planosDisponiveis,
  statusAssinaturaEmpresa,
} from "@/lib/pagamentos.functions";

import { ambienteCobranca, STATUS_ASSINATURA_LABEL } from "@/lib/cobranca";
import { MODULOS } from "@/lib/permissions";
import { ModuloGuard } from "@/components/ModuloGuard";

export const Route = createFileRoute("/_authenticated/planos")({
  validateSearch: (busca: Record<string, unknown>): { checkout?: string } =>
    typeof busca['checkout'] === "string" ? { checkout: busca['checkout'] as string } : {},
  head: () => ({
    meta: [
      { title: "Planos e Assinatura | Conferência Rápida" },
      {
        name: "description",
        content:
          "Escolha o plano da sua empresa no Conferência Rápida: módulos de conferência, usuários inclusos e cobrança recorrente segura.",
      },
      { property: "og:title", content: "Planos e Assinatura | Conferência Rápida" },
      {
        property: "og:description",
        content: "Contrate o plano ideal para a conferência de materiais da sua operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanosProtegido,
});

function moeda(centavos: number | null, m: string | null) {
  if (centavos == null) return "Sob consulta";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: m || "BRL" });
}

const PERIODICIDADE: Record<string, string> = {
  month: "por mês",
  year: "por ano",
  mensal: "por mês",
  anual: "por ano",
};

function tituloModulo(id: string) {
  return MODULOS.find((m) => m.id === id)?.titulo ?? id;
}

/** Rótulos amigáveis dos recursos e limites cadastrados no plano. */
const RECURSO_LABEL: Record<string, string> = {
  estoque: "Estoque",
  conferencia_importada: "Conferência importada",
  relatorios: "Relatórios",
  notificacoes: "Notificações por e-mail",
  central_administrativa: "Central Administrativa",
  frota: "Frota",
  ferramentas_agricola: "Ferramentas Agrícola",
  ferramentas_industria: "Ferramentas Indústria",
};

function textoRecurso(chave: string, valor: unknown) {
  const label = RECURSO_LABEL[chave] ?? chave;
  if (typeof valor === "string") return `${label}: ${valor}`;
  return label;
}

function textoLimite(chave: string, valor: unknown) {
  const numero = typeof valor === "number" ? valor.toLocaleString("pt-BR") : null;
  if (chave === "conferencias_mes") return `Até ${numero ?? "—"} conferências por mês`;
  if (chave === "itens_por_lista") return `Até ${numero ?? "—"} itens por lista`;
  if (chave === "historico_dias") {
    if (valor == null) return "Histórico ilimitado";
    return Number(valor) >= 365
      ? `Histórico de ${Math.round(Number(valor) / 365)} ano(s)`
      : `Histórico de ${valor} dias`;
  }
  return `${chave}: ${String(valor)}`;
}


/** Planos e assinatura são exclusivos do administrador da empresa. */
function PlanosProtegido() {
  return (
    <ModuloGuard modulo="ADMIN" permitirSemAssinatura>
      <Planos />
    </ModuloGuard>
  );
}

function Planos() {
  const ambiente = ambienteCobranca();
  const busca = useSearch({ from: "/_authenticated/planos" });
  const queryClient = useQueryClient();
  const carregar = useServerFn(planosDisponiveis);
  const iniciarCheckout = useServerFn(iniciarCheckoutMercadoPago);
  const consultarStatus = useServerFn(statusAssinaturaEmpresa);

  const [processando, setProcessando] = useState<string | null>(null);
  const [aguardando, setAguardando] = useState(false);
  const [periodo, setPeriodo] = useState<"mensal" | "anual">("mensal");
  const [planoEscolhido, setPlanoEscolhido] = useState<string | null>(null);
  const [emailPagador, setEmailPagador] = useState("");


  const { data, isLoading, error } = useQuery({
    queryKey: ["planos-disponiveis", ambiente],
    queryFn: () => carregar({ data: { ambiente } }),
  });

  // Após o checkout, o webhook é a fonte de verdade: aguardamos a confirmação.
  useEffect(() => {
    if (!aguardando && busca.checkout !== "sucesso") return;
    let tentativas = 0;
    const timer = setInterval(async () => {
      tentativas += 1;
      const atual = await consultarStatus({ data: { ambiente } });
      if (atual.status && atual.status !== "incompleta") {
        clearInterval(timer);
        setAguardando(false);
        void queryClient.invalidateQueries({ queryKey: ["planos-disponiveis"] });
        void queryClient.invalidateQueries({ queryKey: ["painel-assinaturas"] });
        if (atual.status === "ativa" || atual.status === "trial") {
          toast.success("Assinatura confirmada", {
            description: "Pagamento aprovado e plano liberado para a sua empresa.",
          });
        } else if (atual.status === "pagamento_pendente") {
          toast.warning("Pagamento pendente", {
            description: "O provedor está reprocessando a cobrança.",
          });
        } else {
          toast.info(STATUS_ASSINATURA_LABEL[atual.status] ?? atual.status);
        }
      } else if (tentativas >= 20) {
        clearInterval(timer);
        setAguardando(false);
        toast.info("Ainda aguardando a confirmação do provedor", {
          description: "A assinatura será atualizada automaticamente quando o pagamento constar.",
        });
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [aguardando, busca.checkout, ambiente, consultarStatus, queryClient]);

  const statusAtual = useMemo(() => {
    const plano = data?.planoAtual as { status?: string } | null;
    return plano?.status ?? null;
  }, [data]);

  async function assinar(codigo: string) {
    const email = emailPagador.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast.error("Informe o e-mail da sua conta Mercado Pago");
      return;
    }
    setProcessando(codigo);
    try {
      const contexto = await iniciarCheckout({
        data: {
          planoCodigo: codigo,
          ambiente,
          origem: window.location.origin,
          emailPagador: email,
        },
      });
      toast.success("Redirecionando para o checkout seguro…", {
        description: "Os dados do cartão são informados diretamente no provedor de pagamento.",
      });
      window.location.href = contexto.url;
    } catch (e) {
      toast.error("Não foi possível abrir o checkout", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
      setProcessando(null);
    }
  }


  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/menu">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <Link to="/assinatura">
            <ShieldCheck className="size-4" /> Minha assinatura
          </Link>
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Planos e Assinatura</h1>
        <p className="text-sm text-muted-foreground">
          Contrate ou altere o plano da sua empresa. O pagamento é processado pelo provedor
          oficial — nenhum dado de cartão é armazenado no aplicativo.
        </p>
        <p className="text-sm text-muted-foreground">
          14 dias de teste gratuito com os recursos do plano Profissional. Cada assinatura
          corresponde a uma empresa — os usuários pertencem à empresa.
        </p>
      </header>

      {ambiente === "sandbox" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          Ambiente de <strong>teste</strong>: use cartões de teste, nenhuma cobrança real é feita.
        </div>
      )}

      {statusAtual && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <ShieldCheck className="size-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Assinatura atual</p>
              <p className="text-xs text-muted-foreground">
                {(data?.planoAtual as { plano_codigo?: string } | null)?.plano_codigo ?? "—"}
              </p>
            </div>
            <Badge
              className={
                statusAtual === "ativa" || statusAtual === "trial"
                  ? "bg-emerald-600 text-white"
                  : statusAtual === "pagamento_pendente" || statusAtual === "suspensa"
                    ? "bg-amber-500 text-black"
                    : "bg-destructive text-white"
              }
            >
              {STATUS_ASSINATURA_LABEL[statusAtual] ?? statusAtual}
            </Badge>
          </CardContent>
        </Card>
      )}

      {aguardando && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" /> Aguardando a confirmação do pagamento…
        </div>
      )}

      {isLoading ? (
        <SkeletonLista linhas={3} />
      ) : error ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Não foi possível carregar os planos."}
        </div>
      ) : !data?.empresaId ? (
        <FormularioEmpresa
          onCadastrada={() => {
            void queryClient.invalidateQueries({ queryKey: ["planos-disponiveis"] });
          }}
        />

      ) : data.planos.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum plano publicado ainda. Os planos comerciais aparecerão aqui assim que forem
          cadastrados.
        </div>
      ) : (
        <>
        <div className="flex w-fit items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {(["mensal", "anual"] as const).map((op) => (
            <Button
              key={op}
              size="sm"
              variant={periodo === op ? "default" : "ghost"}
              onClick={() => setPeriodo(op)}
            >
              {op === "mensal" ? "Mensal" : "Anual"}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.planos
            .filter((p) => p.periodicidade === periodo)
            .map((p) => (
            <Card
              key={p.id}
              className={`flex flex-col ${p.recursos?.['popular'] ? "border-primary shadow-lg" : ""}`}
            >
              <CardHeader className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{p.nome}</CardTitle>
                  {p.recursos?.['popular'] ? <Badge>Mais popular</Badge> : null}
                </div>
                {p.descricao && (
                  <p className="text-sm text-muted-foreground">{p.descricao}</p>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="space-y-1">
                  <p className="text-2xl font-bold">{moeda(p.valor_centavos, p.moeda)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.periodicidade ? (PERIODICIDADE[p.periodicidade] ?? p.periodicidade) : "—"}
                  </p>
                  {p.dias_trial > 0 && (
                    <Badge variant="secondary" className="font-semibold">
                      {p.dias_trial} dias grátis
                    </Badge>
                  )}
                </div>


                <p className="flex items-center gap-2 text-sm">
                  <Users className="size-4 text-primary" />
                  {p.max_usuarios ? `Até ${p.max_usuarios} usuários` : "Usuários ilimitados"}
                </p>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Módulos incluídos
                  </p>
                  <ul className="space-y-1 text-sm">
                    {p.modulos.length === 0 ? (
                      <li className="text-muted-foreground">—</li>
                    ) : (
                      p.modulos.map((m) => (
                        <li key={m} className="flex items-center gap-2">
                          <Check className="size-4 text-emerald-600" /> {tituloModulo(m)}
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {Object.keys(p.recursos ?? {}).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Recursos
                    </p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(p.recursos)
                        .filter(([chave, valor]) => chave !== "popular" && valor !== false)
                        .map(([chave, valor]) => (
                          <li key={chave} className="flex items-center gap-2">
                            <Check className="size-4 text-emerald-600" />
                            {textoRecurso(chave, valor)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {Object.keys(p.limites ?? {}).length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {Object.entries(p.limites).map(([chave, valor]) => (
                      <li key={chave}>{textoLimite(chave, valor)}</li>
                    ))}
                  </ul>
                )}

                <Button
                  className="mt-auto w-full"
                  onClick={() => setPlanoEscolhido(p.codigo)}
                  disabled={processando === p.codigo || aguardando}
                >
                  {processando === p.codigo ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CreditCard className="size-4" />
                  )}
                  Assinar
                </Button>

              </CardContent>
            </Card>
          ))}
        </div>
        </>
      )}

      <Dialog
        open={planoEscolhido !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !processando) setPlanoEscolhido(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirme sua conta Mercado Pago</DialogTitle>
            <DialogDescription>
              Informe o e-mail da conta Mercado Pago que você vai usar no checkout. Se o e-mail
              não for o mesmo da conta conectada, o Mercado Pago mantém o botão “Confirmar”
              desabilitado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="email-mercado-pago">E-mail da conta Mercado Pago</Label>
            <Input
              id="email-mercado-pago"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              value={emailPagador}
              onChange={(e) => setEmailPagador(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Não use a conta que recebe os pagamentos da assinatura: o Mercado Pago não permite
              assinar o próprio plano.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPlanoEscolhido(null)}
              disabled={Boolean(processando)}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => planoEscolhido && void assinar(planoEscolhido)}
              disabled={Boolean(processando)}
            >
              {processando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Continuar para o pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}

/** Cadastro da empresa do administrador — pré-requisito para contratar um plano. */
function FormularioEmpresa({ onCadastrada }: { onCadastrada: () => void }) {
  const cadastrar = useServerFn(cadastrarMinhaEmpresa);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function enviar() {
    setSalvando(true);
    try {
      await cadastrar({ data: { nome, cnpj } });
      toast.success("Empresa cadastrada");
      onCadastrada();
    } catch (e) {
      toast.error("Não foi possível cadastrar a empresa", {
        description: e instanceof Error ? e.message : "Tente novamente.",
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4 text-primary" /> Cadastre sua empresa
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Cada assinatura pertence a uma empresa. Informe os dados para liberar a contratação.
          Usuários sem perfil administrativo devem solicitar o vínculo a um administrador.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="empresa-nome">Nome da empresa</Label>
          <Input
            id="empresa-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Razão social ou nome fantasia"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="empresa-cnpj">CNPJ (opcional)</Label>
          <Input
            id="empresa-cnpj"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
          />
        </div>
        <Button onClick={() => void enviar()} disabled={salvando || nome.trim().length < 2}>
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
          Cadastrar empresa
        </Button>
      </CardContent>
    </Card>
  );
}
