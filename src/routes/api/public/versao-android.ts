/**
 * Versão Android oficial mais recente: { versionName, versionCode }.
 * Nunca devolve URL (o app monta o endereço da página oficial a partir de uma constante) e não
 * aceita nenhum parâmetro do cliente. Falha do GitHub → 503 controlado (o app ignora em silêncio).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/versao-android")({
  server: {
    handlers: {
      GET: async () => {
        const { versaoAndroidMaisRecente } = await import("@/lib/atualizacao-app/fonte.server");
        const versao = await versaoAndroidMaisRecente();
        if (!versao) {
          return Response.json(
            { erro: "indisponivel" },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
        return Response.json(
          { versionName: versao.versionName, versionCode: versao.versionCode },
          { headers: { "cache-control": "public, max-age=3600" } },
        );
      },
    },
  },
});
