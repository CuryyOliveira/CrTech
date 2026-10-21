import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  Crown,
  KeyRound,
  Lock,
  LockOpen,
  LogOut,
  PenLine,
  Plus,
  ShieldCheck,
  Trash2,
  History as HistoryIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SignaturePad } from "@/components/SignaturePad";
import { ehProprietario, PERFIS, type Perfil } from "@/lib/permissions";
import { usePermissoes } from "@/hooks/usePermissoes";
import { useSenhaCritica } from "@/components/SenhaCritica";
import {
  atualizarUsuario,
  criarUsuario,
  encerrarSessoes,
  excluirUsuario,
  licencasAssinatura,
  listarUsuarios,
  transferirPropriedade,
} from "@/lib/admin-users.functions";
import { registrarAuditoria, type AuditoriaRow } from "@/lib/audit";
import { compressImage, db, fmtDateTime } from "@/lib/app";
import { sessaoOnline, type SessaoRow } from "@/lib/cadastros";
import { PermissoesUsuario } from "@/components/admin/MatrizPermissoes";
import {
  EstadoVazio,
  MenuExportar,
  SkeletonLista,
  useConfirmacao,
} from "@/components/admin/ui-admin";
import { useBuscaLocal } from "@/components/admin/consulta";
import { useSetoresDisponiveis } from "@/hooks/useSetores";



type Usuario = {
  id: string;
  user_id: string;
  nome: string | null;
  perfil: Perfil;
  setor: string | null;
  bloqueado: boolean;
  email: string;
  foto_url: string | null;
  assinatura: string | null;
  ultimo_acesso: string | null;
  ultimo_login: string | null;
  created_at: string;
};

type Patch = {
  userId: string;
  nome?: string;
  perfil?: Perfil;
  setor?: string;
  bloqueado?: boolean;
  novaSenha?: string;
  fotoUrl?: string | null;
  assinatura?: string | null;
};

/** Gestão de usuários: dados, acesso, permissões, sessões e históricos. */
export function GestaoUsuarios() {
  return (
    <Tabs defaultValue="usuarios">
      <TabsList className="flex w-full flex-wrap">
        <TabsTrigger value="usuarios">Usuários</TabsTrigger>
        <TabsTrigger value="sessoes">Sessões ativas</TabsTrigger>
      </TabsList>
      <TabsContent value="usuarios" className="pt-4">
        <ListaUsuarios />
      </TabsContent>
      <TabsContent value="sessoes" className="pt-4">
        <SessoesAtivas />
      </TabsContent>
    </Tabs>
  );
}

