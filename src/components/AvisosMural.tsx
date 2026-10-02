import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { db, fmtDateTime } from "@/lib/app";
import { AVISO_CATEGORIAS, type AvisoRow } from "@/lib/cadastros";
import { usePermissoes } from "@/hooks/usePermissoes";

const CORES: Record<AvisoRow["prioridade"], string> = {
  info: "bg-sky-600 text-white hover:bg-sky-600",
  aviso: "bg-amber-500 text-white hover:bg-amber-500",
  atencao: "bg-orange-600 text-white hover:bg-orange-600",
  critica: "bg-destructive text-destructive-foreground hover:bg-destructive",
};

/** Mural de avisos publicados pelos administradores, com confirmação de leitura. */
export function AvisosMural() {
  const qc = useQueryClient();
  const { perfil, setor } = usePermissoes();

  const { data: userId } = useQuery({
    queryKey: ["user-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const { data: avisos = [] } = useQuery({
    queryKey: ["avisos-mural"],
    queryFn: async () => {
      const { data, error } = await db
        .from("avisos_sistema")
        .select("*")
        .eq("publicado", true)
        .eq("arquivado", false)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AvisoRow[];
    },
  });

  const { data: leituras = [] } = useQuery({
    enabled: !!userId,
    queryKey: ["aviso-leituras", userId],
    queryFn: async () => {
      const { data, error } = await db
        .from("aviso_leituras")
        .select("aviso_id")
        .eq("user_id", userId!);
      if (error) throw new Error(error.message);
      return ((data ?? []) as { aviso_id: string }[]).map((l) => l.aviso_id);
    },
  });

  const confirmar = useMutation({
    mutationFn: async (aviso: AvisoRow) => {
      const { error } = await db
        .from("aviso_leituras")
        .upsert({ aviso_id: aviso.id, user_id: userId! }, { onConflict: "aviso_id,user_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["aviso-leituras"] });
      toast.success("Leitura confirmada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const visiveis = useMemo(() => {
    const agora = Date.now();
    return avisos.filter(
      (a) =>
        !leituras.includes(a.id) &&
        (!a.agendado_para || new Date(a.agendado_para).getTime() <= agora) &&
        (!a.destino_perfil || a.destino_perfil === perfil) &&
        (!a.destino_setor || a.destino_setor === setor),
    );
  }, [avisos, leituras, perfil, setor]);

  if (!visiveis.length) return null;

  return (
    <div className="space-y-2">
      {visiveis.map((a) => (
        <Card key={a.id} className="border-primary/30">
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <BellRing className="mt-0.5 size-5 text-primary" />
            <div className="min-w-[200px] flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{a.titulo}</p>
                <Badge className={CORES[a.prioridade]}>{a.prioridade}</Badge>
                <Badge variant="outline">
                  {AVISO_CATEGORIAS.find((c) => c.valor === a.categoria)?.label ?? a.categoria}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{a.mensagem}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!userId}
              onClick={() => confirmar.mutate(a)}
            >
              <Check className="mr-1 size-4" />
              {a.exige_confirmacao ? "Confirmar leitura" : "Marcar como lido"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
