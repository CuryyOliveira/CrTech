/**
 * Envio das notificações criadas pelo banco (início, conclusão e divergência de conferência).
 *
 * Chamado pelo próprio banco logo depois do COMMIT que confirma a criação/finalização (pg_net,
 * corpo `{ id }`) e, a cada 2 minutos, pelo agendador (corpo `{}`) para reprocessar o que ficou
 * pendente (queda, timeout, erro do provedor). Não depende do aparelho continuar aberto.
 * Chamadas repetidas ou simultâneas não duplicam e-mails: cada destinatário é reservado no banco
 * antes do envio (ver `enviarNotificacao`).
 */
import { createFileRoute } from "@tanstack/react-router";

const LOTE = 20;

export const Route = createFileRoute("/api/public/hooks/notificacoes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const chave = (request.headers.get("x-hook-secret") ?? "").trim();
        if (!chave) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const sb = supabaseAdmin as unknown as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from: (t: string) => any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rpc: (n: string, a: Record<string, unknown>) => any;
        };

        const { data: valido } = await sb.rpc("validar_hook", {
          _nome: "notificacoes",
          _valor: chave,
        });
        if (valido !== true) return new Response("Unauthorized", { status: 401 });

        const corpo = (await request.json().catch(() => ({}))) as { id?: unknown };
        const pedido =
          typeof corpo.id === "string" && /^[0-9a-f-]{36}$/i.test(corpo.id) ? corpo.id : null;

        // Pendentes das últimas 48 h criados pelo servidor (o pedido atual primeiro).
        const { data: pendentes } = await sb
          .from("notificacoes_conferencia")
          .select("id")
          .not("chave", "is", null)
          .in("email_status", ["pendente", "falha", "enviando"])
          .lt("tentativas", 6)
          .gt("created_at", new Date(Date.now() - 48 * 3600_000).toISOString())
          .order("created_at", { ascending: true })
          .limit(LOTE);
        const ids = [
          ...(pedido ? [pedido] : []),
          ...((pendentes ?? []) as { id: string }[]).map((r) => r.id).filter((id) => id !== pedido),
        ];

        const { processarNotificacaoServidor } = await import("@/lib/notificacoes-email.server");
        const resultados: Record<string, string> = {};
        for (const id of ids) {
          resultados[id] = await processarNotificacaoServidor(id);
        }
        return Response.json({ ok: true, processadas: ids.length, resultados });
      },
    },
  },
});
