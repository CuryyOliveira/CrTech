import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  FileDown,
  FileSpreadsheet,
  History,
  ImagePlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignaturePad } from "@/components/SignaturePad";
import {
  acharColunaQuantidade,
  compressImage,
  db,
  fmtDate,
  fmtTime,
  fmtDateTime,
  log,
  normalize,
  ordenarPorLocacao,
  ORIGEM_ADICIONADO,
  ORIGEM_ADICIONADO_LABEL,
  foiAdicionadoNaConferencia,
  pick,
  salvarMateriais,
  toNumero,
  type Conferencia,
  type ItemConferencia,
  type Material,
  type Unidade,
} from "@/lib/app";
import { agoraLocalISO, dataLocalISO } from "@/lib/datas";
import { exportExcel, exportPDF, readSheet } from "@/lib/export";
import { AcessoNegado } from "@/components/AcessoNegado";
import { usePermissoes } from "@/hooks/usePermissoes";
import { moduloPorTipo } from "@/lib/permissions";
import { FAMILIA_POR_TIPO, type TipoModulo } from "@/lib/modulos";
import { abrirHistorico, contextoUsuario, fecharHistorico, registrarAuditoria } from "@/lib/audit";
import { registrarErroConferencia } from "@/lib/notificacoes-inicio";
import { fmtDuracao } from "@/lib/notificacoes-conferencia";
import { tempoEmPausa, tempoTrabalhado } from "@/lib/gerencial";
import { CONFERENCIA_V2_ATIVA } from "@/lib/conferencia-v2/flag";
import { UnidadeV2, type ModoV2 } from "@/components/conferencia-v2/UnidadeV2";

export const Route = createFileRoute("/_authenticated/unidade/$id")({
  head: () => ({
    meta: [
      { title: "Conferência — Conferência de Materiais" },
      {
        name: "description",
        content: "Conferência dos materiais, divergências, assinaturas e histórico.",
      },
      { property: "og:title", content: "Conferência — Conferência de Materiais" },
      {
        property: "og:description",
        content: "Conferência dos materiais, divergências, assinaturas e histórico.",
      },
    ],
  }),
  // VITE_CONFERENCE_V2=1: conferência nova (motor V2). Desligada: V1 exatamente como antes.
  component: CONFERENCIA_V2_ATIVA ? RotaConferenciaV2 : () => <UnidadeDetalhe />,
});

function RotaConferenciaV2() {
  const { id } = Route.useParams();
  return <UnidadeV2 unidadeId={id} renderV1={(modo) => <UnidadeDetalhe modoV2={modo} />} />;
}

