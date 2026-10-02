/** /api/public/versao-android: corpo só com versionName/versionCode; sem versão conhecida → 503. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { limparCacheVersao } from "@/lib/atualizacao-app/fonte.server";
import { Route } from "@/routes/api/public/versao-android";

type Handlers = { GET: () => Promise<Response> };
const GET = () =>
  (Route.options as unknown as { server: { handlers: Handlers } }).server.handlers.GET();

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body: "versionCode 15",
  html_url: "https://evil.com/app.apk",
  assets: [{ browser_download_url: "https://evil.com/app.apk" }],
  ...extra,
});

describe("endpoint versao-android", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    limparCacheVersao();
  });

  it("GitHub normal: 200 só com versionName e versionCode (nenhuma URL do GitHub)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([release("android-v2.0.3")])),
    );
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toStrictEqual({ versionName: "2.0.3", versionCode: 15 });
  });

  it("GitHub com limite esgotado (403) e versão gravada no deploy: 200, não 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("VERSAO_ANDROID_DEPLOY", '{"versionName":"2.0.3","versionCode":15}');
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      ),
    );
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toStrictEqual({ versionName: "2.0.3", versionCode: 15 });
  });

  it("GitHub fora do ar e nenhuma versão conhecida: 503 controlado, sem cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("VERSAO_ANDROID_DEPLOY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const r = await GET();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toStrictEqual({ erro: "indisponivel" });
  });
  it("Cache API da Cloudflare: versão sobrevive a novo deploy mesmo com GitHub recusando", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("VERSAO_ANDROID_DEPLOY", "");
    // caches.default simulado: guarda as respostas fora da memória da "instância".
    const guardado = new Map<string, string>();
    const put = vi.fn(async (k: string, r: Response) => {
      expect(r.headers.get("cache-control")).toBe("max-age=2592000");
      guardado.set(k, await r.text());
    });
    const match = vi.fn(async (k: string) =>
      guardado.has(k) ? new Response(guardado.get(k)) : undefined,
    );
    vi.stubGlobal("caches", { default: { put, match } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([release("android-v2.0.3")])),
    );
    expect((await GET()).status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    const [chave] = put.mock.calls[0];
    expect(chave).toBe("https://conferenciarapida.com.br/__interno/versao-android-v1");
    expect(Object.keys(JSON.parse(guardado.get(chave)!).valor).sort()).toEqual([
      "versionCode",
      "versionName",
    ]);

    // Novo deploy: memória zerada; GitHub com limite esgotado.
    limparCacheVersao();
    const recusa = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", recusa);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 3600_000); // cache "fresco" (1 h) já venceu
    try {
      const r = await GET();
      expect(r.status).toBe(200);
      expect(await r.json()).toStrictEqual({ versionName: "2.0.3", versionCode: 15 });
      expect(recusa).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }

    // Conteúdo adulterado no cache é recusado.
    limparCacheVersao();
    for (const k of guardado.keys())
      guardado.set(k, JSON.stringify({ valor: { versionName: "x" }, em: Date.now() }));
    expect((await GET()).status).toBe(503);
  });
});
