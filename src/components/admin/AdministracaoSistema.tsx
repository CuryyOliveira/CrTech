import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Carregando } from "@/components/admin/consulta";
import { Confirmar, SkeletonLista } from "@/components/admin/ui-admin";
import { MatrizPermissoes } from "@/components/admin/MatrizPermissoes";
import { Governanca } from "@/components/admin/Governanca";

import { SISTEMA_CATEGORIAS } from "@/lib/admin";
import { compressImage, db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { limparDadosTeste } from "@/lib/limpeza.functions";
import { AssistenteEnvioEmail } from "@/components/admin/AssistenteEnvioEmail";
import {
  CONFIG_GERAL_PADRAO,
  CONFIG_SEGURANCA_PADRAO,
  CONFIG_SISTEMA_PADRAO,
  type ConfigGeral,
  type ConfigSeguranca,
  type ConfigSistema,
} from "@/lib/cadastros";
import {
  CONFIG_ALERTAS_PADRAO,
  INTEGRACOES_FUTURAS,
  type ConfigAlertas,
  type IntegracaoRow,
} from "@/lib/notificacoes";
import {
  CHAVE_CONFIG_EMAILS,
  CONFIG_EMAILS_PADRAO,
  type ConfigEmails,
} from "@/lib/notificacoes-conferencia";

import { useConfigAlertas } from "@/hooks/useNotificacoes";

/** Configurações gerais do sistema, organizadas por categorias. */
export function AdministracaoSistema() {
  return (
    <Tabs defaultValue={SISTEMA_CATEGORIAS[0].id}>
      <TabsList className="flex w-full flex-wrap">
        {SISTEMA_CATEGORIAS.map((c) => (
          <TabsTrigger key={c.id} value={c.id}>
            {c.titulo}
          </TabsTrigger>
        ))}
      </TabsList>
      {SISTEMA_CATEGORIAS.map((c) => (
        <TabsContent key={c.id} value={c.id} className="pt-4">
          {c.id === "gerais" ? (
            <ConfigGeralForm />
          ) : c.id === "usuarios" ? (
            <MatrizPermissoes />
          ) : c.id === "operacao" ? (
            <ConfigOperacaoForm />
          ) : c.id === "notificacoes" ? (
            <div className="space-y-3">
              <AssistenteEnvioEmail />
              <EmailsConferenciaForm />
              <ConfigAlertasForm />
            </div>
          ) : c.id === "seguranca" ? (
            <ConfigSegurancaForm />
          ) : c.id === "integracoes" ? (
            <Integracoes />
          ) : c.id === "governanca" ? (
            <Governanca />
          ) : (
            <BancoDados />
          )}

        </TabsContent>
      ))}
    </Tabs>
  );
}

/** Lê e grava um registro de configuracoes_sistema com valor JSON. */
function useConfig<T>(chave: string, padrao: T) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["config", chave],
    queryFn: async () => {
      const { data, error } = await db
        .from("configuracoes_sistema")
        .select("valor")
        .eq("chave", chave)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { ...padrao, ...((data?.valor ?? {}) as object) } as T;
    },
  });

  const salvar = useMutation({
    mutationFn: async (valor: T) => {
      const { error } = await db
        .from("configuracoes_sistema")
        .upsert({ chave, valor: valor as never }, { onConflict: "chave" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["config", chave] });
      toast.success("Configurações salvas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { data, isLoading, salvar };
}

function ConfigGeralForm() {
  const { data, isLoading, salvar } = useConfig<ConfigGeral>("geral", CONFIG_GERAL_PADRAO);
  const [form, setForm] = useState<ConfigGeral>(CONFIG_GERAL_PADRAO);
  const arquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (isLoading) return <Carregando />;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="empresa">Nome da empresa</Label>
            <Input
              id="empresa"
              value={form.empresa}
              onChange={(e) => setForm({ ...form, empresa: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cor">Cor principal</Label>
            <div className="flex gap-2">
              <Input
                id="cor"
                type="color"
                className="w-16 p-1"
                value={form.cor_principal}
                onChange={(e) => setForm({ ...form, cor_principal: e.target.value })}
              />
              <Input
                value={form.cor_principal}
                onChange={(e) => setForm({ ...form, cor_principal: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Tema padrão</Label>
            <Select
              value={form.tema}
              onValueChange={(v) => setForm({ ...form, tema: v as ConfigGeral["tema"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sistema">Seguir o sistema</SelectItem>
                <SelectItem value="claro">Claro</SelectItem>
                <SelectItem value="escuro">Escuro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Idioma</Label>
            <Select value={form.idioma} onValueChange={(v) => setForm({ ...form, idioma: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fuso horário</Label>
            <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                <SelectItem value="America/Manaus">America/Manaus</SelectItem>
                <SelectItem value="America/Cuiaba">America/Cuiaba</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Logotipo</Label>
            <div className="flex items-center gap-3">
              {form.logotipo ? (
                <img
                  src={form.logotipo}
                  alt="Logotipo da empresa"
                  className="h-10 w-20 rounded border object-contain"
                />
              ) : null}
              <Button variant="outline" size="sm" onClick={() => arquivo.current?.click()}>
                <Upload className="mr-1 size-4" /> Enviar
              </Button>
              {form.logotipo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm({ ...form, logotipo: "" })}
                >
                  Remover
                </Button>
              )}
              <input
                ref={arquivo}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    setForm({ ...form, logotipo: await compressImage(file, 400) });
                  } catch {
                    toast.error("Não foi possível processar a imagem.");
                  }
                }}
              />
            </div>
          </div>
        </div>
        <Button
          disabled={salvar.isPending}
          onClick={() => {
            salvar.mutate(form);
            void registrarAuditoria({
              tipo: "administracao",
              acao: "configuracao_geral_alterada",
              detalhe: `Empresa "${form.empresa}", tema ${form.tema}, cor ${form.cor_principal}`,
              modulo: "ADMIN",
            });
          }}
        >
          Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}

function ConfigSegurancaForm() {
  const { data, isLoading, salvar } = useConfig<ConfigSeguranca>(
    "seguranca",
    CONFIG_SEGURANCA_PADRAO,
  );
  const [form, setForm] = useState<ConfigSeguranca>(CONFIG_SEGURANCA_PADRAO);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (isLoading) return <Carregando />;

  const numeros: { chave: keyof ConfigSeguranca; label: string; ajuda: string }[] = [
    {
      chave: "sessao_minutos",
      label: "Tempo de sessão (min)",
      ajuda: "Expiração automática por inatividade.",
    },
    {
      chave: "senha_minima",
      label: "Tamanho mínimo da senha",
      ajuda: "Aplicado no cadastro e na redefinição.",
    },
    {
      chave: "limite_tentativas",
      label: "Tentativas de login",
      ajuda: "Falhas antes de gerar alerta de segurança.",
    },
    {
      chave: "sessoes_simultaneas",
      label: "Sessões simultâneas",
      ajuda: "Sessões abertas permitidas por usuário.",
    },
  ];

  const switches: { chave: keyof ConfigSeguranca; label: string; ajuda: string }[] = [
    { chave: "senha_exige_numero", label: "Exigir número na senha", ajuda: "Ao menos um dígito." },
    {
      chave: "senha_exige_maiuscula",
      label: "Exigir letra maiúscula",
      ajuda: "Ao menos uma letra maiúscula.",
    },
    {
      chave: "senha_exige_especial",
      label: "Exigir caractere especial",
      ajuda: "Ao menos um símbolo.",
    },
    {
      chave: "mfa_preparado",
      label: "Autenticação em duas etapas",
      ajuda: "Estrutura preparada para ativação futura.",
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {numeros.map((c) => (
            <div key={c.chave}>
              <Label htmlFor={c.chave}>{c.label}</Label>
              <Input
                id={c.chave}
                type="number"
                min={1}
                value={form[c.chave] as number}
                onChange={(e) => setForm({ ...form, [c.chave]: Number(e.target.value) })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{c.ajuda}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {switches.map((c) => (
            <div
              key={c.chave}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <Label htmlFor={c.chave}>{c.label}</Label>
                <p className="text-xs text-muted-foreground">{c.ajuda}</p>
              </div>
              <Switch
                id={c.chave}
                checked={Boolean(form[c.chave])}
                onCheckedChange={(v) => setForm({ ...form, [c.chave]: v })}
              />
            </div>
          ))}
        </div>
        <Button
          disabled={salvar.isPending}
          onClick={() => {
            salvar.mutate(form);
            void registrarAuditoria({
              tipo: "administracao",
              acao: "politica_seguranca_alterada",
              detalhe: `Sessão ${form.sessao_minutos} min, senha mínima ${form.senha_minima}, ${form.limite_tentativas} tentativas`,
              modulo: "ADMIN",
            });
          }}
        >
          Salvar políticas
        </Button>
      </CardContent>
    </Card>
  );
}

function ConfigOperacaoForm() {
  const { data, isLoading, salvar } = useConfig<ConfigSistema>("operacao", CONFIG_SISTEMA_PADRAO);
  const [form, setForm] = useState<ConfigSistema>(CONFIG_SISTEMA_PADRAO);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (isLoading) return <Carregando />;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="limpeza">Limpeza automática de registros antigos</Label>
            <p className="text-xs text-muted-foreground">
              Marca registros operacionais antigos para arquivamento. O Histórico Operacional
              permanece consultável.
            </p>
          </div>
          <Switch
            id="limpeza"
            checked={form.limpeza_automatica}
            onCheckedChange={(v) => setForm({ ...form, limpeza_automatica: v })}
          />
        </div>
        <div className="max-w-xs">
          <Label htmlFor="dias">Manter registros por (dias)</Label>
          <Input
            id="dias"
            type="number"
            min={30}
            value={form.limpeza_dias}
            onChange={(e) => setForm({ ...form, limpeza_dias: Number(e.target.value) })}
          />
        </div>
        <Button
          disabled={salvar.isPending}
          onClick={() => {
            salvar.mutate(form);
            void registrarAuditoria({
              tipo: "administracao",
              acao: "configuracao_operacao_alterada",
              detalhe: `Limpeza automática ${form.limpeza_automatica ? "ativa" : "inativa"} com retenção de ${form.limpeza_dias} dias`,
              modulo: "ADMIN",
            });
          }}
        >
          Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}

/** Limites usados pela Central de Notificações para gerar os alertas. */
function ConfigAlertasForm() {
  const qc = useQueryClient();
  const { data, isLoading } = useConfigAlertas();
  const [form, setForm] = useState<ConfigAlertas>(CONFIG_ALERTAS_PADRAO);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("configuracoes_sistema")
        .upsert({ chave: "alertas", valor: form }, { onConflict: "chave" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["config-alertas"] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "configuracao_alterada",
        detalhe: `Limites de alertas: ${form.minutos_sem_movimentacao} min sem movimentação, ${form.tempo_maximo_minutos} min máximos, ${form.limite_divergencias} divergências`,
        modulo: "ADMIN",
      });
      toast.success("Configurações salvas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Carregando />;

  const campos: { chave: keyof ConfigAlertas; label: string; ajuda: string }[] = [
    {
      chave: "minutos_sem_movimentacao",
      label: "Tempo sem movimentação (min)",
      ajuda: "Gera alerta quando a conferência fica parada por esse tempo.",
    },
    {
      chave: "tempo_maximo_minutos",
      label: "Tempo máximo por conferência (min)",
      ajuda: "Gera alerta crítico quando a conferência excede esse tempo.",
    },
    {
      chave: "limite_divergencias",
      label: "Limite de divergências",
      ajuda: "Gera alerta crítico quando as divergências passam desse total.",
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {campos.map((c) => (
            <div key={c.chave}>
              <Label htmlFor={c.chave}>{c.label}</Label>
              <Input
                id={c.chave}
                type="number"
                min={1}
                value={form[c.chave]}
                onChange={(e) => setForm({ ...form, [c.chave]: Number(e.target.value) })}
              />
              <p className="mt-1 text-xs text-muted-foreground">{c.ajuda}</p>
            </div>
          ))}
        </div>
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          Salvar configurações
        </Button>
      </CardContent>
    </Card>
  );
}

/** Estrutura preparada para integrações futuras — nenhuma é executada nesta fase. */
/** Liga/desliga o envio automático; o servidor é configurado no assistente. */
function EmailsConferenciaForm() {
  const { data, isLoading, salvar } = useConfig<ConfigEmails>(
    CHAVE_CONFIG_EMAILS,
    CONFIG_EMAILS_PADRAO,
  );

  if (isLoading || !data) return <SkeletonLista linhas={2} />;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label htmlFor="emails-ativo">Envio automático de notificações</Label>
            <p className="text-xs text-muted-foreground">
              Quando desligado, os eventos continuam registrados e auditados, sem envio de e-mails.
            </p>
          </div>
          <Switch
            id="emails-ativo"
            checked={data.ativo}
            onCheckedChange={(v) => {
              salvar.mutate({ ...data, ativo: v });
              void registrarAuditoria({
                tipo: "administracao",
                acao: "configuracao_alterada",
                detalhe: `Envio automático de notificações ${v ? "ativado" : "desativado"}`,
                modulo: "ADMIN",
              });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Integracoes() {
  const { data: registros = [], isLoading } = useQuery({
    queryKey: ["integracoes"],
    queryFn: async () => {
      const { data, error } = await db.from("integracoes").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as IntegracaoRow[];
    },
  });

  if (isLoading) return <Carregando />;

  const lista = INTEGRACOES_FUTURAS.map((i) => ({
    ...i,
    registro: registros.find((r) => r.tipo === i.tipo),
  }));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Arquitetura preparada para as integrações abaixo. A ativação será feita em uma fase futura.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {lista.map((i) => (
          <Card key={i.tipo}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{i.nome}</p>
                <p className="text-xs text-muted-foreground">{i.descricao}</p>
              </div>
              <Badge variant="outline">{i.registro?.ativo ? "Ativa" : "Preparada"}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Ferramentas de banco de dados: cópia de segurança das configurações e restauração. */
function BancoDados() {
  const qc = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);

  const { data: resumo, isLoading } = useQuery({
    queryKey: ["banco-resumo"],
    queryFn: async () => {
      const contar = async (
        tabela: "historico_conferencias" | "auditoria" | "user_profiles" | "cadastros_mestres",
      ) => {
        const { count } = await db.from(tabela).select("id", { count: "exact", head: true });
        return count ?? 0;
      };
      const [historico, auditoria, usuarios, cadastros] = await Promise.all([
        contar("historico_conferencias"),
        contar("auditoria"),
        contar("user_profiles"),
        contar("cadastros_mestres"),
      ]);
      return { historico, auditoria, usuarios, cadastros, em: new Date().toISOString() };
    },
  });

  async function backup() {
    const [config, cadastros, perfilPerm, usuarioPerm] = await Promise.all([
      db.from("configuracoes_sistema").select("*"),
      db.from("cadastros_mestres").select("*"),
      db.from("permissoes_perfil").select("*"),
      db.from("permissoes_usuario").select("*"),
    ]);
    const conteudo = {
      gerado_em: new Date().toISOString(),
      configuracoes_sistema: config.data ?? [],
      cadastros_mestres: cadastros.data ?? [],
      permissoes_perfil: perfilPerm.data ?? [],
      permissoes_usuario: usuarioPerm.data ?? [],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(conteudo, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-configuracoes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void registrarAuditoria({
      tipo: "exportacao",
      acao: "backup_configuracoes",
      detalhe: "Cópia de segurança das configurações e permissões gerada",
      modulo: "ADMIN",
    });
    toast.success("Cópia de segurança gerada.");
  }

  const restaurar = useMutation({
    mutationFn: async (file: File) => {
      const json = JSON.parse(await file.text()) as Record<string, unknown[]>;
      const aplicar = async (
        tabela:
          | "configuracoes_sistema"
          | "cadastros_mestres"
          | "permissoes_perfil"
          | "permissoes_usuario",
        conflito: string,
      ) => {
        const linhas = json[tabela];
        if (!Array.isArray(linhas) || !linhas.length) return;
        const { error } = await db.from(tabela).upsert(linhas as never, { onConflict: conflito });
        if (error) throw new Error(error.message);
      };
      await aplicar("configuracoes_sistema", "chave");
      await aplicar("cadastros_mestres", "id");
      await aplicar("permissoes_perfil", "id");
      await aplicar("permissoes_usuario", "id");
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      void registrarAuditoria({
        tipo: "importacao",
        acao: "restauracao_configuracoes",
        detalhe: "Configurações e permissões restauradas a partir de cópia de segurança",
        modulo: "ADMIN",
      });
      toast.success("Configurações restauradas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <SkeletonLista linhas={3} />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          {[
            { label: "Conferências no histórico", valor: resumo?.historico ?? 0 },
            { label: "Registros de auditoria", valor: resumo?.auditoria ?? 0 },
            { label: "Usuários", valor: resumo?.usuarios ?? 0 },
            { label: "Cadastros mestres", valor: resumo?.cadastros ?? 0 },
          ].map((i) => (
            <div key={i.label} className="rounded-lg border p-3">
              <p className="text-2xl font-semibold">{i.valor}</p>
              <p className="text-xs text-muted-foreground">{i.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            Última verificação: {fmtDateTime(resumo?.em)}. A cópia inclui configurações, cadastros
            mestres e permissões; os dados operacionais permanecem preservados no banco.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void backup()}>
              <Download className="mr-1 size-4" /> Gerar cópia de segurança
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={restaurar.isPending}
              onClick={() => arquivo.current?.click()}
            >
              <Upload className="mr-1 size-4" /> Restaurar cópia
            </Button>
            <input
              ref={arquivo}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) restaurar.mutate(file);
              }}
            />
          </div>
        </CardContent>
      </Card>
      <LimpezaDadosTeste />
    </div>
  );
}

/** Remove definitivamente as conferências e históricos de teste anteriores ao corte. */
function LimpezaDadosTeste() {
  const qc = useQueryClient();
  const [corte, setCorte] = useState("2026-08-03T10:25");
  const [confirmar, setConfirmar] = useState(false);
  const limpar = useServerFn(limparDadosTeste);

  const executar = useMutation({
    mutationFn: async (simular: boolean) =>
      limpar({ data: { corte: new Date(corte).toISOString(), simular } }),
    onSuccess: (r, simular) => {
      if (simular) {
        toast.info(
          `Prévia: ${r.conferencias} conferência(s), ${r.itens} item(ns) e ${r.historicos} histórico(s) e ${r.notificacoes} notificação(ões) serão removidos. Preservados: ${r.preservadas} conferência(s).`,
        );
        return;
      }
      setConfirmar(false);
      void registrarAuditoria({
        tipo: "administracao",
        acao: "limpeza_dados_teste",
        detalhe: `Removidos ${r.conferencias} conferências, ${r.itens} itens, ${r.pausas} pausas, ${r.historicos} históricos e ${r.notificacoes} notificações anteriores a ${fmtDateTime(r.corte)}`,
        modulo: "ADMIN",
      });
      void qc.invalidateQueries();
      toast.success(
        `Limpeza concluída: ${r.conferencias} conferência(s), ${r.itens} item(ns) e ${r.historicos} histórico(s) e ${r.notificacoes} notificação(ões) removidos. Preservados: ${r.preservadas} conferência(s) e ${r.historicosPreservados} histórico(s).`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="font-semibold text-destructive">Limpeza de dados de teste</p>
          <p className="text-xs text-muted-foreground">
            Remove definitivamente conferências, itens, pausas e históricos iniciados ANTES do
            horário informado. Tudo a partir do corte — inclusive conferências em andamento ou
            pausadas — permanece intacto. Usuários, materiais, unidades, permissões, configurações,
            notificações e auditoria não são afetados.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="corte-limpeza">Início da operação oficial</Label>
            <Input
              id="corte-limpeza"
              type="datetime-local"
              value={corte}
              onChange={(e) => setCorte(e.target.value)}
              className="w-56"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={executar.isPending}
            onClick={() => executar.mutate(true)}
          >
            Simular
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={executar.isPending}
            onClick={() => setConfirmar(true)}
          >
            <Trash2 className="mr-1 size-4" /> Limpar dados de teste
          </Button>
        </div>
      </CardContent>
      <Confirmar
        aberto={confirmar}
        onAberto={setConfirmar}
        titulo="Limpar dados de teste?"
        descricao={`Todas as conferências e históricos iniciados antes de ${corte.replace("T", " ")} serão removidos definitivamente. Esta ação não pode ser desfeita.`}
        onConfirmar={() => executar.mutate(false)}
      />
    </Card>
  );
}