function UnidadeDetalhe({ modoV2 }: { modoV2?: ModoV2 } = {}) {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pendentes" | "conferidos" | "divergencias">(
    "todos",
  );
  const [itemAberto, setItemAberto] = useState<ItemConferencia | null>(null);
  const [contado, setContado] = useState("");
  const [obsItem, setObsItem] = useState("");
  const [fotosItem, setFotosItem] = useState<string[]>([]);
  const [novoMaterial, setNovoMaterial] = useState(false);
  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [buscaCadastro, setBuscaCadastro] = useState("");
  const [motivoInclusao, setMotivoInclusao] = useState("");
  const [selecionado, setSelecionado] = useState<Material | null>(null);
  const [manCodigo, setManCodigo] = useState("");
  const [manDescricao, setManDescricao] = useState("");
  const [manQtd, setManQtd] = useState("1");
  const [matForm, setMatForm] = useState<Partial<Material>>({});
  const [iniciar, setIniciar] = useState(false);
  const [startForm, setStartForm] = useState<Record<string, string>>({});
  const [finalizar, setFinalizar] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [fimForm, setFimForm] = useState<Record<string, string>>({});
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [assinaturaGestor, setAssinaturaGestor] = useState<string | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState<Conferencia | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);

  const { data: unidade } = useQuery({
    queryKey: ["unidade", id],
    queryFn: async () => {
      const { data, error } = await db.from("unidades").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Unidade;
    },
  });

  const { carregando: carregandoPerfil, podeTipo } = usePermissoes();
  // Unidades de módulos criados pela empresa (Motor Universal) já são
  // isoladas por empresa/módulo no banco; a família vem do tipo do módulo.
  const moduloDinamico = Boolean((unidade as { modulo_id?: string | null } | undefined)?.modulo_id);
  const familia = moduloDinamico
    ? (FAMILIA_POR_TIPO[unidade!.tipo as TipoModulo] ?? "prateleira")
    : moduloPorTipo(unidade?.tipo)?.familia;
  const acessoNegado =
    !carregandoPerfil && !!unidade && !moduloDinamico && !podeTipo(unidade.tipo);

  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("materiais")
        .select("*")
        .eq("unidade_id", id)
        .order("codigo");
      if (error) throw error;
      return ordenarPorLocacao(data as Material[]);
    },
  });

  const { data: conferencias = [] } = useQuery({
    queryKey: ["conferencias", id],
    queryFn: async () => {
      const { data, error } = await db
        .from("conferencias")
        .select("*")
        .eq("unidade_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Conferencia[];
    },
  });

  const ativa =
    conferencias.find((c) => c.status === "em_andamento" || c.status === "pausada") ?? null;

  const pausada = ativa?.status === "pausada";

  const finalizadas = conferencias.filter(
    (c) => c.status !== "em_andamento" && c.status !== "pausada",
  );

  const {
    data: statsHist = {} as Record<string, { total: number; conferidos: number; diverg: number }>,
  } = useQuery({
    queryKey: ["conf-stats", id, finalizadas.map((c) => c.id).join(",")],
    enabled: finalizadas.length > 0,
    queryFn: async () => {
      const ids = finalizadas.map((c) => c.id);
      const { data, error } = await db
        .from("conferencia_itens")
        .select("conferencia_id,status")
        .in("conferencia_id", ids);
      if (error) throw error;
      const out: Record<string, { total: number; conferidos: number; diverg: number }> = {};
      for (const cid of ids) out[cid] = { total: 0, conferidos: 0, diverg: 0 };
      for (const r of (data ?? []) as { conferencia_id: string; status: string }[]) {
        const s = out[r.conferencia_id];
        if (!s) continue;
        s.total++;
        if (r.status === "conferido") s.conferidos++;
        if (r.status === "divergencia") s.diverg++;
      }
      return out;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["itens", ativa?.id],
    enabled: !!ativa,
    queryFn: async () => {
      const { data, error } = await db
        .from("conferencia_itens")
        .select("*")
        .eq("conferencia_id", ativa!.id)
        .order("codigo");
      if (error) throw error;
      return ordenarPorLocacao(data as ItemConferencia[]);
    },
  });

  const { data: itensHistorico = [] } = useQuery({
    queryKey: ["itens", historicoAberto?.id],
    enabled: !!historicoAberto,
    queryFn: async () => {
      const { data, error } = await db
        .from("conferencia_itens")
        .select("*")
        .eq("conferencia_id", historicoAberto!.id)
        .order("codigo");
      if (error) throw error;
      return ordenarPorLocacao(data as ItemConferencia[]);
    },
  });

  const ocultarSistema = familia === "prateleira" && !!ativa;

  const resumo = useMemo(() => {
    const base = ativa ? itens : [];
    const conferidos = base.filter((i) => i.status === "conferido").length;
    const diverg = base.filter((i) => i.status === "divergencia").length;
    const total = ativa ? base.length : materiais.length;
    const feitos = conferidos + diverg;
    return {
      total,
      conferidos,
      diverg,
      pendentes: total - feitos,
      pct: total ? Math.round((feitos / total) * 100) : 0,
    };
  }, [ativa, itens, materiais]);

  function registrarHistoricoFim(status: "finalizada" | "cancelada" | "pausada") {
    if (!ativa) return;
    void fecharHistorico({
      conferenciaId: ativa.id,
      status,
      horaInicio: ativa.hora_inicio,
      horaFim: agoraLocalISO(),
      prevista: resumo.total,
      conferida: resumo.conferidos,
      divergencias: resumo.diverg,
    });
  }

  /** Contexto usado nas notificações automáticas por e-mail. */
  function ctxNotificacao(conferenciaId: string) {
    return {
      conferenciaId,
      unidadeId: id,
      local: unidade?.nome ?? null,
      frota: unidade?.frota ?? null,
      matricula: ativa?.codigo_almoxarife ?? unidade?.matricula ?? null,
      conferente: ativa?.conferente ?? ativa?.almoxarife ?? null,
      modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
      tipoConferencia: ativa?.tipo ?? unidade?.tipo ?? null,
    };
  }

  /** Notifica erros ocorridos durante a conferência. */
  function notificarErro(e: unknown, tela: string) {
    if (ativa) void registrarErroConferencia(ctxNotificacao(ativa.id), e, tela);
    toast.error(e instanceof Error ? e.message : "Erro inesperado");
  }

  const salvarMaterial = useMutation({
    mutationFn: async (m: Partial<Material>) => {
      const payload = {
        unidade_id: id,
        codigo: m.codigo ?? "—",
        descricao: m.descricao ?? "",
        quantidade_esperada: Number(m.quantidade_esperada) || 0,
        locacao: m.locacao ?? null,
        imagem_principal: m.imagem_principal ?? null,
      };
      const { error } = m.id
        ? await db.from("materiais").update(payload).eq("id", m.id)
        : await db.from("materiais").insert(payload);
      if (error)
        throw new Error(
          error.code === "23505"
            ? "Já existe um material com este código nesta lista."
            : error.message,
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["materiais", id] });
      setNovoMaterial(false);
      setMatForm({});
      toast.success("Material salvo");
      log("cadastro", "Material salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirMaterial = useMutation({
    mutationFn: async (mid: string) => {
      const { error } = await db.from("materiais").delete().eq("id", mid);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["materiais", id] });
      toast.success("Material excluído");
      log("exclusao", "Material excluído");
    },
  });

  async function importarMateriais(file: File) {
    let rows: Record<string, unknown>[];
    try {
      rows = await readSheet(file);
    } catch (e) {
      return toast.error(`Não foi possível ler a planilha: ${(e as Error).message}`);
    }
    if (!rows.length) return toast.error("Planilha vazia");
    const colQtd = acharColunaQuantidade(rows);
    if (!colQtd)
      return toast.error(
        "Não foi encontrada a coluna Quantidade Esperada na planilha. Importação cancelada.",
      );
    let ignorados = 0;
    const itensNovos = rows
      .map((r) => ({
        codigo: pick(r, ["codigo", "cod"]) || "—",
        descricao: pick(r, ["descricao", "material", "item"]),
        locacao: pick(r, ["locacao", "local", "endereco"]) || null,
        quantidade_esperada: toNumero(r[colQtd]),
      }))
      .filter((i) => {
        if (!i.descricao && i.codigo === "—") return false;
        if (i.quantidade_esperada === null) {
          ignorados++;
          return false;
        }
        return true;
      })
      .map((i) => ({ ...i, quantidade_esperada: i.quantidade_esperada as number }));
    if (!itensNovos.length) return toast.error("Planilha vazia ou colunas não reconhecidas");

    let res;
    try {
      res = await salvarMateriais(id, itensNovos);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    qc.invalidateQueries({ queryKey: ["materiais", id] });
    registrarAuditoria({
      tipo: "importacao",
      acao: "lista_importada",
      detalhe: `${res.inseridos} novos, ${res.atualizados} atualizados, ${res.mesclados} repetidos mesclados`,
      modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
      lista: unidade?.nome ?? null,
    });
    toast.success(
      `${res.inseridos} novo(s)` +
        (res.atualizados ? `, ${res.atualizados} atualizado(s)` : "") +
        (res.mesclados ? `, ${res.mesclados} repetido(s) mesclado(s)` : "") +
        (ignorados ? ` — ${ignorados} sem quantidade ignorada(s)` : ""),
    );
  }

  const iniciarConferencia = useMutation({
    mutationFn: async (): Promise<Conferencia | null> => {
      if (modoV2) {
        // V2: a conferência nasce no aparelho (evento CONFERENCE_CREATED) e vale offline.
        await modoV2.iniciar(startForm);
        return null;
      }
      if (!materiais.length) throw new Error("Cadastre materiais antes de iniciar");
      // Proteção contra clique duplo: se já existe conferência aberta nesta
      // lista, reaproveita em vez de criar uma duplicada.
      const { data: aberta } = await db
        .from("conferencias")
        .select("*")
        .eq("unidade_id", id)
        .in("status", ["em_andamento", "pausada"])
        .order("hora_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (aberta) return aberta as Conferencia;
      const { data, error } = await db
        .from("conferencias")
        .insert({
          unidade_id: id,

          tipo: unidade?.tipo ?? "caminhao",
          // Data e hora do dispositivo, no fuso local, no clique de "Iniciar".
          data: dataLocalISO(),
          hora_inicio: agoraLocalISO(),
          conferente: startForm.conferente ?? startForm.almoxarife ?? null,
          responsavel: startForm.responsavel ?? unidade?.gestor ?? null,
          almoxarife: startForm.almoxarife ?? null,
          codigo_almoxarife: startForm.codigo ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const conf = data as Conferencia;
      const { error: e2 } = await db.from("conferencia_itens").insert(
        materiais.map((m) => ({
          conferencia_id: conf.id,
          material_id: m.id,
          codigo: m.codigo,
          descricao: m.descricao,
          locacao: m.locacao,
          quantidade_esperada: m.quantidade_esperada,
        })),
      );
      if (e2) throw e2;
      return conf;
    },
    onSuccess: (conf: Conferencia | null) => {
      qc.invalidateQueries({ queryKey: ["conferencias", id] });
      setIniciar(false);
      setStartForm({});
      // V2: histórico operacional e avisos são feitos pelo servidor/motor.
      if (!conf) return;
      abrirHistorico({
        conferenciaId: conf.id,
        unidadeId: id,
        tipoUnidade: unidade?.tipo,
        lista: unidade?.nome ?? "",
        horaInicio: conf.hora_inicio,
        prevista: materiais.length,
      });
      registrarAuditoria({
        tipo: "operacao",
        acao: "conferencia_iniciada",
        detalhe: `Conferência iniciada com ${materiais.length} itens previstos`,
        modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
        lista: unidade?.nome ?? null,
      });
      // O aviso de início é enviado pelo servidor ao confirmar a conferência.
      toast.success("Conferência iniciada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelarConferencia = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("conferencias")
        .update({ status: "cancelada", hora_fim: agoraLocalISO() })
        .eq("id", ativa!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conferencias", id] });
      registrarHistoricoFim("cancelada");
      registrarAuditoria({
        tipo: "operacao",
        acao: "conferencia_cancelada",
        detalhe: "Conferência cancelada pelo usuário",
        modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
        lista: unidade?.nome ?? null,
      });
      toast.success("Conferência cancelada e registrada no histórico");
    },
  });

  const alternarPausa = useMutation({
    mutationFn: async () => {
      const novo = pausada ? "em_andamento" : "pausada";
      // A hora da pausa/retomada é a do aparelho (vale offline e na sincronização tardia);
      // o servidor a usa no cálculo do tempo pausado, com limites de segurança.
      const hora = agoraLocalISO();
      const { error } = await db
        .from("conferencias")
        .update(
          novo === "pausada"
            ? { status: novo, ultima_pausa: hora }
            : { status: novo, ultima_retomada: hora },
        )
        .eq("id", ativa!.id);
      if (error) throw error;
      return novo as "em_andamento" | "pausada";
    },
    onSuccess: (novo) => {
      qc.invalidateQueries({ queryKey: ["conferencias", id] });
      void fecharHistorico({
        conferenciaId: ativa!.id,
        status: novo,
        horaInicio: ativa!.hora_inicio,
        horaFim: null,
        prevista: resumo.total,
        conferida: resumo.conferidos,
        divergencias: resumo.diverg,
      });
      registrarAuditoria({
        tipo: "operacao",
        acao: novo === "pausada" ? "conferencia_pausada" : "conferencia_retomada",
        detalhe:
          novo === "pausada"
            ? `Conferência pausada com ${resumo.pct}% concluído`
            : "Conferência retomada pelo usuário",
        modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
        lista: unidade?.nome ?? null,
      });
      toast.success(novo === "pausada" ? "Conferência pausada" : "Conferência retomada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarItem = useMutation({
    mutationFn: async () => {
      if (pausada) throw new Error("Conferência pausada: retome para registrar contagens.");
      const item = itemAberto!;

      const qtd = contado === "" ? null : Number(contado.replace(",", "."));
      const status =
        qtd == null
          ? "pendente"
          : qtd === Number(item.quantidade_esperada)
            ? "conferido"
            : "divergencia";
      const { error } = await db
        .from("conferencia_itens")
        .update({
          quantidade_contada: qtd,
          observacoes: obsItem,
          fotos: fotosItem,
          status,
          updated_at: agoraLocalISO(),
        })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["itens", ativa?.id] });
      setItemAberto(null);
      toast.success("Salvo automaticamente");
    },
    onError: (e: Error) => notificarErro(e, "Salvar item conferido"),
  });

  const finalizarConferencia = useMutation({
    mutationFn: async () => {
      if (!assinatura) throw new Error("A assinatura do conferente é obrigatória");
      if (familia === "caixa" && !assinaturaGestor)
        throw new Error("A assinatura do gestor é obrigatória");
      const { data, error } = await db
        .from("conferencias")
        .update({
          conferente: fimForm.conferente ?? ativa?.conferente,
          responsavel: fimForm.responsavel ?? ativa?.responsavel,
          observacoes: fimForm.observacoes ?? null,
          assinatura,
          assinatura_gestor: assinaturaGestor,
          hora_fim: agoraLocalISO(),
          status: "finalizada",
        })
        .eq("id", ativa!.id)
        .select("tempo_trabalhado")
        .maybeSingle();
      if (error) throw error;
      return Number((data as { tempo_trabalhado: number | null } | null)?.tempo_trabalhado ?? 0);
    },
    onSuccess: (segundosLiquidos) => {

      qc.invalidateQueries({ queryKey: ["conferencias", id] });
      setFinalizar(false);
      setAssinatura(null);
      setAssinaturaGestor(null);
      setFimForm({});
      registrarHistoricoFim("finalizada");
      registrarAuditoria({
        tipo: "operacao",
        acao: "conferencia_finalizada",
        detalhe: `Finalizada com ${resumo.conferidos} corretos e ${resumo.diverg} divergências (${resumo.pct}%)`,
        modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
        lista: unidade?.nome ?? null,
      });
      // O aviso de conclusão (com o relatório) é enviado pelo servidor ao confirmar a
      // finalização no banco — mesmo que o aplicativo seja fechado logo em seguida.
      toast.success("Conferência finalizada e bloqueada");
    },
    onError: (e: Error) => notificarErro(e, "Finalizar conferência"),
  });

  /** Pesquisa no cadastro completo do sistema (todas as listas/unidades). */
  // A busca só vai ao servidor depois que o usuário para de digitar: evita uma
  // consulta pesada por tecla no cadastro completo de materiais.
  const [termoCadastro, setTermoCadastro] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTermoCadastro(buscaCadastro.trim()), 400);
    return () => clearTimeout(t);
  }, [buscaCadastro]);
  const { data: resultadosCadastro = [], isFetching: buscandoCadastro } = useQuery({
    queryKey: ["cadastro-materiais", termoCadastro],
    enabled: adicionarAberto && termoCadastro.length >= 2,
    queryFn: async () => {
      const alvo = termoCadastro.replace(/[%,]/g, " ");
      const { data, error } = await db
        .from("materiais")
        .select("*")
        .or(
          `codigo.ilike.%${alvo}%,descricao.ilike.%${alvo}%,funcionario_codigo.ilike.%${alvo}%`,
        )
        .limit(50);
      if (error) throw new Error(error.message);
      return ordenarPorLocacao(data as Material[]);
    },
  });

  /** Inclui um material (do cadastro ou informado manualmente) apenas na conferência atual. */
  const adicionarItem = useMutation({
    mutationFn: async ({
      material,
      codigo,
      descricao,
      motivo,
      quantidade,
    }: {
      material?: Material | null;
      codigo: string;
      descricao: string;
      motivo: string;
      quantidade: number;
    }) => {
      if (!ativa) throw new Error("Nenhuma conferência em andamento");
      const cod = codigo.trim();
      const desc = descricao.trim();
      if (!cod) throw new Error("Informe o código do material");
      if (!desc) throw new Error("Informe a descrição do material");
      if (!motivo.trim()) throw new Error("Informe o motivo da inclusão");
      if (!(quantidade > 0)) throw new Error("Informe a quantidade encontrada");
      const jaExiste = itens.some(
        (i) =>
          (material?.id && i.material_id === material.id) ||
          (!!i.codigo && normalize(i.codigo) === normalize(cod)),
      );
      if (jaExiste) throw new Error("Este material já faz parte desta conferência.");
      const ctx = await contextoUsuario();
      const agoraIso = agoraLocalISO();
      const esperada = material ? Number(material.quantidade_esperada) || 0 : 0;
      const { error } = await db.from("conferencia_itens").insert({
        conferencia_id: ativa.id,
        material_id: material?.id ?? null,
        codigo: cod,
        descricao: desc,
        locacao: material?.locacao ?? null,
        quantidade_esperada: esperada,
        quantidade_contada: quantidade,
        status: quantidade === esperada ? "conferido" : "divergencia",
        observacoes: material
          ? null
          : "Material encontrado na prateleira e ausente na lista original da conferência.",
        origem: ORIGEM_ADICIONADO,
        motivo_inclusao: motivo.trim(),
        incluido_por: ctx.userId,
        incluido_por_nome: ctx.nome ?? ctx.email,
        incluido_em: agoraIso,
      });
      if (error) throw new Error(error.message);
      return { codigo: cod, descricao: desc, quantidade, motivo: motivo.trim(), quem: ctx.nome ?? ctx.email, agoraIso };
    },
    onSuccess: ({ codigo, descricao, quantidade, motivo, quem, agoraIso }) => {
      qc.invalidateQueries({ queryKey: ["itens", ativa?.id] });
      void fecharHistorico({
        conferenciaId: ativa!.id,
        status: (ativa!.status as "em_andamento" | "pausada") ?? "em_andamento",
        horaInicio: ativa!.hora_inicio,
        horaFim: null,
        prevista: resumo.total + 1,
        conferida: resumo.conferidos,
        divergencias: resumo.diverg,
      });
      void registrarAuditoria({
        tipo: "operacao",
        acao: "material_adicionado_conferencia",
        detalhe: `${codigo} — ${descricao} | Qtd: ${quantidade} | Incluído manualmente por ${quem ?? "usuário"} em ${agoraIso}. Motivo: ${motivo}`,
        modulo: moduloPorTipo(unidade?.tipo)?.id ?? null,
        lista: unidade?.nome ?? null,
      });
      setAdicionarAberto(false);
      setSelecionado(null);
      setMotivoInclusao("");
      setBuscaCadastro("");
      setManCodigo("");
      setManDescricao("");
      setManQtd("1");
      toast.success("Material adicionado com sucesso à conferência.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Duplicidade e validação dos campos obrigatórios do diálogo de inclusão. */
  const duplicadoNaConferencia =
    !!manCodigo.trim() &&
    itens.some(
      (i) =>
        (selecionado?.id && i.material_id === selecionado.id) ||
        (!!i.codigo && normalize(i.codigo) === normalize(manCodigo)),
    );
  const qtdInclusao = Number(manQtd.replace(",", "."));
  const podeAdicionarItem =
    !!manCodigo.trim() &&
    !!manDescricao.trim() &&
    !!motivoInclusao.trim() &&
    Number.isFinite(qtdInclusao) &&
    qtdInclusao > 0 &&
    !duplicadoNaConferencia;


  const excluirConferencia = useMutation({
    mutationFn: async (cid: string) => {
      // Itens, pausas, histórico, notificações e e-mails saem em cascata.
      const { error } = await db.from("conferencias").delete().eq("id", cid);
      if (error) throw error;
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conferencias", id] });
      qc.invalidateQueries({ queryKey: ["conf-stats", id] });
      log("exclusao", "Histórico excluído");
      toast.success("Histórico excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function baixar(conf: Conferencia, formato: "pdf" | "excel") {
    const { data } = await db
      .from("conferencia_itens")
      .select("*")
      .eq("conferencia_id", conf.id)
      .order("codigo");
    const ctx = {
      unidadeNome: unidade?.nome ?? "",
      conf,
      itens: ordenarPorLocacao((data ?? []) as ItemConferencia[]),
    };
    if (formato === "pdf") exportPDF(ctx);
    else exportExcel(ctx);
    log("exportacao", `Relatório ${formato}`);
  }

  const listaItens = (ativa ? itens : []).filter((i) => {
    const okBusca =
      normalize(i.codigo).includes(normalize(busca)) ||
      normalize(i.descricao).includes(normalize(busca));
    const okFiltro =
      filtro === "todos" ||
      (filtro === "pendentes" && i.status === "pendente") ||
      (filtro === "conferidos" && i.status === "conferido") ||
      (filtro === "divergencias" && i.status === "divergencia");
    return okBusca && okFiltro;
  });

  const materiaisFiltrados = materiais.filter(
    (m) =>
      normalize(m.codigo).includes(normalize(busca)) ||
      normalize(m.descricao).includes(normalize(busca)),
  );

  if (acessoNegado) return <AcessoNegado />;
  // V2: conferência aberta no servidor que o aparelho ainda não recebeu — nunca usar a tela V1.
  if (modoV2 && ativa) return <>{modoV2.aguardando}</>;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Button asChild variant="ghost" size="icon">
            {moduloDinamico ? (
              <Link
                to="/m/$modulo"
                params={{
                  modulo: String((unidade as { modulo_id?: string | null }).modulo_id),
                }}
                aria-label="Voltar para a lista"
              >
                <ArrowLeft className="size-5" />
              </Link>
            ) : (
              <Link
                to={moduloPorTipo(unidade?.tipo)?.rota ?? "/menu"}
                aria-label="Voltar para a lista"
              >
                <ArrowLeft className="size-5" />
              </Link>
            )}
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{unidade?.nome ?? "..."}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {unidade?.placa || unidade?.matricula || unidade?.setor || ""}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["📦 Total", resumo.total],
            ["✅ Corretos", resumo.conferidos],
            ["⏳ Pendentes", resumo.pendentes],
            ["⚠️ Divergências", resumo.diverg],
          ].map(([label, valor]) => (
            <Card key={String(label)}>
              <CardContent className="p-3 text-center">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{valor}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Progress value={resumo.pct} className="h-3" />
          <span className="text-sm font-medium">{resumo.pct}%</span>
        </div>

        {ativa && (
          <Card>
            <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-3">
              <div>Data: {fmtDate(ativa.data)}</div>
              <div>Início: {fmtTime(ativa.hora_inicio)}</div>
              <div>Status: {pausada ? "pausada" : "em andamento"}</div>
              <div>
                Tempo trabalhado: {fmtDuracao(tempoTrabalhado(ativa, agora))}
                {pausada && " (congelado)"}
              </div>
              {pausada && <div>Em pausa há: {fmtDuracao(tempoEmPausa(ativa, agora))}</div>}
              <div>Conferente: {ativa.conferente ?? "—"}</div>
              <div>Responsável: {ativa.responsavel ?? "—"}</div>
              {ativa.almoxarife && <div>Almoxarife: {ativa.almoxarife}</div>}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {!ativa ? (
            <>
              <Button size="lg" className="gap-2" onClick={() => setIniciar(true)}>
                <Play className="size-5" /> Iniciar conferência
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="gap-2"
                onClick={() => setNovoMaterial(true)}
              >
                <Plus className="size-5" /> Inserir material
              </Button>
              <Button variant="secondary" size="lg" className="gap-2" asChild>
                <label>
                  <FileSpreadsheet className="size-5" /> Importar planilha
                  <input
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importarMateriais(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
              <Button
                variant={verHistorico ? "default" : "secondary"}
                size="lg"
                className="gap-2"
                onClick={() => setVerHistorico((v) => !v)}
              >
                <History className="size-5" /> Histórico
                {finalizadas.length > 0 && ` (${finalizadas.length})`}
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" disabled={pausada} onClick={() => setFinalizar(true)}>
                Finalizar conferência
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="gap-2"
                onClick={() => alternarPausa.mutate()}
              >
                {pausada ? <Play className="size-5" /> : <Pause className="size-5" />}
                {pausada ? "Retomar conferência" : "Pausar conferência"}
              </Button>

              <Button
                variant="secondary"
                size="lg"
                className="gap-2"
                disabled={pausada}
                onClick={() => setAdicionarAberto(true)}
              >
                <Plus className="size-5" /> Adicionar material à conferência
              </Button>

              <Button
                variant="outline"
                size="lg"
                className="gap-2 text-destructive"
                onClick={() => cancelarConferencia.mutate()}
              >
                <X className="size-5" /> Cancelar conferência
              </Button>
            </>
          )}
        </div>

        {verHistorico && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">
              Histórico de conferências {finalizadas.length > 0 && `(${finalizadas.length})`}
            </h2>
            {finalizadas.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma conferência registrada.</p>
            )}
            {finalizadas.map((c) => {
              const s = statsHist[c.id] ?? { total: 0, conferidos: 0, diverg: 0 };
              return (
                <Card key={c.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={c.status === "cancelada" ? "outline" : "default"}>
                        {c.status === "cancelada" ? "Cancelada" : "Finalizada"}
                      </Badge>
                      <span className="text-sm font-medium">{fmtDate(c.data)}</span>
                      <span className="text-sm text-muted-foreground">
                        {fmtTime(c.hora_inicio)} → {fmtTime(c.hora_fim)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Responsável: {c.responsavel ?? "—"} • Conferente:{" "}
                      {c.conferente ?? c.almoxarife ?? "—"}
                    </p>
                    <p className="text-sm">
                      {s.total} itens • {s.conferidos} corretos •{" "}
                      <span className="text-destructive">{s.diverg} divergências</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setHistoricoAberto(c)}>
                        Visualizar
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => baixar(c, "pdf")}
                      >
                        <FileDown className="size-4" /> PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => baixar(c, "excel")}
                      >
                        <FileSpreadsheet className="size-4" /> Excel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-destructive"
                        onClick={() => excluirConferencia.mutate(c.id)}
                      >
                        <Trash2 className="size-4" /> Excluir
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Pesquisar por código ou descrição"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {ativa && (
          <Tabs value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
            <TabsList className="w-full">
              <TabsTrigger value="todos" className="flex-1">
                Todos
              </TabsTrigger>
              <TabsTrigger value="pendentes" className="flex-1">
                Pendentes
              </TabsTrigger>
              <TabsTrigger value="conferidos" className="flex-1">
                Corretos
              </TabsTrigger>
              <TabsTrigger value="divergencias" className="flex-1">
                Divergências
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="space-y-2">
          {ativa
            ? listaItens.map((i) => (
                <button
                  key={i.id}
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary"
                  onClick={() => {
                    setItemAberto(i);
                    setContado(i.quantidade_contada == null ? "" : String(i.quantidade_contada));
                    setObsItem(i.observacoes ?? "");
                    setFotosItem(i.fotos ?? []);
                  }}
                >
                  <span
                    className={`size-3 shrink-0 rounded-full ${
                      i.status === "conferido"
                        ? "bg-emerald-500"
                        : i.status === "divergencia"
                          ? "bg-destructive"
                          : "bg-muted-foreground/40"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.descricao || "Sem descrição"}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.codigo} {i.locacao ? `• ${i.locacao}` : ""}
                    </p>
                    {foiAdicionadoNaConferencia(i) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {ORIGEM_ADICIONADO_LABEL}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          Incluído Manualmente
                        </Badge>
                      </div>
                    )}

                  </div>
                  <div className="text-right text-xs">
                    {!ocultarSistema && <p>Esperado: {Number(i.quantidade_esperada)}</p>}
                    <p className="font-semibold">Contado: {i.quantidade_contada ?? "—"}</p>
                  </div>
                </button>
              ))
            : materiaisFiltrados.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  {m.imagem_principal ? (
                    <img
                      src={m.imagem_principal}
                      alt={m.descricao}
                      loading="lazy"
                      className="size-12 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Camera className="size-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.descricao || "Sem descrição"}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.codigo} {m.locacao ? `• ${m.locacao}` : ""} • Qtd:{" "}
                      {Number(m.quantidade_esperada)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar material"
                    onClick={() => {
                      setMatForm(m);
                      setNovoMaterial(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Excluir material"
                    className="text-destructive"
                    onClick={() => excluirMaterial.mutate(m.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
          {!ativa && !materiaisFiltrados.length && (
            <p className="text-sm text-muted-foreground">Nenhum material cadastrado.</p>
          )}
        </div>

        <section className="space-y-2 pt-4">
          <h2 className="text-base font-semibold">Histórico de conferências</h2>
          {finalizadas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma conferência registrada.</p>
          )}
          {finalizadas.map((c) => {
            const s = statsHist[c.id] ?? { total: 0, conferidos: 0, diverg: 0 };
            return (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={c.status === "cancelada" ? "outline" : "default"}>
                      {c.status === "cancelada" ? "Cancelada" : "Finalizada"}
                    </Badge>
                    <span className="text-sm font-medium">{fmtDate(c.data)}</span>
                    <span className="text-sm text-muted-foreground">
                      {fmtTime(c.hora_inicio)} → {fmtTime(c.hora_fim)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Responsável: {c.responsavel ?? "—"} • Conferente:{" "}
                    {c.conferente ?? c.almoxarife ?? "—"}
                  </p>
                  <p className="text-sm">
                    {s.total} itens • {s.conferidos} corretos •{" "}
                    <span className="text-destructive">{s.diverg} divergências</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setHistoricoAberto(c)}>
                      Visualizar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1"
                      onClick={() => baixar(c, "pdf")}
                    >
                      <FileDown className="size-4" /> PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-1"
                      onClick={() => baixar(c, "excel")}
                    >
                      <FileSpreadsheet className="size-4" /> Excel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-destructive"
                      onClick={() => excluirConferencia.mutate(c.id)}
                    >
                      <Trash2 className="size-4" /> Excluir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      </main>

      <Dialog
        open={adicionarAberto}
        onOpenChange={(o) => {
          setAdicionarAberto(o);
          if (!o) {
            setSelecionado(null);
            setMotivoInclusao("");
            setManCodigo("");
            setManDescricao("");
            setManQtd("1");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar material à conferência</DialogTitle>
            <DialogDescription>
              Pesquise no cadastro completo do sistema por código, descrição ou código de barras. Se
              o material não estiver na lista, preencha os campos abaixo. A inclusão vale apenas para
              esta conferência.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 pl-9"
                autoFocus
                placeholder="Código, descrição ou código de barras"
                value={buscaCadastro}
                onChange={(e) => {
                  setBuscaCadastro(e.target.value);
                  setSelecionado(null);
                  setManCodigo(e.target.value.trim());
                }}
              />
            </div>

            {termoCadastro.length < 2 ? (
              <p className="text-sm text-muted-foreground">Digite ao menos 2 caracteres.</p>
            ) : buscandoCadastro ? (
              <p className="text-sm text-muted-foreground">Pesquisando…</p>
            ) : !resultadosCadastro.length ? (
              <p className="text-sm text-muted-foreground">
                Nenhum material encontrado no cadastro. Você pode incluir o material manualmente
                abaixo.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {resultadosCadastro.map((m) => {
                  const jaNaConferencia = itens.some(
                    (i) =>
                      i.material_id === m.id ||
                      (!!i.codigo && normalize(i.codigo) === normalize(m.codigo)),
                  );
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={jaNaConferencia}
                      onClick={() => {
                        if (jaNaConferencia) {
                          toast.error("Este material já faz parte desta conferência.");
                          return;
                        }
                        setSelecionado(m);
                        setManCodigo(m.codigo);
                        setManDescricao(m.descricao ?? "");
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                        selecionado?.id === m.id ? "border-primary bg-accent" : "bg-card"
                      } ${jaNaConferencia ? "opacity-60" : "hover:border-primary"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.descricao || "Sem descrição"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.codigo} {m.locacao ? `• ${m.locacao}` : ""} • Esperado:{" "}
                          {Number(m.quantidade_esperada)}
                        </p>
                      </div>
                      {jaNaConferencia && (
                        <Badge variant="outline" className="text-[10px]">
                          Já na conferência
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Código do material *</Label>
                <Input
                  value={manCodigo}
                  onChange={(e) => setManCodigo(e.target.value)}
                  placeholder="Código"
                />
              </div>
              <div>
                <Label>Quantidade encontrada *</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={manQtd}
                  onChange={(e) => setManQtd(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Descrição do material *</Label>
              <Input
                value={manDescricao}
                onChange={(e) => setManDescricao(e.target.value)}
                placeholder="Descrição do material encontrado"
              />
            </div>

            <div>
              <Label>Motivo da inclusão *</Label>
              <Textarea
                rows={3}
                value={motivoInclusao}
                onChange={(e) => setMotivoInclusao(e.target.value)}
                placeholder="Ex.: material encontrado na prateleira e ausente na lista importada"
              />
            </div>

            {duplicadoNaConferencia && (
              <p className="text-sm text-destructive">
                Este material já faz parte desta conferência.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdicionarAberto(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!podeAdicionarItem || adicionarItem.isPending}
              onClick={() =>
                adicionarItem.mutate({
                  material: selecionado,
                  codigo: manCodigo,
                  descricao: manDescricao,
                  motivo: motivoInclusao,
                  quantidade: Number(manQtd.replace(",", ".")),
                })
              }
            >
              Adicionar à conferência
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      <Dialog open={iniciar} onOpenChange={setIniciar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar conferência</DialogTitle>
            <DialogDescription>Informe os dados do responsável pela contagem.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {familia === "prateleira" ? (
              <>
                <div>
                  <Label>Nome do almoxarife</Label>
                  <Input
                    value={startForm.almoxarife ?? ""}
                    onChange={(e) => setStartForm({ ...startForm, almoxarife: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Código</Label>
                  <Input
                    value={startForm.codigo ?? ""}
                    onChange={(e) => setStartForm({ ...startForm, codigo: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label>Conferente</Label>
                  <Input
                    value={startForm.conferente ?? ""}
                    onChange={(e) => setStartForm({ ...startForm, conferente: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Responsável</Label>
                  <Input
                    value={startForm.responsavel ?? unidade?.gestor ?? ""}
                    onChange={(e) => setStartForm({ ...startForm, responsavel: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIniciar(false)}>
              Cancelar
            </Button>
            <Button
              disabled={iniciarConferencia.isPending}
              onClick={() => {
                if (iniciarConferencia.isPending) return;
                if (familia === "prateleira" && (!startForm.almoxarife || !startForm.codigo))
                  return toast.error("Informe o almoxarife e o código");
                iniciarConferencia.mutate();
              }}
            >
              {iniciarConferencia.isPending ? "Iniciando…" : "Iniciar"}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!itemAberto} onOpenChange={(o) => !o && setItemAberto(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{itemAberto?.descricao || "Material"}</DialogTitle>
            <DialogDescription>
              Código {itemAberto?.codigo}
              {!ocultarSistema && ` • Esperado: ${Number(itemAberto?.quantidade_esperada ?? 0)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {pausada && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                Conferência pausada — modo somente leitura. Retome a conferência para continuar
                contando.
              </div>
            )}
            <div>
              <Label>Quantidade encontrada</Label>
              <Input
                autoFocus={!pausada}
                readOnly={pausada}
                disabled={pausada}
                inputMode="decimal"
                className="h-14 text-2xl"
                value={contado}
                onChange={(e) => setContado(e.target.value)}
              />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea
                readOnly={pausada}
                disabled={pausada}
                value={obsItem}
                onChange={(e) => setObsItem(e.target.value)}
              />
            </div>
            {!ocultarSistema &&
              !pausada &&
              contado !== "" &&
              Number(contado.replace(",", ".")) !== Number(itemAberto?.quantidade_esperada) && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <p className="mb-2 text-sm">Divergência detectada. Deseja anexar fotos?</p>
                  <Button variant="secondary" size="sm" className="gap-2" asChild>
                    <label>
                      <ImagePlus className="size-4" /> Anexar fotos
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files ?? []);
                          const urls = await Promise.all(files.map((f) => compressImage(f, 700)));
                          setFotosItem([...fotosItem, ...urls]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </Button>
                </div>
              )}

            {fotosItem.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fotosItem.map((f, idx) => (
                  <img
                    key={idx}
                    src={f}
                    alt="Foto da divergência"
                    className="size-20 rounded-md object-cover"
                  />
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemAberto(null)}>
              {pausada ? "Fechar" : "Cancelar"}
            </Button>
            {!pausada && <Button onClick={() => salvarItem.mutate()}>Salvar</Button>}
          </DialogFooter>

        </DialogContent>
      </Dialog>

      <Dialog
        open={novoMaterial}
        onOpenChange={(o) => {
          setNovoMaterial(o);
          if (!o) setMatForm({});
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{matForm.id ? "Editar material" : "Inserir material"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Código</Label>
              <Input
                value={matForm.codigo ?? ""}
                onChange={(e) => setMatForm({ ...matForm, codigo: e.target.value })}
              />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input
                value={matForm.descricao ?? ""}
                onChange={(e) => setMatForm({ ...matForm, descricao: e.target.value })}
              />
            </div>
            <div>
              <Label>Quantidade esperada</Label>
              <Input
                inputMode="decimal"
                value={String(matForm.quantidade_esperada ?? "")}
                onChange={(e) =>
                  setMatForm({ ...matForm, quantidade_esperada: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label>Imagem</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = await compressImage(f);
                  setMatForm((prev) => ({ ...prev, imagem_principal: url }));
                }}
              />
              {matForm.imagem_principal && (
                <img
                  src={matForm.imagem_principal}
                  alt="Pré-visualização"
                  className="mt-2 size-24 rounded-md object-cover"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoMaterial(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarMaterial.mutate(matForm)}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={finalizar} onOpenChange={setFinalizar}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finalizar conferência</DialogTitle>
            <DialogDescription>
              {resumo.conferidos} corretos • {resumo.diverg} divergências • {resumo.pendentes}{" "}
              pendentes
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome do conferente</Label>
              <Input
                value={fimForm.conferente ?? ativa?.conferente ?? ""}
                onChange={(e) => setFimForm({ ...fimForm, conferente: e.target.value })}
              />
            </div>
            <div>
              <Label>{familia === "caixa" ? "Gestor responsável" : "Responsável"}</Label>
              <Input
                value={fimForm.responsavel ?? ativa?.responsavel ?? ""}
                onChange={(e) => setFimForm({ ...fimForm, responsavel: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Data: {fmtDate(agoraLocalISO())} • Hora: {fmtTime(agoraLocalISO())}
            </p>
            <div>
              <Label>Observações finais</Label>
              <Textarea
                value={fimForm.observacoes ?? ""}
                onChange={(e) => setFimForm({ ...fimForm, observacoes: e.target.value })}
              />
            </div>
            <SignaturePad label="Assinatura do conferente" onChange={setAssinatura} />
            {familia === "caixa" && (
              <SignaturePad
                label="Assinatura do gestor responsável"
                onChange={setAssinaturaGestor}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizar(false)}>
              Cancelar
            </Button>
            <Button onClick={() => finalizarConferencia.mutate()}>Assinar e finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historicoAberto} onOpenChange={(o) => !o && setHistoricoAberto(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conferência de {fmtDate(historicoAberto?.data)}</DialogTitle>
            <DialogDescription>
              Início {fmtTime(historicoAberto?.hora_inicio)} • Término{" "}
              {fmtTime(historicoAberto?.hora_fim)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {itensHistorico.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between rounded-lg border p-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.descricao}</p>
                  <p className="text-xs text-muted-foreground">{i.codigo}</p>
                </div>
                <div className="text-right text-xs">
                  <p>Esperado: {Number(i.quantidade_esperada)}</p>
                  <p>Contado: {i.quantidade_contada ?? "—"}</p>
                </div>
              </div>
            ))}
            {historicoAberto?.assinatura && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground">Assinatura do conferente</p>
                <img src={historicoAberto.assinatura} alt="Assinatura" className="h-24 bg-white" />
              </div>
            )}
            {historicoAberto?.assinatura_gestor && (
              <div>
                <p className="text-xs text-muted-foreground">Assinatura do gestor</p>
                <img
                  src={historicoAberto.assinatura_gestor}
                  alt="Assinatura do gestor"
                  className="h-24 bg-white"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
