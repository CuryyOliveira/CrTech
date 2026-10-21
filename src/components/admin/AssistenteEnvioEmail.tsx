/**
 * Fluxo guiado de configuração do servidor de envio (domínio/DNS, remetente,
 * destinatários e teste de conexão). Os disparos reais só são liberados após a
 * validação bem-sucedida do teste.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, CircleDashed, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { SkeletonLista } from "@/components/admin/ui-admin";
import {
  CHAVE_CONFIG_EMAILS,
  CONFIG_EMAILS_PADRAO,
  dominioDoEmail,
  emailValido,
  etapasEnvio,
  type ConfigEmails,
} from "@/lib/notificacoes-conferencia";
import {
  diagnosticarConexaoEnvio,
  enviarEmailTeste,
} from "@/lib/notificacoes-conferencia.functions";

function Passo({
  numero,
  titulo,
  ajuda,
  concluida,
  children,
}: {
  numero: number;
  titulo: string;
  ajuda: string;
  concluida: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          concluida ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
        }`}
      >
        {concluida ? <Check className="size-4" /> : numero}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{titulo}</p>
          {concluida ? (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Concluído</Badge>
          ) : (
            <Badge variant="outline">Pendente</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
        {children}
      </div>
    </div>
  );
}

export function AssistenteEnvioEmail() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ConfigEmails>(CONFIG_EMAILS_PADRAO);
  const [novo, setNovo] = useState("");
  const [destinoTeste, setDestinoTeste] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["config", CHAVE_CONFIG_EMAILS],
    queryFn: async () => {
      const { data, error } = await db
        .from("configuracoes_sistema")
        .select("valor")
        .eq("chave", CHAVE_CONFIG_EMAILS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        ...CONFIG_EMAILS_PADRAO,
        ...((data?.valor ?? {}) as Partial<ConfigEmails>),
      } as ConfigEmails;
    },
  });

  const diagnostico = useQuery({
    queryKey: ["diagnostico-envio"],
    queryFn: () => diagnosticarConexaoEnvio({ data: undefined as never }),
  });

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const salvar = useMutation({
    mutationFn: async (valor: ConfigEmails) => {
      const { error } = await db
        .from("configuracoes_sistema")
        .upsert({ chave: CHAVE_CONFIG_EMAILS, valor: valor as never }, { onConflict: "chave" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["config", CHAVE_CONFIG_EMAILS] });
      await diagnostico.refetch();
      toast.success("Configuração de envio salva.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testar = useMutation({
    mutationFn: async () =>
      enviarEmailTeste({ data: { destino: destinoTeste.trim() || undefined } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["config", CHAVE_CONFIG_EMAILS] });
      await diagnostico.refetch();
      void registrarAuditoria({
        tipo: "administracao",
        acao: "configuracao_alterada",
        detalhe: `Teste de conexão de envio: ${r.ok ? "aprovado" : `falhou — ${r.erro ?? "erro"}`}`,
        modulo: "ADMIN",
        resultado: r.ok ? "sucesso" : "erro",
      });
      if (r.ok) toast.success("Conexão validada. Disparos automáticos liberados.");
      else toast.error(r.erro ?? "Falha no teste de conexão.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !config) return <SkeletonLista linhas={4} />;

  const etapas = etapasEnvio(form);
  const salvoIgual = JSON.stringify(form) === JSON.stringify(config);
  const prontoParaTeste =
    salvoIgual && etapas.slice(0, 3).every((e) => e.concluida) && !!diagnostico.data?.apiKey;
  const liberado = !!config.validado_em && etapas.every((e) => e.concluida);

  const adicionar = () => {
    const email = novo.trim().toLowerCase();
    if (!emailValido(email)) return toast.error("Informe um e-mail válido.");
    if (form.destinatarios.includes(email)) return toast.info("E-mail já cadastrado.");
    setForm({ ...form, destinatarios: [...form.destinatarios, email] });
    setNovo("");
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">Configuração do servidor de envio</p>
            <p className="text-xs text-muted-foreground">
              Siga as etapas abaixo. Enquanto o teste de conexão não for aprovado, as notificações
              continuam sendo registradas, mas nenhum e-mail real é disparado.
            </p>
          </div>
          <Badge
            className={
              liberado
                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                : "bg-yellow-500 text-black hover:bg-yellow-500"
            }
          >
            {liberado ? (
              <>
                <ShieldCheck className="mr-1 size-3" /> Disparos liberados
              </>
            ) : (
              <>
                <CircleDashed className="mr-1 size-3" /> Disparos bloqueados
              </>
            )}
          </Badge>
        </div>

        <Passo
          numero={1}
          titulo={etapas[0]!.titulo}
          ajuda={etapas[0]!.ajuda}
          concluida={etapas[0]!.concluida}
        >
          <Label htmlFor="assistente-dominio">Domínio verificado</Label>
          <Input
            id="assistente-dominio"
            placeholder="notificacoes.suaempresa.com"
            value={form.sender_domain}
            onChange={(e) =>
              setForm({ ...form, sender_domain: e.target.value.trim().toLowerCase() })
            }
          />
          <p className="text-xs text-muted-foreground">
            O domínio precisa estar verificado por DNS no painel de e-mail do projeto. Após a
            verificação, informe aqui exatamente o mesmo domínio.
          </p>
        </Passo>

        <Passo
          numero={2}
          titulo={etapas[1]!.titulo}
          ajuda={etapas[1]!.ajuda}
          concluida={etapas[1]!.concluida}
        >
          <Label htmlFor="assistente-remetente">E-mail remetente</Label>
          <Input
            id="assistente-remetente"
            placeholder="nao-responda@notificacoes.suaempresa.com"
            value={form.remetente}
            onChange={(e) => setForm({ ...form, remetente: e.target.value.trim().toLowerCase() })}
          />
          {!!form.remetente &&
            !!form.sender_domain &&
            dominioDoEmail(form.remetente) !== form.sender_domain && (
              <p className="text-xs text-destructive">
                O remetente precisa terminar em @{form.sender_domain}.
              </p>
            )}
        </Passo>

        <Passo
          numero={3}
          titulo={etapas[2]!.titulo}
          ajuda={etapas[2]!.ajuda}
          concluida={etapas[2]!.concluida}
        >
          <div className="flex flex-wrap gap-2">
            {form.destinatarios.map((d) => (
              <Badge key={d} variant="outline" className="gap-1">
                {d}
                <button
                  type="button"
                  aria-label={`Remover ${d}`}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setForm({ ...form, destinatarios: form.destinatarios.filter((x) => x !== d) })
                  }
                >
                  ×
                </button>
              </Badge>
            ))}
            {!form.destinatarios.length && (
              <p className="text-xs text-muted-foreground">Nenhum destinatário cadastrado.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="nome@empresa.com"
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={adicionar}>
              Adicionar
            </Button>
          </div>
        </Passo>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const cfg: ConfigEmails = { ...form, validado_em: null };
              setForm(cfg);
              salvar.mutate(cfg);
              void registrarAuditoria({
                tipo: "administracao",
                acao: "configuracao_alterada",
                detalhe: `Servidor de envio: domínio ${cfg.sender_domain || "—"}, remetente ${cfg.remetente || "—"}, ${cfg.destinatarios.length} destinatário(s)`,
                modulo: "ADMIN",
              });
            }}
            disabled={salvar.isPending || salvoIgual}
          >
            Salvar etapas 1 a 3
          </Button>
          {!salvoIgual && (
            <p className="self-center text-xs text-yellow-600">
              Salve as alterações para liberar o teste de conexão.
            </p>
          )}
        </div>

        <Passo
          numero={4}
          titulo={etapas[3]!.titulo}
          ajuda={etapas[3]!.ajuda}
          concluida={etapas[3]!.concluida}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder={`Endereço de teste (padrão: ${config.destinatarios[0] ?? "destinatários cadastrados"})`}
              value={destinoTeste}
              onChange={(e) => setDestinoTeste(e.target.value)}
            />
            <Button
              onClick={() => testar.mutate()}
              disabled={!prontoParaTeste || testar.isPending}
              className="shrink-0"
            >
              {testar.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <MailCheck className="mr-1.5 size-4" />
              )}
              Validar conexão
            </Button>
          </div>
          {config.validado_em && (
            <p className="text-xs text-emerald-600">
              Conexão validada em {fmtDateTime(config.validado_em)}
              {config.validado_por ? ` com ${config.validado_por}` : ""}.
            </p>
          )}
          {config.ultimo_erro && !config.validado_em && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {config.ultimo_erro}
            </p>
          )}
          {!diagnostico.data?.apiKey && (
            <p className="text-xs text-yellow-600">
              O serviço de envio do projeto ainda não está disponível. Publique o aplicativo e tente
              novamente.
            </p>
          )}
        </Passo>
      </CardContent>
    </Card>
  );
}
