import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Megaphone, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db, fmtDateTime } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { supabase } from "@/integrations/supabase/client";
import { AVISO_CATEGORIAS, type AvisoRow } from "@/lib/cadastros";
import { CATEGORIAS, categoriaInfo, type Categoria } from "@/lib/notificacoes";
import { PERFIS } from "@/lib/permissions";
import {
  CampoSelect,
  FiltrosPainel,
  useSetoresFiltro,
  TODOS,
  useBuscaLocal,
  useEstadoFiltros,
} from "@/components/admin/consulta";
import { EstadoVazio, MenuExportar, Paginacao, SkeletonLista, useConfirmacao } from "@/components/admin/ui-admin";

const PASSO = 20;

type Form = {
  id?: string;
  titulo: string;
  mensagem: string;
  categoria: AvisoRow["categoria"];
  prioridade: Categoria;
  destino_perfil: string;
  destino_setor: string;
  agendado_para: string;
  publicado: boolean;
  exige_confirmacao: boolean;
};

const VAZIO: Form = {
  titulo: "",
  mensagem: "",
  categoria: "aviso",
  prioridade: "info",
  destino_perfil: TODOS,
  destino_setor: TODOS,
  agendado_para: "",
  publicado: true,
  exige_confirmacao: false,
};

/** Avisos do sistema: publicação, agendamento, prioridade e confirmação de leitura. */
export function AvisosSistema() {
  const qc = useQueryClient();
  const confirmacao = useConfirmacao();
  const [form, setForm] = useState<Form | null>(null);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(PASSO);
  const setoresFiltro = useSetoresFiltro();
  const { filtros, set, limpar, aberto, alternar } = useEstadoFiltros({
    categoria: TODOS,
    prioridade: TODOS,
    situacao: TODOS,
  });

  const { data: avisos = [], isLoading } = useQuery({
    queryKey: ["avisos-sistema"],
    queryFn: async () => {
      const { data, error } = await db
        .from("avisos_sistema")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AvisoRow[];
    },
  });

  const { data: leituras = [] } = useQuery({
    queryKey: ["aviso-leituras"],
    queryFn: async () => {
      const { data, error } = await db.from("aviso_leituras").select("aviso_id,user_id");
      if (error) throw new Error(error.message);
      return (data ?? []) as { aviso_id: string; user_id: string }[];
    },
  });

  const confirmacoes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const l of leituras) mapa.set(l.aviso_id, (mapa.get(l.aviso_id) ?? 0) + 1);
    return mapa;
  }, [leituras]);

  const salvar = useMutation({
    mutationFn: async (dados: Form) => {
      const { data: auth } = await supabase.auth.getUser();
      const payload = {
        titulo: dados.titulo.trim(),
        mensagem: dados.mensagem.trim(),
        categoria: dados.categoria,
        prioridade: dados.prioridade,
        destino_perfil: dados.destino_perfil === TODOS ? null : dados.destino_perfil,
        destino_setor: dados.destino_setor === TODOS ? null : dados.destino_setor,
        agendado_para: dados.agendado_para ? new Date(dados.agendado_para).toISOString() : null,
        publicado: dados.publicado,
        exige_confirmacao: dados.exige_confirmacao,
      };
      if (dados.id) {
        const { error } = await db.from("avisos_sistema").update(payload).eq("id", dados.id);
        if (error) throw new Error(error.message);
        return "editado" as const;
      }
      const { error } = await db
        .from("avisos_sistema")
        .insert({ ...payload, created_by: auth.user?.id ?? null });
      if (error) throw new Error(error.message);
      return "criado" as const;
    },
    onSuccess: (modo, dados) => {
      void qc.invalidateQueries({ queryKey: ["avisos-sistema"] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: modo === "criado" ? "aviso_publicado" : "aviso_editado",
        detalhe: `Aviso "${dados.titulo}" (${dados.prioridade})`,
        modulo: "ADMIN",
      });
      toast.success(modo === "criado" ? "Aviso publicado." : "Aviso atualizado.");
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alterar = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AvisoRow> }) => {
      const { error } = await db.from("avisos_sistema").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["avisos-sistema"] });
      toast.success("Aviso atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (aviso: AvisoRow) => {
      const { error } = await db.from("avisos_sistema").delete().eq("id", aviso.id);
      if (error) throw new Error(error.message);
      return aviso;
    },
    onSuccess: (aviso) => {
      void qc.invalidateQueries({ queryKey: ["avisos-sistema"] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "aviso_excluido",
        detalhe: `Aviso "${aviso.titulo}" excluído`,
        modulo: "ADMIN",
      });
      toast.success("Aviso excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = useMemo(
    () =>
      avisos.filter((a) => {
        if (filtros.categoria !== TODOS && a.categoria !== filtros.categoria) return false;
        if (filtros.prioridade !== TODOS && a.prioridade !== filtros.prioridade) return false;
        if (filtros.situacao === "publicados" && !a.publicado) return false;
        if (filtros.situacao === "agendados" && !(a.agendado_para && new Date(a.agendado_para) > new Date()))
          return false;
        if (filtros.situacao === "arquivados" && !a.arquivado) return false;
        return true;
      }),
    [avisos, filtros],
  );

  const buscados = useBuscaLocal(filtrados, busca, (a) => [a.titulo, a.mensagem]);
  const visiveis = buscados.slice(0, limite);

  const colunas = [
    { chave: "titulo", titulo: "Título", valor: (a: AvisoRow) => a.titulo },
    { chave: "categoria", titulo: "Categoria", valor: (a: AvisoRow) => a.categoria },
    { chave: "prioridade", titulo: "Prioridade", valor: (a: AvisoRow) => a.prioridade },
    { chave: "destino", titulo: "Destino", valor: (a: AvisoRow) => a.destino_perfil ?? a.destino_setor ?? "Todos" },
    { chave: "agendado", titulo: "Agendado para", valor: (a: AvisoRow) => fmtDateTime(a.agendado_para) },
    { chave: "publicado", titulo: "Publicado", valor: (a: AvisoRow) => (a.publicado ? "Sim" : "Não") },
    { chave: "leituras", titulo: "Confirmações", valor: (a: AvisoRow) => String(confirmacoes.get(a.id) ?? 0) },
    { chave: "criado", titulo: "Criado em", valor: (a: AvisoRow) => fmtDateTime(a.created_at) },
  ];

  return (
    <div className="space-y-3">
      <FiltrosPainel
        aberto={aberto}
        onToggle={alternar}
        busca={busca}
        onBusca={setBusca}
        placeholder="Pesquisar avisos..."
        onLimpar={() => {
          limpar();
          setBusca("");
        }}
      >
        <CampoSelect
          label="Categoria"
          valor={filtros.categoria}
          onChange={(v) => set("categoria", v)}
          opcoes={AVISO_CATEGORIAS.map((c) => ({ valor: c.valor, label: c.label }))}
        />
        <CampoSelect
          label="Prioridade"
          valor={filtros.prioridade}
          onChange={(v) => set("prioridade", v)}
          opcoes={CATEGORIAS.map((c) => ({ valor: c.valor, label: c.label }))}
        />
        <CampoSelect
          label="Situação"
          valor={filtros.situacao}
          onChange={(v) => set("situacao", v)}
          opcoes={[
            { valor: "publicados", label: "Publicados" },
            { valor: "agendados", label: "Agendados" },
            { valor: "arquivados", label: "Arquivados" },
          ]}
        />
      </FiltrosPainel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{buscados.length} aviso(s)</p>
        <div className="flex gap-2">
          <MenuExportar
            titulo="Avisos do sistema"
            subtitulo={`${buscados.length} aviso(s)`}
            colunas={colunas}
            linhas={buscados}
          />
          <Button size="sm" onClick={() => setForm({ ...VAZIO })}>
            <Plus className="mr-1 size-4" /> Novo aviso
          </Button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonLista />
      ) : !visiveis.length ? (
        <EstadoVazio
          titulo="Nenhum aviso publicado"
          descricao="Crie avisos, atualizações e alertas para os usuários do sistema."
          acao={
            <Button size="sm" onClick={() => setForm({ ...VAZIO })}>
              <Megaphone className="mr-1 size-4" /> Criar aviso
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {visiveis.map((a) => {
            const info = categoriaInfo(a.prioridade);
            const agendado = a.agendado_para && new Date(a.agendado_para) > new Date();
            return (
              <Card key={a.id} className={a.arquivado ? "opacity-60" : undefined}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={info.classe}>{info.label}</Badge>
                    <Badge variant="outline">
                      {AVISO_CATEGORIAS.find((c) => c.valor === a.categoria)?.label ?? a.categoria}
                    </Badge>
                    <p className="font-semibold">{a.titulo}</p>
                    {agendado && <Badge variant="secondary">Agendado</Badge>}
                    {!a.publicado && <Badge variant="secondary">Não publicado</Badge>}
                    {a.arquivado && <Badge variant="secondary">Arquivado</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{a.mensagem}</p>
                  <p className="text-xs text-muted-foreground">
                    Destino: {a.destino_perfil ?? a.destino_setor ?? "todos os usuários"} · Criado em{" "}
                    {fmtDateTime(a.created_at)}
                    {a.agendado_para ? ` · Agendado para ${fmtDateTime(a.agendado_para)}` : ""}
                    {a.exige_confirmacao
                      ? ` · ${confirmacoes.get(a.id) ?? 0} confirmação(ões) de leitura`
                      : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForm({
                          id: a.id,
                          titulo: a.titulo,
                          mensagem: a.mensagem,
                          categoria: a.categoria,
                          prioridade: a.prioridade,
                          destino_perfil: a.destino_perfil ?? TODOS,
                          destino_setor: a.destino_setor ?? TODOS,
                          agendado_para: a.agendado_para ? a.agendado_para.slice(0, 16) : "",
                          publicado: a.publicado,
                          exige_confirmacao: a.exige_confirmacao,
                        })
                      }
                    >
                      <Pencil className="mr-1 size-4" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => alterar.mutate({ id: a.id, patch: { publicado: !a.publicado } })}
                    >
                      <Send className="mr-1 size-4" /> {a.publicado ? "Despublicar" : "Publicar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => alterar.mutate({ id: a.id, patch: { arquivado: !a.arquivado } })}
                    >
                      <Archive className="mr-1 size-4" /> {a.arquivado ? "Desarquivar" : "Arquivar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        confirmacao.pedir(
                          "Excluir aviso?",
                          `O aviso "${a.titulo}" e suas confirmações de leitura serão removidos.`,
                          () => excluir.mutate(a),
                        )
                      }
                    >
                      <Trash2 className="mr-1 size-4" /> Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Paginacao
            total={buscados.length}
            visiveis={visiveis.length}
            passo={PASSO}
            onMais={() => setLimite((l) => l + PASSO)}
          />
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar aviso" : "Novo aviso"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div>
                <Label>Título</Label>
                <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea
                  rows={4}
                  value={form.mensagem}
                  onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Categoria</Label>
                  <Select
                    value={form.categoria}
                    onValueChange={(v) => setForm({ ...form, categoria: v as AvisoRow["categoria"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AVISO_CATEGORIAS.map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Prioridade</Label>
                  <Select
                    value={form.prioridade}
                    onValueChange={(v) => setForm({ ...form, prioridade: v as Categoria })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS.map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>
                          {c.emoji} {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Perfil de destino</Label>
                  <Select
                    value={form.destino_perfil}
                    onValueChange={(v) => setForm({ ...form, destino_perfil: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos os perfis</SelectItem>
                      {PERFIS.map((p) => (
                        <SelectItem key={p.valor} value={p.valor}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Setor de destino</Label>
                  <Select
                    value={form.destino_setor}
                    onValueChange={(v) => setForm({ ...form, destino_setor: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos os setores</SelectItem>
                      {setoresFiltro.map((s) => (
                        <SelectItem key={s.valor} value={s.valor}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Agendar para (opcional)</Label>
                <Input
                  type="datetime-local"
                  value={form.agendado_para}
                  onChange={(e) => setForm({ ...form, agendado_para: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    id="publicado"
                    checked={form.publicado}
                    onCheckedChange={(v) => setForm({ ...form, publicado: v })}
                  />
                  <Label htmlFor="publicado">Publicado</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="confirmacao"
                    checked={form.exige_confirmacao}
                    onCheckedChange={(v) => setForm({ ...form, exige_confirmacao: v })}
                  />
                  <Label htmlFor="confirmacao">Exigir confirmação de leitura</Label>
                </div>
              </div>
              <Button
                className="w-full"
                disabled={salvar.isPending}
                onClick={() => {
                  if (!form.titulo.trim() || !form.mensagem.trim())
                    return toast.error("Informe título e mensagem.");
                  salvar.mutate(form);
                }}
              >
                Salvar aviso
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmacao.elemento}
    </div>
  );
}
