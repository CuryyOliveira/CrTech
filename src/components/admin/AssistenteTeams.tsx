/**
 * Aba Microsoft Teams: endereço do fluxo do Power Automate (guardado só no servidor),
 * destinatários, teste de conexão e histórico. Os disparos automáticos só são liberados
 * depois que o teste for aprovado — o mesmo fluxo guiado do e-mail.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Loader2,
  MessageSquareShare,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SkeletonLista } from "@/components/admin/ui-admin";
import { fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { tipoInfo } from "@/lib/notificacoes-conferencia";
import { emailPessoal, emailValido, rotuloEstadoTeams, validarUrlFluxo } from "@/lib/teams";
import { obterStatusTeams, salvarTeams, testarTeams } from "@/lib/teams.functions";

export const CHAVE_STATUS_TEAMS = ["teams-status"] as const;

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

function estadoClasse(estado: string) {
  if (estado === "enviado") return "bg-emerald-600 text-white hover:bg-emerald-600";
  if (estado === "falha") return "bg-destructive text-destructive-foreground";
  return "bg-muted text-muted-foreground hover:bg-muted";
}

export function AssistenteTeams() {
  const qc = useQueryClient();
  const [novaUrl, setNovaUrl] = useState("");
  const [trocarUrl, setTrocarUrl] = useState(false);
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [novo, setNovo] = useState("");
  const [destinoTeste, setDestinoTeste] = useState("");

  const { data: status, isLoading } = useQuery({
    queryKey: CHAVE_STATUS_TEAMS,
    queryFn: () => obterStatusTeams({ data: undefined as never }),
  });

  useEffect(() => {
    if (status) setDestinatarios(status.destinatarios);
  }, [status]);

  const salvar = useMutation({
    mutationFn: (entrada: { webhookUrl?: string; destinatarios?: string[]; ativo?: boolean }) =>
      salvarTeams({ data: entrada }),
    onSuccess: (novo, entrada) => {
      qc.setQueryData(CHAVE_STATUS_TEAMS, novo);
      setNovaUrl("");
      setTrocarUrl(false);
      void registrarAuditoria({
        tipo: "administracao",
        acao: "configuracao_alterada",
        detalhe:
          typeof entrada.ativo === "boolean"
            ? `Microsoft Teams: disparos ${entrada.ativo ? "ativados" : "desativados"}`
            : `Microsoft Teams: ${entrada.webhookUrl ? "endereço do fluxo alterado, " : ""}${
                novo.destinatarios.length
              } destinatário(s)`,
        modulo: "ADMIN",
      });
      toast.success("Configuração do Teams salva.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testar = useMutation({
    mutationFn: () => testarTeams({ data: { destino: destinoTeste.trim() || undefined } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: CHAVE_STATUS_TEAMS });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "configuracao_alterada",
        detalhe: `Teste de conexão do Teams: ${r.ok ? "aprovado" : `falhou — ${r.erro ?? "erro"}`}`,
        modulo: "ADMIN",
        resultado: r.ok ? "sucesso" : "erro",
      });
      if (r.ok)
        toast.success(
          "Card de teste enviado ao fluxo. Confira o chat do Workflows no Teams. Disparos automáticos liberados.",
        );
      else toast.error(r.erro ?? "Falha no teste de conexão.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !status) return <SkeletonLista linhas={4} />;

  const urlDigitada = novaUrl.trim();
  const validacaoUrl = urlDigitada ? validarUrlFluxo(urlDigitada) : null;
  const destinatariosIguais =
    JSON.stringify(destinatarios) === JSON.stringify(status.destinatarios);
  const pendenteSalvar = !!urlDigitada || !destinatariosIguais;
  const urlOk = status.urlConfigurada;
  const prontoParaTeste = urlOk && !pendenteSalvar && status.destinatarios.length > 0;
  const pessoais = destinatarios.filter(emailPessoal);

  const adicionar = () => {
    const email = novo.trim().toLowerCase();
    if (!emailValido(email)) return toast.error("Informe um e-mail válido.");
    if (destinatarios.includes(email)) return toast.info("E-mail já cadastrado.");
    setDestinatarios([...destinatarios, email]);
    setNovo("");
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">Notificações pelo Microsoft Teams</p>
              <p className="text-xs text-muted-foreground">
                As mesmas notificações do e-mail (início, conclusão e divergências), com o mesmo
                card informativo, no chat do Teams de cada destinatário. Enquanto o teste de conexão
                não for aprovado, nada é enviado ao Teams.
              </p>
            </div>
            <Badge
              className={
                status.liberado && status.ativo
                  ? "bg-emerald-600 text-white hover:bg-emerald-600"
                  : "bg-yellow-500 text-black hover:bg-yellow-500"
              }
            >
              {status.liberado && status.ativo ? (
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
            titulo="Endereço do fluxo (Power Automate)"
            ajuda="Cole a URL de HTTP POST do gatilho “When a Teams webhook request is received”. Ela fica guardada só no servidor e não é exibida novamente."
            concluida={urlOk}
          >
            {urlOk && !trocarUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  {status.urlMascarada}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTrocarUrl(true)}
                >
                  Trocar endereço
                </Button>
              </div>
            ) : (
              <>
                <Label htmlFor="teams-url">URL de HTTP POST</Label>
                <Input
                  id="teams-url"
                  type="password"
                  autoComplete="off"
                  placeholder="https://…logic.azure.com/workflows/… ou …api.powerplatform.com/…"
                  value={novaUrl}
                  onChange={(e) => setNovaUrl(e.target.value)}
                />
                {validacaoUrl && !validacaoUrl.ok && (
                  <p className="text-xs text-destructive">{validacaoUrl.motivo}</p>
                )}
                {urlOk && (
                  <p className="text-xs text-yellow-600">
                    Trocar o endereço exige um novo teste de conexão antes dos disparos.
                  </p>
                )}
              </>
            )}
          </Passo>

          <Passo
            numero={2}
            titulo="Destinatários no Teams"
            ajuda="Contas Microsoft 365 da organização que recebem o card no chat com o Workflows (Flow bot)."
            concluida={status.destinatarios.length > 0}
          >
            <div className="flex flex-wrap gap-2">
              {destinatarios.map((d) => (
                <Badge key={d} variant="outline" className="gap-1">
                  {d}
                  <button
                    type="button"
                    aria-label={`Remover ${d}`}
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => setDestinatarios(destinatarios.filter((x) => x !== d))}
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {!destinatarios.length && (
                <p className="text-xs text-muted-foreground">Nenhum destinatário cadastrado.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="nome@empresa.com"
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionar();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={adicionar}>
                Adicionar
              </Button>
            </div>
            {pessoais.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-yellow-600">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {pessoais.join(", ")} parece(m) ser e-mail pessoal: o Teams só entrega para contas
                da organização.
              </p>
            )}
          </Passo>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                salvar.mutate({
                  ...(urlDigitada ? { webhookUrl: urlDigitada } : {}),
                  destinatarios,
                })
              }
              disabled={salvar.isPending || !pendenteSalvar || (!!validacaoUrl && !validacaoUrl.ok)}
            >
              {salvar.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Salvar etapas 1 e 2
            </Button>
            {pendenteSalvar && (
              <p className="self-center text-xs text-yellow-600">
                Salve as alterações para liberar o teste de conexão.
              </p>
            )}
          </div>

          <Passo
            numero={3}
            titulo="Teste de conexão"
            ajuda="Envia um card de teste pelo fluxo. Os disparos automáticos só são liberados depois que o teste for aprovado."
            concluida={!!status.validadoEm}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder={`Destinatário de teste (padrão: ${
                  status.destinatarios[0] ?? "destinatários cadastrados"
                })`}
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
                  <MessageSquareShare className="mr-1.5 size-4" />
                )}
                Validar conexão
              </Button>
            </div>
            {status.validadoEm && (
              <p className="text-xs text-emerald-600">
                Conexão validada em {fmtDateTime(status.validadoEm)}
                {status.validadoPor ? ` com ${status.validadoPor}` : ""}.
              </p>
            )}
            {status.ultimoErro && !status.validadoEm && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {status.ultimoErro}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              O fluxo confirma o recebimento na hora; a entrega no chat leva alguns segundos. Se o
              card não chegar, confira o histórico de execuções do fluxo no Power Automate.
            </p>
          </Passo>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="font-semibold">Disparos pelo Teams</p>
              <p className="text-xs text-muted-foreground">
                Desative para pausar o Teams sem mexer no e-mail.
              </p>
            </div>
            <Switch
              checked={status.ativo}
              disabled={salvar.isPending}
              onCheckedChange={(ativo) => salvar.mutate({ ativo })}
              aria-label="Disparos pelo Teams"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="font-semibold">Últimos envios ao Teams</p>
          {!status.envios.length && (
            <p className="text-xs text-muted-foreground">Nenhum envio registrado.</p>
          )}
          <ul className="divide-y">
            {status.envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {e.teste ? "Teste de conexão" : tipoInfo(e.tipo).label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(e.concluido_em ?? e.reservado_em)} · {e.destinatarios.length}{" "}
                    destinatário(s)
                    {e.tentativas > 1 ? ` · ${e.tentativas} tentativas` : ""}
                  </p>
                  {e.erro && <p className="text-xs text-destructive">{e.erro}</p>}
                </div>
                <Badge className={estadoClasse(e.estado)}>{rotuloEstadoTeams(e.estado)}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
