import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/app";
import { registrarAuditoria } from "@/lib/audit";
import { ACOES, type Acao, type PermissaoPerfilRow, type PermissaoUsuarioRow } from "@/lib/cadastros";
import { MODULOS, PERFIS } from "@/lib/permissions";
import { MenuExportar, SkeletonLista } from "@/components/admin/ui-admin";

const MODULOS_MATRIZ = [...MODULOS.map((m) => ({ id: m.id, titulo: m.titulo })), { id: "ADMIN", titulo: "Central Administrativa" }];

type Mapa = Record<string, Acao[]>;

/** Matriz completa de permissões por perfil e por módulo. */
export function MatrizPermissoes() {
  return (
    <Tabs defaultValue={PERFIS[0]!.valor}>
      <TabsList className="flex w-full flex-wrap">
        {PERFIS.map((p) => (
          <TabsTrigger key={p.valor} value={p.valor}>
            {p.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {PERFIS.map((p) => (
        <TabsContent key={p.valor} value={p.valor} className="pt-4">
          <MatrizPerfil perfil={p.valor} label={p.label} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function MatrizPerfil({ perfil, label }: { perfil: string; label: string }) {
  const qc = useQueryClient();
  const [mapa, setMapa] = useState<Mapa>({});

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["permissoes-perfil", perfil],
    queryFn: async () => {
      const { data, error } = await db.from("permissoes_perfil").select("*").eq("perfil", perfil);
      if (error) throw new Error(error.message);
      return (data ?? []) as PermissaoPerfilRow[];
    },
  });

  useEffect(() => {
    setMapa(Object.fromEntries(linhas.map((l) => [l.modulo, l.acoes ?? []])));
  }, [linhas]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const registros = MODULOS_MATRIZ.map((m) => ({
        perfil,
        modulo: m.id,
        acoes: mapa[m.id] ?? [],
        updated_by: auth.user?.id ?? null,
      }));
      const { error } = await db
        .from("permissoes_perfil")
        .upsert(registros, { onConflict: "perfil,modulo" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["permissoes-perfil", perfil] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "permissoes_alteradas",
        detalhe: `Matriz de permissões do perfil ${label} atualizada`,
        modulo: "ADMIN",
      });
      toast.success("Permissões salvas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const colunas = useMemo(
    () => [
      { chave: "modulo", titulo: "Módulo", valor: (m: { id: string; titulo: string }) => m.titulo },
      ...ACOES.map((a) => ({
        chave: a.valor,
        titulo: a.label,
        valor: (m: { id: string }) => ((mapa[m.id] ?? []).includes(a.valor) ? "Sim" : "Não"),
      })),
    ],
    [mapa],
  );

  if (isLoading) return <SkeletonLista linhas={3} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Defina as ações permitidas ao perfil <strong>{label}</strong> em cada módulo.
        </p>
        <div className="flex gap-2">
          <MenuExportar
            titulo={`Permissões — ${label}`}
            subtitulo={`Matriz de permissões do perfil ${label}`}
            colunas={colunas}
            linhas={MODULOS_MATRIZ}
          />
          <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            <Save className="mr-1 size-4" /> Salvar
          </Button>
        </div>
      </div>
      <MatrizGrade mapa={mapa} onMapa={setMapa} />
    </div>
  );
}

/** Grade reutilizável de módulos x ações. */
export function MatrizGrade({ mapa, onMapa }: { mapa: Mapa; onMapa: (m: Mapa) => void }) {
  function alternar(modulo: string, acao: Acao, marcado: boolean) {
    const atuais = new Set(mapa[modulo] ?? []);
    if (marcado) atuais.add(acao);
    else atuais.delete(acao);
    onMapa({ ...mapa, [modulo]: [...atuais] as Acao[] });
  }

  return (
    <div className="space-y-2">
      {MODULOS_MATRIZ.map((m) => (
        <Card key={m.id}>
          <CardContent className="space-y-2 p-4">
            <p className="font-semibold">{m.titulo}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACOES.map((a) => {
                const id = `${m.id}-${a.valor}`;
                return (
                  <div key={a.valor} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={(mapa[m.id] ?? []).includes(a.valor)}
                      onCheckedChange={(v) => alternar(m.id, a.valor, v === true)}
                    />
                    <Label htmlFor={id} className="text-sm font-normal">
                      {a.label}
                    </Label>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Permissões individuais que complementam as do perfil do usuário. */
export function PermissoesUsuario({ userId, nome }: { userId: string; nome: string }) {
  const qc = useQueryClient();
  const [mapa, setMapa] = useState<Mapa>({});

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["permissoes-usuario", userId],
    queryFn: async () => {
      const { data, error } = await db.from("permissoes_usuario").select("*").eq("user_id", userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as PermissaoUsuarioRow[];
    },
  });

  useEffect(() => {
    setMapa(Object.fromEntries(linhas.map((l) => [l.modulo, l.acoes ?? []])));
  }, [linhas]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const registros = MODULOS_MATRIZ.map((m) => ({
        user_id: userId,
        modulo: m.id,
        acoes: mapa[m.id] ?? [],
        updated_by: auth.user?.id ?? null,
      }));
      const { error } = await db
        .from("permissoes_usuario")
        .upsert(registros, { onConflict: "user_id,modulo" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["permissoes-usuario", userId] });
      void registrarAuditoria({
        tipo: "administracao",
        acao: "permissoes_alteradas",
        detalhe: `Permissões individuais de ${nome} atualizadas`,
        modulo: "ADMIN",
      });
      toast.success("Permissões individuais salvas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <SkeletonLista linhas={2} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        As permissões individuais complementam as permissões do perfil de {nome}.
      </p>
      <MatrizGrade mapa={mapa} onMapa={setMapa} />
      <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
        <Save className="mr-1 size-4" /> Salvar permissões
      </Button>
    </div>
  );
}
