/** Aviso de nova versão do APK: versões, segurança do endereço, GitHub e comportamento no app. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_ATUALIZACAO,
  compararVersoes,
  escolherRelease,
  haAtualizacao,
  lerVersaoRemota,
  URL_RELEASE_MAIS_RECENTE,
  urlDaRelease,
  urlOficialPermitida,
} from "@/lib/atualizacao-app/versao";
import {
  abrirPaginaOficial,
  adiarAviso,
  appInstalado,
  verificarAtualizacao,
  type Ambiente,
} from "@/lib/atualizacao-app/cliente";
import { limparCacheVersao, versaoAndroidMaisRecente } from "@/lib/atualizacao-app/fonte.server";
import { momentoSeguro } from "@/components/AvisoNovaVersao";
import { RESUMO_VAZIO } from "@/lib/sync-v2";

const OFICIAL = "https://github.com/CuryyOliveira/CrTech/releases";
const v = (versionName: string, versionCode: number | null = null) => ({
  versionName,
  versionCode,
});

describe("comparação de versões", () => {
  it("numérica, não textual", () => {
    expect(compararVersoes("2.0.3", "2.0.2")).toBe(1);
    expect(compararVersoes("2.0.10", "2.0.9")).toBe(1);
    expect(compararVersoes("2.1.0", "2.0.99")).toBe(1);
    expect(compararVersoes("2.0.2", "2.0.2")).toBe(0);
    expect(compararVersoes("2.0.9", "2.0.10")).toBe(-1);
  });

  it("atualização só para versão maior", () => {
    expect(haAtualizacao(v("2.0.2"), v("2.0.3"))).toBe(true);
    expect(haAtualizacao(v("2.0.9"), v("2.0.10"))).toBe(true);
    expect(haAtualizacao(v("2.0.99"), v("2.1.0"))).toBe(true);
    expect(haAtualizacao(v("2.0.2"), v("2.0.2"))).toBe(false); // igual
    expect(haAtualizacao(v("2.0.5"), v("2.0.4"))).toBe(false); // inferior (sem downgrade)
    expect(haAtualizacao(v("2.0.10"), v("2.0.9"))).toBe(false);
  });

  it("versionCode é o critério principal quando os dois existem", () => {
    expect(haAtualizacao(v("2.0.2", 14), v("2.0.3", 15))).toBe(true);
    expect(haAtualizacao(v("2.0.2", 15), v("2.0.3", 14))).toBe(false); // código menor
    expect(haAtualizacao(v("2.0.2", 15), v("2.0.3", 15))).toBe(false); // código igual
    expect(haAtualizacao(v("2.0.3", 14), v("2.0.3", 99))).toBe(false); // mesma versão
  });

  it("valores inválidos nunca geram atualização", () => {
    for (const ruim of ["", "2.0", "v2.0.3", "2.0.3.apk", "javascript:1", "2.0.3 ", "02.0.3"]) {
      expect(haAtualizacao(v("2.0.2"), v(ruim))).toBe(false);
      expect(haAtualizacao(v(ruim), v("9.9.9"))).toBe(false);
    }
  });
});

describe("segurança do endereço", () => {
  it("monta só a página oficial; versão inválida → /latest", () => {
    expect(urlDaRelease("2.0.3")).toBe(`${OFICIAL}/tag/android-v2.0.3`);
    expect(urlDaRelease("10.20.30")).toBe(`${OFICIAL}/tag/android-v10.20.30`);
    for (const ruim of [
      "javascript:alert(1)",
      "http://evil.com",
      "https://outro-site.com/a.apk",
      "2.0",
      "v2.0.3",
      "2.0.3.apk",
      "2.0.3/../../x",
      null,
      undefined,
      42,
    ]) {
      expect(urlDaRelease(ruim)).toBe(URL_RELEASE_MAIS_RECENTE);
    }
  });

  it("allowlist: só HTTPS, github.com e o repositório oficial", () => {
    expect(urlOficialPermitida(`${OFICIAL}/tag/android-v2.0.3`)).toBe(true);
    expect(urlOficialPermitida(`${OFICIAL}/latest`)).toBe(true);
    for (const ruim of [
      `http://github.com/CuryyOliveira/CrTech/releases/latest`, // HTTP
      "https://evil.com/CuryyOliveira/CrTech/releases/latest", // domínio externo
      "https://github.com.evil.com/CuryyOliveira/CrTech/releases/latest",
      "https://api.github.com/repos/CuryyOliveira/CrTech/releases/latest",
      "https://github.com/outro/repo/releases/latest", // outro repositório
      "https://github.com/CuryyOliveira/CrTech/archive/main.zip", // outro caminho
      `${OFICIAL}/download/android-v2.0.3/app.apk`, // download direto
      `${OFICIAL}/tag/android-v2.0`, // versão inválida
      `${OFICIAL}/tag/android-v2.0.3?x=1`,
      `${OFICIAL}/latest#x`,
      "https://user:pw@github.com/CuryyOliveira/CrTech/releases/latest",
      "https://github.com:8443/CuryyOliveira/CrTech/releases/latest",
      "javascript:alert(1)",
      "file:///sdcard/app.apk",
      "intent://x#Intent;end",
      "https://localhost/CuryyOliveira/CrTech/releases/latest",
      "https://127.0.0.1/CuryyOliveira/CrTech/releases/latest",
      "",
      null,
    ]) {
      expect(urlOficialPermitida(ruim), String(ruim)).toBe(false);
    }
  });

  it("resposta do servidor: URL enviada é ignorada; só versionName/versionCode valem", () => {
    const lido = lerVersaoRemota({
      versionName: "2.0.3",
      versionCode: 15,
      url: "https://evil.com/app.apk",
      download: "javascript:alert(1)",
    });
    expect(lido).toEqual({ versionName: "2.0.3", versionCode: 15 });
    expect(lerVersaoRemota({ versionName: "https://evil.com" })).toBeNull();
    expect(lerVersaoRemota({ versionName: "2.0.3", versionCode: -1 })).toEqual(v("2.0.3"));
    expect(lerVersaoRemota(null)).toBeNull();
  });
});

describe("fonte: GitHub Releases", () => {
  const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: "Conferência Rápida para Android (versionCode 15, commit abc1234).",
    html_url: "https://evil.com/ignorado",
    ...extra,
  });

  it("escolhe a maior release oficial e lê o versionCode das notas", () => {
    expect(
      escolherRelease([rel("android-v2.0.2", { body: "versionCode 14" }), rel("android-v2.0.10")]),
    ).toEqual({ versionName: "2.0.10", versionCode: 15 });
  });

  it("ignora prerelease, draft, tag inválida e releases de teste", () => {
    expect(
      escolherRelease([
        rel("android-v9.0.0", { prerelease: true }),
        rel("android-v8.0.0", { draft: true }),
        rel("android-claude-app-to-android-apk-irx1ru"),
        rel("v7.0.0"),
        rel("android-v6.0"),
        rel("android-v5.0.0-beta"),
        rel("android-v2.0.2", { body: "versionCode 14" }),
      ]),
    ).toEqual({ versionName: "2.0.2", versionCode: 14 });
    expect(escolherRelease([rel("android-v9.0.0", { prerelease: true })])).toBeNull();
    expect(escolherRelease({ nao: "lista" })).toBeNull();
  });

  beforeEach(() => limparCacheVersao());

  it("consulta o repositório oficial e guarda por 1 hora", async () => {
    const f = vi.fn(async () => Response.json([rel("android-v2.0.3")]));
    let agora = 1_000_000;
    const ops = { fetch: f as unknown as typeof fetch, agora: () => agora };
    expect(await versaoAndroidMaisRecente(ops)).toEqual(v("2.0.3", 15));
    expect(f).toHaveBeenCalledWith(
      "https://api.github.com/repos/CuryyOliveira/CrTech/releases?per_page=30",
      expect.objectContaining({ redirect: "manual" }),
    );
    agora += 30 * 60_000;
    await versaoAndroidMaisRecente(ops);
    expect(f).toHaveBeenCalledTimes(1); // cache
    agora += 31 * 60_000;
    await versaoAndroidMaisRecente(ops);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("GitHub indisponível, erro HTTP ou timeout → null controlado", async () => {
    const fora = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await versaoAndroidMaisRecente({ fetch: fora as unknown as typeof fetch })).toBeNull();
    const erro = vi.fn(async () => new Response("x", { status: 502 }));
    expect(await versaoAndroidMaisRecente({ fetch: erro as unknown as typeof fetch })).toBeNull();
    const lento = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_r, rej) =>
          init?.signal?.addEventListener("abort", () => rej(new Error("abort"))),
        ),
    );
    expect(
      await versaoAndroidMaisRecente({ fetch: lento as unknown as typeof fetch, timeoutMs: 20 }),
    ).toBeNull();
  });
});

describe("app: verificação, frequência e 'Depois'", () => {
  function ambiente(opcoes: {
    versao?: unknown;
    android?: boolean;
    online?: boolean;
    resposta?: unknown;
    status?: number;
    falha?: boolean;
  }) {
    const dados = new Map<string, string>();
    const mensagens: string[] = [];
    const janela: Record<string, unknown> = {};
    if (opcoes.android !== false) {
      janela.CRNativo = { postMessage: (m: string) => mensagens.push(m) };
      janela.__crAndroid = true;
    }
    if (opcoes.versao) janela.__crVersaoApp = opcoes.versao;
    let agora = 1_000_000_000;
    const fetch = vi.fn(async () => {
      if (opcoes.falha) throw new TypeError("offline");
      return Response.json(opcoes.resposta ?? { versionName: "2.0.3", versionCode: 15 }, {
        status: opcoes.status ?? 200,
      });
    });
    const amb: Ambiente = {
      janela: janela as never,
      armazenamento: {
        getItem: (k) => dados.get(k) ?? null,
        setItem: (k, v) => void dados.set(k, v),
      },
      fetch: fetch as unknown as typeof globalThis.fetch,
      online: () => opcoes.online !== false,
      agora: () => agora,
    };
    return { amb, fetch, mensagens, avancar: (ms: number) => (agora += ms) };
  }

  it("primeira execução (APK 2.0.3+, versão 2.0.2 instalada) → aviso", async () => {
    const t = ambiente({ versao: { versionName: "2.0.2", versionCode: 14 } });
    const r = await verificarAtualizacao(t.amb);
    expect(r?.remota).toEqual(v("2.0.3", 15));
    expect(r?.app.identificado).toBe(true);
  });

  it("nenhuma atualização quando a versão é a mesma", async () => {
    const t = ambiente({ versao: { versionName: "2.0.3", versionCode: 15 } });
    expect(await verificarAtualizacao(t.amb)).toBeNull();
  });

  it("APK antigo sem identificação é tratado como 2.0.2", async () => {
    const t = ambiente({});
    expect(appInstalado(t.amb.janela)?.instalada).toEqual(v("2.0.2"));
    expect((await verificarAtualizacao(t.amb))?.app.identificado).toBe(false);
    const igual = ambiente({ resposta: { versionName: "2.0.2", versionCode: 14 } });
    expect(await verificarAtualizacao(igual.amb)).toBeNull();
  });

  it("fora do app Android (navegador) não faz nada", async () => {
    const t = ambiente({ android: false });
    expect(await verificarAtualizacao(t.amb)).toBeNull();
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it("offline: não consulta e não mostra erro", async () => {
    const t = ambiente({ online: false });
    expect(await verificarAtualizacao(t.amb)).toBeNull();
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it("erro da API ou falha de rede: silencioso e espera antes de tentar de novo", async () => {
    const t = ambiente({ status: 503, resposta: { erro: "indisponivel" } });
    expect(await verificarAtualizacao(t.amb)).toBeNull();
    expect(await verificarAtualizacao(t.amb)).toBeNull();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.avancar(CONFIG_ATUALIZACAO.esperaAposFalhaMs + 1);
    await verificarAtualizacao(t.amb);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    const rede = ambiente({ falha: true });
    expect(await verificarAtualizacao(rede.amb)).toBeNull();
  });

  it("consulta no máximo a cada 12 h", async () => {
    const t = ambiente({});
    await verificarAtualizacao(t.amb);
    t.avancar(CONFIG_ATUALIZACAO.intervaloVerificacaoMs - 1000);
    await verificarAtualizacao(t.amb); // usa a última versão conhecida
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.avancar(2000);
    await verificarAtualizacao(t.amb);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it("'Depois' esconde por 3 dias e depois verifica de novo", async () => {
    const t = ambiente({});
    expect(await verificarAtualizacao(t.amb)).not.toBeNull();
    adiarAviso(t.amb);
    t.avancar(CONFIG_ATUALIZACAO.adiarMs - 1000);
    expect(await verificarAtualizacao(t.amb)).toBeNull();
    t.avancar(2000);
    expect(await verificarAtualizacao(t.amb)).not.toBeNull();
  });

  it("'Atualizar agora' (APK 2.0.3+): envia só a versão; o Java monta o endereço", () => {
    const t = ambiente({ versao: { versionName: "2.0.2", versionCode: 14 } });
    expect(abrirPaginaOficial("2.0.3", t.amb)).toBe(`${OFICIAL}/tag/android-v2.0.3`);
    expect(JSON.parse(t.mensagens[0])).toEqual({ tipo: "atualizacao", versao: "2.0.3" });
  });

  it("'Atualizar agora' (APK antigo): envia apenas o endereço oficial validado", () => {
    const t = ambiente({});
    expect(abrirPaginaOficial("2.0.3", t.amb)).toBe(`${OFICIAL}/tag/android-v2.0.3`);
    expect(JSON.parse(t.mensagens[0])).toEqual({
      tipo: "externo",
      url: `${OFICIAL}/tag/android-v2.0.3`,
    });
    abrirPaginaOficial("https://evil.com/app.apk", t.amb);
    expect(JSON.parse(t.mensagens[1]).url).toBe(URL_RELEASE_MAIS_RECENTE);
  });

  it("valores do APK adulterados não viram versão", () => {
    const t = ambiente({ versao: { versionName: "javascript:alert(1)", versionCode: "x" } });
    expect(appInstalado(t.amb.janela)?.instalada).toEqual(v("2.0.2"));
  });
});

describe("momento seguro (não interromper operações)", () => {
  const r = (estado: "ONLINE" | "OFFLINE" | "SYNCING" | "ERROR", extra = {}) => ({
    ...RESUMO_VAZIO,
    estado,
    ...extra,
  });
  it("só com motor ONLINE, sem conflito e sem atenção", () => {
    expect(momentoSeguro(r("ONLINE"), true)).toBe(true);
    expect(momentoSeguro(r("SYNCING"), true)).toBe(false); // sincronização / envio
    expect(momentoSeguro(r("OFFLINE"), true)).toBe(false); // operação offline
    expect(momentoSeguro(r("ERROR"), true)).toBe(false);
    expect(momentoSeguro(r("ONLINE", { conflitos: 1 }), true)).toBe(false); // conflito
    expect(momentoSeguro(r("ONLINE", { atencao: 1 }), true)).toBe(false);
    expect(momentoSeguro(r("ONLINE", { pendentes: 2 }), true)).toBe(false); // envio de dados
    expect(momentoSeguro(r("OFFLINE"), false)).toBe(true); // sem motor V2
  });
});
