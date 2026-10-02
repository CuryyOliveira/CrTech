/**
 * Monitor automático: notifica conferências abertas há mais de 30 minutos.
 * Chamado periodicamente pelo agendador do banco (uma notificação por
 * conferência, até que ela seja encerrada).
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  dataHoraLocal,
  fmtDuracao,
  MINUTOS_ATRASO,
  tipoInfo,
} from "@/lib/notificacoes-conferencia";

type Conf = {
  id: string;
  unidade_id: string;
  hora_inicio: string;
  status: string;
  conferente: string | null;
  created_by: string | null;
  tipo: string | null;
  total_tempo_pausado: number | null;
  ultima_pausa: string | null;
  tempo_trabalhado: number | null;
};

/** Tempo efetivamente trabalhado (segundos), descontando todas as pausas. */
function trabalhado(c: Conf, agora = Date.now()) {
  const inicio = new Date(c.hora_inicio).getTime();
  const pausado = Number(c.total_tempo_pausado ?? 0);
  if (c.status === "pausada") {
    if (c.ultima_pausa) {
      return Math.max(0, Math.round((new Date(c.ultima_pausa).getTime() - inicio) / 1000) - pausado);
    }
    if (c.tempo_trabalhado != null) return Math.max(0, Number(c.tempo_trabalhado));
  }
  return Math.max(0, Math.round((agora - inicio) / 1000) - pausado);
}


export const Route = createFileRoute("/api/public/hooks/monitor-conferencias")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const chave = (request.headers.get("x-hook-secret") ?? "").trim();
        if (!chave) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabaseAdmin as unknown as { from: (t: string) => any; rpc: (n: string, a: any) => any };

        // Segredo exclusivo do agendador, guardado apenas no servidor/banco.
        const segredoEnv = process.env["MONITOR_HOOK_SECRET"];
        let autorizado = !!segredoEnv && chave === segredoEnv;
        if (!autorizado) {
          const { data } = await sb.rpc("validar_hook", {
            _nome: "monitor_conferencias",
            _valor: chave,
          });
          autorizado = data === true;
        }
        if (!autorizado) return new Response("Unauthorized", { status: 401 });
        const limite = new Date(Date.now() - MINUTOS_ATRASO * 60_000).toISOString();

        const { data: abertas } = await sb
          .from("conferencias")
          .select("id, unidade_id, hora_inicio, status, conferente, created_by, tipo, total_tempo_pausado, ultima_pausa, tempo_trabalhado")
          .in("status", ["em_andamento", "pausada"])
          .lt("hora_inicio", limite)
          .limit(200);

        // Só conta o tempo efetivamente trabalhado: pausas não geram atraso.
        const lista = ((abertas ?? []) as Conf[]).filter(
          (c) => trabalhado(c) >= MINUTOS_ATRASO * 60,
        );
        if (!lista.length) return Response.json({ ok: true, notificadas: 0 });

        const { data: existentes } = await sb
          .from("notificacoes_conferencia")
          .select("conferencia_id")
          .eq("tipo", "conferencia_atrasada")
          .in(
            "conferencia_id",
            lista.map((c) => c.id),
          );
        const jaNotificadas = new Set(
          ((existentes ?? []) as { conferencia_id: string }[]).map((r) => r.conferencia_id),
        );

        const info = tipoInfo("conferencia_atrasada");
        const criadas: string[] = [];

        for (const c of lista) {
          if (jaNotificadas.has(c.id) || !c.created_by) continue;
          const { data: uni } = await sb
            .from("unidades")
            .select("nome, frota, matricula, tipo")
            .eq("id", c.unidade_id)
            .maybeSingle();
          const u = (uni ?? {}) as {
            nome?: string;
            frota?: string;
            matricula?: string;
            tipo?: string;
          };
          const inicio = new Date(c.hora_inicio);
          const { data, hora } = dataHoraLocal(inicio);
          const aberto = fmtDuracao(trabalhado(c));

          const { data: criada } = await sb
            .from("notificacoes_conferencia")
            .insert({
              conferencia_id: c.id,
              unidade_id: c.unidade_id,
              tipo: "conferencia_atrasada",
              user_id: c.created_by,
              usuario_nome: c.conferente,
              matricula: u.matricula ?? null,
              frota: u.frota ?? null,
              local: u.nome ?? null,
              tipo_conferencia: c.tipo ?? u.tipo ?? null,
              data,
              hora,
              status: c.status,
              assunto: info.assunto,
              mensagem: `Conferência aberta há ${aberto} sem conclusão.`,
              gravidade: info.gravidade,
              payload: {
                conferente: c.conferente ?? null,
                inicio: `${data.split("-").reverse().join("/")} ${hora}`,
                tempo_aberto: aberto,
              },
            })
            .select("id")
            .maybeSingle();

          const id = (criada as { id: string } | null)?.id;
          if (!id) continue;
          criadas.push(id);
        }

        if (criadas.length) {
          const { enviarNotificacao } = await import("@/lib/notificacoes-email.server");
          for (const id of criadas) await enviarNotificacao(id);
        }

        return Response.json({ ok: true, notificadas: criadas.length });
      },
    },
  },
});