function ListaUsuarios() {
  const qc = useQueryClient();
  const confirmacao = useConfirmacao();
  const senhaCritica = useSenhaCritica();
  const { perfil } = usePermissoes();
  const listar = useServerFn(listarUsuarios);
  const criar = useServerFn(criarUsuario);
  const atualizar = useServerFn(atualizarUsuario);
  const encerrar = useServerFn(encerrarSessoes);
  const excluir = useServerFn(excluirUsuario);
  const transferirFn = useServerFn(transferirPropriedade);
  const fotoInput = useRef<HTMLInputElement>(null);
  // Setores dinâmicos da empresa atual (a empresa legada mantém Agrícola/Indústria).
  const { opcoes: SETORES } = useSetoresDisponiveis();

  /** A conta do Proprietário só pode ser alterada pelo próprio Proprietário. */
  const protegido = (u: Usuario) => u.perfil === "proprietario" && !ehProprietario(perfil);


  const [novo, setNovo] = useState({
    nome: "",
    email: "",
    senha: "",
    perfil: "agricola" as Perfil,
    setor: "",
  });
  const [abrirNovo, setAbrirNovo] = useState(false);
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<{ usuario: Usuario; aba: string } | null>(null);
  const [assinando, setAssinando] = useState<Usuario | null>(null);
  const [alvoFoto, setAlvoFoto] = useState<Usuario | null>(null);
  const [senha, setSenha] = useState<{ usuario: Usuario; valor: string } | null>(null);
  const [transferir, setTransferir] = useState<{ usuario: Usuario; senha: string } | null>(null);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: () => listar() as Promise<Usuario[]>,
  });

  const { data: sessoes = [] } = useQuery({
    queryKey: ["sessoes-ativas"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("sessoes_usuario")
        .select("*")
        .order("ultimo_ping", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SessaoRow[];
    },
  });

  const online = useMemo(
    () => new Set(sessoes.filter((s) => sessaoOnline(s)).map((s) => s.user_id)),
    [sessoes],
  );

  const salvar = useMutation({
    mutationFn: (data: Patch) => atualizar({ data }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      void qc.invalidateQueries({ queryKey: ["perfil-atual"] });
      const alvo = usuarios.find((u) => u.user_id === vars.userId);
      const partes: string[] = [];
      if (vars.nome !== undefined) partes.push(`nome para "${vars.nome}"`);
      if (vars.perfil !== undefined) partes.push(`perfil para "${vars.perfil}"`);
      if (vars.setor !== undefined) partes.push(`setor para "${vars.setor}"`);
      if (vars.fotoUrl !== undefined) partes.push("foto atualizada");
      if (vars.assinatura !== undefined) partes.push("assinatura digital atualizada");
      if (vars.bloqueado !== undefined)
        partes.push(vars.bloqueado ? "usuário bloqueado" : "usuário desbloqueado");
      if (vars.novaSenha) partes.push("senha redefinida");
      void registrarAuditoria({
        tipo: "usuarios",
        acao: vars.novaSenha
          ? "senha_redefinida"
          : vars.bloqueado !== undefined
            ? vars.bloqueado
              ? "usuario_bloqueado"
              : "usuario_desbloqueado"
            : "usuario_atualizado",
        detalhe: `${alvo?.email ?? vars.userId}: ${partes.join(", ") || "alteração"}`,
        modulo: "ADMIN",
      });
      toast.success("Usuário atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cadastrar = useMutation({
    mutationFn: () =>
      criar({ data: { ...novo, setor: novo.setor || SETORES[0]?.valor || "" } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      setAbrirNovo(false);
      void registrarAuditoria({
        tipo: "usuarios",
        acao: "usuario_criado",
        detalhe: `Usuário ${novo.email} criado com perfil ${novo.perfil} e setor ${novo.setor}`,
        modulo: "ADMIN",
      });
      setNovo({ nome: "", email: "", senha: "", perfil: "agricola", setor: "" });
      toast.success("Usuário cadastrado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const logoutRemoto = useMutation({
    mutationFn: (u: Usuario) => encerrar({ data: { userId: u.user_id } }),
    onSuccess: (_r, u) => {
      void qc.invalidateQueries({ queryKey: ["sessoes-ativas"] });
      void registrarAuditoria({
        tipo: "usuarios",
        acao: "logout_remoto",
        detalhe: `Sessões de ${u.email} encerradas remotamente`,
        modulo: "ADMIN",
      });
      toast.success("Sessões encerradas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remover = useMutation({
    mutationFn: (u: Usuario) => excluir({ data: { userId: u.user_id } }),
    onSuccess: (_r, u) => {
      void qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      void qc.invalidateQueries({ queryKey: ["sessoes-ativas"] });
      void registrarAuditoria({
        tipo: "usuarios",
        acao: "usuario_excluido",
        detalhe: `Usuário ${u.email} excluído definitivamente`,
        modulo: "ADMIN",
      });
      toast.success("Usuário excluído.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transferirProp = useMutation({
    mutationFn: (p: { usuario: Usuario; senha: string }) =>
      transferirFn({ data: { userId: p.usuario.user_id, senha: p.senha } }),
    onSuccess: (_r, p) => {
      void qc.invalidateQueries({ queryKey: ["admin-usuarios"] });
      void qc.invalidateQueries({ queryKey: ["perfil-atual"] });
      void qc.invalidateQueries({ queryKey: ["governanca"] });
      setTransferir(null);
      void registrarAuditoria({
        tipo: "administracao",
        acao: "propriedade_transferida",
        detalhe: `Propriedade do sistema transferida para ${p.usuario.email}`,
        modulo: "ADMIN",
      });
      toast.success("Propriedade do sistema transferida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  async function enviarFoto(file: File, u: Usuario) {
    try {
      const dataUrl = await compressImage(file, 320);
      salvar.mutate({ userId: u.user_id, fotoUrl: dataUrl });
    } catch {
      toast.error("Não foi possível processar a imagem.");
    }
  }

  const filtrados = useBuscaLocal(usuarios, busca, (u) => [u.nome, u.email, u.perfil, u.setor]);

  const colunas = [
    { chave: "nome", titulo: "Nome", valor: (u: Usuario) => u.nome ?? "" },
    { chave: "email", titulo: "E-mail", valor: (u: Usuario) => u.email },
    { chave: "perfil", titulo: "Perfil", valor: (u: Usuario) => u.perfil },
    { chave: "setor", titulo: "Setor", valor: (u: Usuario) => u.setor ?? "" },
    {
      chave: "status",
      titulo: "Status",
      valor: (u: Usuario) => (online.has(u.user_id) ? "Online" : "Offline"),
    },
    {
      chave: "bloqueado",
      titulo: "Bloqueado",
      valor: (u: Usuario) => (u.bloqueado ? "Sim" : "Não"),
    },
    {
      chave: "ultimo",
      titulo: "Último acesso",
      valor: (u: Usuario) => fmtDateTime(u.ultimo_acesso ?? u.ultimo_login),
    },
  ];

  return (
    <div className="space-y-3">
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Pesquisar por nome, e-mail, perfil ou setor..."
        aria-label="Pesquisar usuários"
      />

      <PainelLicencas />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{filtrados.length} usuário(s)</p>
        <div className="flex gap-2">
          <MenuExportar
            titulo="Relatório de usuários"
            subtitulo={`${filtrados.length} usuário(s)`}
            colunas={colunas}
            linhas={filtrados}
          />
          <Dialog open={abrirNovo} onOpenChange={setAbrirNovo}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 size-4" /> Novo usuário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cadastrar usuário</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome</Label>
                  <Input
                    value={novo.nome}
                    onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                  />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    value={novo.email}
                    onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Senha</Label>
                  <Input
                    type="password"
                    value={novo.senha}
                    onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Perfil</Label>
                    <Select
                      value={novo.perfil}
                      onValueChange={(v) => setNovo({ ...novo, perfil: v as Perfil })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERFIS.map((p) => (
                          <SelectItem key={p.valor} value={p.valor}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Setor</Label>
                    <Select
                      value={novo.setor || (SETORES[0]?.valor ?? "")}
                      onValueChange={(v) => setNovo({ ...novo, setor: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SETORES.map((s) => (
                          <SelectItem key={s.valor} value={s.valor}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={cadastrar.isPending}
                  onClick={() => {
                    if (!novo.nome.trim() || !novo.email.trim() || novo.senha.length < 6)
                      return toast.error(
                        "Preencha nome, e-mail e senha com ao menos 6 caracteres.",
                      );
                    cadastrar.mutate();
                  }}
                >
                  Cadastrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <SkeletonLista />
      ) : !filtrados.length ? (
        <EstadoVazio
          titulo="Nenhum usuário encontrado"
          descricao="Ajuste a pesquisa ou cadastre um usuário."
        />
      ) : (
        <div className="space-y-3">
          {filtrados.map((u) => (
            <Card key={u.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  className="relative"
                  aria-label={`Alterar foto de ${u.nome ?? u.email}`}
                  onClick={() => {
                    setAlvoFoto(u);
                    fotoInput.current?.click();
                  }}
                >
                  <Avatar className="size-11">
                    {u.foto_url ? <AvatarImage src={u.foto_url} alt={u.nome ?? u.email} /> : null}
                    <AvatarFallback>{(u.nome ?? u.email).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1 text-primary-foreground">
                    <Camera className="size-3" />
                  </span>
                </button>

                <div className="min-w-[180px] flex-1">
                  <Input
                    defaultValue={u.nome ?? ""}
                    placeholder="Nome"
                    onBlur={(e) => {
                      const nome = e.target.value.trim();
                      if (nome && nome !== (u.nome ?? ""))
                        salvar.mutate({ userId: u.user_id, nome });
                    }}
                  />
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {u.email} · último acesso {fmtDateTime(u.ultimo_acesso ?? u.ultimo_login)}
                  </p>
                </div>

                <Badge
                  className={
                    online.has(u.user_id)
                      ? "bg-emerald-600 text-white hover:bg-emerald-600"
                      : undefined
                  }
                  variant={online.has(u.user_id) ? "default" : "secondary"}
                >
                  {online.has(u.user_id) ? "Online" : "Offline"}
                </Badge>

                {u.perfil === "proprietario" ? (
                  <Badge className="bg-amber-500 text-black hover:bg-amber-500">
                    <Crown className="mr-1 size-3.5" /> PROPRIETÁRIO
                  </Badge>
                ) : (
                  <Select
                    value={u.perfil}
                    onValueChange={(v) => salvar.mutate({ userId: u.user_id, perfil: v as Perfil })}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERFIS.map((p) => (
                        <SelectItem key={p.valor} value={p.valor}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}


                <Select
                  value={u.setor ?? (SETORES[0]?.valor ?? "")}
                  onValueChange={(v) => salvar.mutate({ userId: u.user_id, setor: v })}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETORES.map((s) => (
                      <SelectItem key={s.valor} value={s.valor}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {u.bloqueado && <Badge variant="destructive">Bloqueado</Badge>}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={protegido(u)}
                    aria-label={u.bloqueado ? "Desbloquear usuário" : "Bloquear usuário"}
                    onClick={() =>
                      confirmacao.pedir(
                        u.bloqueado ? "Desbloquear usuário?" : "Bloquear usuário?",
                        u.bloqueado
                          ? `${u.email} poderá acessar o sistema novamente.`
                          : `${u.email} perderá o acesso e suas sessões serão encerradas.`,
                        () => salvar.mutate({ userId: u.user_id, bloqueado: !u.bloqueado }),
                      )
                    }
                  >
                    {u.bloqueado ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={protegido(u)}
                    aria-label="Redefinir senha"
                    onClick={() => setSenha({ usuario: u, valor: "" })}
                  >
                    <KeyRound className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={protegido(u)}
                    aria-label="Assinatura digital"
                    onClick={() => setAssinando(u)}
                  >
                    <PenLine className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={protegido(u)}
                    aria-label="Permissões individuais"
                    onClick={() => setDetalhe({ usuario: u, aba: "permissoes" })}
                  >
                    <ShieldCheck className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Históricos do usuário"
                    onClick={() => setDetalhe({ usuario: u, aba: "acessos" })}
                  >
                    <HistoryIcon className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={protegido(u)}
                    aria-label="Logout remoto"
                    onClick={() =>
                      confirmacao.pedir(
                        "Encerrar sessões?",
                        `Todas as sessões abertas de ${u.email} serão encerradas.`,
                        () => logoutRemoto.mutate(u),
                      )
                    }
                  >
                    <LogOut className="size-4" />
                  </Button>
                  {ehProprietario(perfil) && u.perfil !== "proprietario" && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-amber-600 hover:text-amber-600"
                      aria-label="Transferir propriedade do sistema"
                      onClick={() => setTransferir({ usuario: u, senha: "" })}
                    >
                      <Crown className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    disabled={protegido(u)}
                    aria-label="Excluir usuário"
                    onClick={() =>
                      senhaCritica.pedir({
                        acao: "excluir_usuario",
                        titulo: "Excluir usuário?",
                        descricao: `${u.email} será removido definitivamente e perderá o acesso ao sistema. Confirme sua senha para continuar.`,
                        executar: () => remover.mutate(u),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <input
        ref={fotoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && alvoFoto) void enviarFoto(file, alvoFoto);
          e.target.value = "";
        }}
      />

      <Dialog open={!!senha} onOpenChange={(v) => !v && setSenha(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
          </DialogHeader>
          {senha && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{senha.usuario.email}</p>
              <div>
                <Label>Nova senha</Label>
                <Input
                  type="password"
                  value={senha.valor}
                  onChange={(e) => setSenha({ ...senha, valor: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  if (senha.valor.length < 6)
                    return toast.error("A senha deve ter ao menos 6 caracteres.");
                  salvar.mutate({ userId: senha.usuario.user_id, novaSenha: senha.valor });
                  setSenha(null);
                }}
              >
                Redefinir
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!assinando} onOpenChange={(v) => !v && setAssinando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinatura digital</DialogTitle>
          </DialogHeader>
          {assinando && (
            <div className="space-y-3">
              {assinando.assinatura && (
                <img
                  src={assinando.assinatura}
                  alt={`Assinatura atual de ${assinando.nome ?? assinando.email}`}
                  className="h-24 w-full rounded-lg border object-contain"
                />
              )}
              <SignaturePad
                label={`Assinatura de ${assinando.nome ?? assinando.email}`}
                onChange={(dataUrl) =>
                  salvar.mutate({ userId: assinando.user_id, assinatura: dataUrl })
                }
              />
              <p className="text-xs text-muted-foreground">
                A assinatura é salva automaticamente ao concluir o traçado.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{detalhe?.usuario.nome ?? detalhe?.usuario.email}</SheetTitle>
          </SheetHeader>
          {detalhe && (
            <Tabs defaultValue={detalhe.aba} className="mt-4">
              <TabsList className="flex w-full flex-wrap">
                <TabsTrigger value="permissoes">Permissões</TabsTrigger>
                <TabsTrigger value="acessos">Acessos</TabsTrigger>
                <TabsTrigger value="alteracoes">Alterações</TabsTrigger>
                <TabsTrigger value="sessoes">Sessões</TabsTrigger>
              </TabsList>
              <TabsContent value="permissoes" className="pt-4">
                <PermissoesUsuario
                  userId={detalhe.usuario.user_id}
                  nome={detalhe.usuario.nome ?? detalhe.usuario.email}
                />
              </TabsContent>
              <TabsContent value="acessos" className="pt-4">
                <HistoricoEventos userId={detalhe.usuario.user_id} tipos={["autenticacao"]} />
              </TabsContent>
              <TabsContent value="alteracoes" className="pt-4">
                <HistoricoEventos
                  userId={detalhe.usuario.user_id}
                  tipos={["usuarios", "administracao"]}
                  email={detalhe.usuario.email}
                />
              </TabsContent>
              <TabsContent value="sessoes" className="pt-4">
                <SessoesDoUsuario
                  sessoes={sessoes.filter((s) => s.user_id === detalhe.usuario.user_id)}
                  onEncerrar={() => logoutRemoto.mutate(detalhe.usuario)}
                />
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!transferir} onOpenChange={(v) => !v && setTransferir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="size-5 text-amber-500" /> Transferir propriedade do sistema
            </DialogTitle>
          </DialogHeader>
          {transferir && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {transferir.usuario.nome ?? transferir.usuario.email} passará a ser o{" "}
                <strong>Proprietário do Sistema</strong> e você será rebaixado para Administrador.
                Esta ação é registrada em auditoria e não pode ser desfeita sem uma nova
                transferência.
              </p>
              <div className="space-y-1">
                <Label>Confirme a sua senha</Label>
                <Input
                  type="password"
                  value={transferir.senha}
                  onChange={(e) => setTransferir({ ...transferir, senha: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                disabled={transferirProp.isPending}
                onClick={() => {
                  if (!transferir.senha) return toast.error("Informe a sua senha.");
                  transferirProp.mutate(transferir);
                }}
              >
                Transferir propriedade
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {senhaCritica.elemento}
      {confirmacao.elemento}

    </div>
  );
}

/** Histórico de acessos e de alterações do usuário, lido do Log de Auditoria. */
function HistoricoEventos({
  userId,
  tipos,
  email,
}: {
  userId: string;
  tipos: string[];
  email?: string;
}) {
  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["auditoria-usuario", userId, tipos.join(","), email ?? ""],
    queryFn: async () => {
      const { data, error } = await db
        .from("auditoria")
        .select("*")
        .in("tipo_acao", tipos)
        .order("created_at", { ascending: false })
        .range(0, 499);
      if (error) throw new Error(error.message);
      return ((data ?? []) as AuditoriaRow[]).filter(
        (a: any) =>
          a.user_id === userId ||
          (email && String(a.detalhe ?? "").includes(email)) ||
          a.usuario === email,
      );
    },
  });

  if (isLoading) return <SkeletonLista linhas={3} />;
  if (!eventos.length)
    return <EstadoVazio titulo="Nenhum registro" descricao="Sem eventos registrados." />;

  return (
    <div className="space-y-2">
      {eventos.map((e: any) => (
        <Card key={e.id}>
          <CardContent className="space-y-1 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{e.acao}</Badge>
              <span className="text-xs text-muted-foreground">{fmtDateTime(e.created_at)}</span>
              {e.resultado !== "sucesso" && <Badge variant="destructive">{e.resultado}</Badge>}
            </div>
            {e.detalhe && <p className="text-sm">{e.detalhe}</p>}
            <p className="text-xs text-muted-foreground">
              IP: {e.ip ?? "—"} · Dispositivo: {e.dispositivo ?? "—"} · Módulo: {e.modulo ?? "—"}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SessoesDoUsuario({
  sessoes,
  onEncerrar,
}: {
  sessoes: SessaoRow[];
  onEncerrar: () => void;
}) {
  if (!sessoes.length)
    return (
      <EstadoVazio
        titulo="Nenhuma sessão registrada"
        descricao="O usuário ainda não acessou o sistema."
      />
    );
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={onEncerrar}>
        <LogOut className="mr-1 size-4" /> Encerrar todas as sessões
      </Button>
      {sessoes.map((s) => (
        <Card key={s.id}>
          <CardContent className="space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge
                variant={sessaoOnline(s) ? "default" : "secondary"}
                className={
                  sessaoOnline(s) ? "bg-emerald-600 text-white hover:bg-emerald-600" : undefined
                }
              >
                {sessaoOnline(s) ? "Online" : "Encerrada"}
              </Badge>
              <span>
                {s.dispositivo ?? "—"} · {s.navegador ?? "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              IP {s.ip ?? "—"} · início {fmtDateTime(s.iniciada_em)} · último sinal{" "}
              {fmtDateTime(s.ultimo_ping)}
              {s.encerrada_em
                ? ` · encerrada em ${fmtDateTime(s.encerrada_em)} (${s.motivo_encerramento ?? "—"})`
                : ""}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Painel de sessões ativas de todos os usuários, com logout remoto individual. */
function SessoesAtivas() {
  const qc = useQueryClient();
  const encerrar = useServerFn(encerrarSessoes);
  const listar = useServerFn(listarUsuarios);

  const { data: usuarios = [] } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: () => listar() as Promise<Usuario[]>,
  });

  const { data: sessoes = [], isLoading } = useQuery({
    queryKey: ["sessoes-ativas"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("sessoes_usuario")
        .select("*")
        .order("ultimo_ping", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SessaoRow[];
    },
  });

  const encerrarUma = useMutation({
    mutationFn: (s: SessaoRow) => encerrar({ data: { userId: s.user_id, sessaoId: s.id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessoes-ativas"] });
      void registrarAuditoria({
        tipo: "usuarios",
        acao: "logout_remoto",
        detalhe: "Sessão encerrada remotamente",
        modulo: "ADMIN",
      });
      toast.success("Sessão encerrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nome = (id: string) =>
    usuarios.find((u) => u.user_id === id)?.nome ??
    usuarios.find((u) => u.user_id === id)?.email ??
    id.slice(0, 8);
  const ativas = sessoes.filter((s) => !s.encerrada_em);

  const colunas = [
    { chave: "usuario", titulo: "Usuário", valor: (s: SessaoRow) => nome(s.user_id) },
    { chave: "dispositivo", titulo: "Dispositivo", valor: (s: SessaoRow) => s.dispositivo ?? "" },
    { chave: "navegador", titulo: "Navegador", valor: (s: SessaoRow) => s.navegador ?? "" },
    { chave: "ip", titulo: "IP", valor: (s: SessaoRow) => s.ip ?? "" },
    { chave: "inicio", titulo: "Início", valor: (s: SessaoRow) => fmtDateTime(s.iniciada_em) },
    { chave: "ping", titulo: "Último sinal", valor: (s: SessaoRow) => fmtDateTime(s.ultimo_ping) },
    {
      chave: "status",
      titulo: "Status",
      valor: (s: SessaoRow) => (sessaoOnline(s) ? "Online" : "Offline"),
    },
  ];

  if (isLoading) return <SkeletonLista />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{ativas.length} sessão(ões) aberta(s)</p>
        <MenuExportar
          titulo="Sessões ativas"
          subtitulo={`${ativas.length} sessão(ões)`}
          colunas={colunas}
          linhas={ativas}
        />
      </div>
      {!ativas.length ? (
        <EstadoVazio
          titulo="Nenhuma sessão aberta"
          descricao="Nenhum usuário conectado no momento."
        />
      ) : (
        <div className="space-y-2">
          {ativas.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-[180px] flex-1">
                  <p className="font-semibold">{nome(s.user_id)}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.dispositivo ?? "—"} · {s.navegador ?? "—"} · IP {s.ip ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Início {fmtDateTime(s.iniciada_em)} · último sinal {fmtDateTime(s.ultimo_ping)}
                  </p>
                </div>
                <Badge
                  variant={sessaoOnline(s) ? "default" : "secondary"}
                  className={
                    sessaoOnline(s) ? "bg-emerald-600 text-white hover:bg-emerald-600" : undefined
                  }
                >
                  {sessaoOnline(s) ? "Online" : "Offline"}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => encerrarUma.mutate(s)}>
                  <LogOut className="mr-1 size-4" /> Encerrar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mostra quantos acessos o plano contratado libera e quantos já estão em uso. */
function PainelLicencas() {
  const consultar = useServerFn(licencasAssinatura);
  const { data } = useQuery({ queryKey: ["licencas-assinatura"], queryFn: () => consultar({}) });
  if (!data) return null;

  const limite = data.limite;
  const esgotado = limite != null && data.usados >= limite;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Usuários com acesso ao sistema</p>
          <p className="text-xs text-muted-foreground">
            {limite == null
              ? "Nenhum plano ativo: defina a assinatura para liberar acessos."
              : `${data.usados} de ${limite} acessos usados no plano ${data.planoCodigo ?? ""}`.trim()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={esgotado ? "destructive" : "secondary"}>
            {limite == null ? "Sem plano" : esgotado ? "Limite atingido" : `${data.disponiveis} disponível(is)`}
          </Badge>
          <Button size="sm" variant="outline" asChild>
            <Link to="/planos">Planos</Link>
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Cada usuário desbloqueado consome um acesso do plano. Bloqueie um usuário para liberar
        acesso a outro, ou faça upgrade para um plano com mais usuários.
      </p>
    </div>
  );
}
