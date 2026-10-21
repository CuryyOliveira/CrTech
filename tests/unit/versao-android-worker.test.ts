/**
 * Atualização automática da reserva VERSAO_ANDROID_DEPLOY do Worker após publicar um APK:
 * validação da release, payload {versionName, versionCode}, nunca inferior, sem segredos.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decidirVersaoWorker, executar } from "../../scripts/versao-android-deploy";

const rel = (tag: string, code: number | null, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body:
    code === null
      ? "Conferência Rápida para Android."
      : `Conferência Rápida para Android (versionCode ${code}, commit abc1234).`,
  html_url: "https://evil.com/ignorado",
  assets: [{ browser_download_url: "https://evil.com/app.apk" }],
  ...extra,
});
const OFICIAIS = [
  rel("android-v2.0.4", 16),
  rel("android-v2.0.3", 15),
  rel("android-v2.0.2", 14),
  rel("android-claude-app-to-android-apk-irx1ru", null, { prerelease: true }),
];

describe("decidirVersaoWorker", () => {
  it("release válida android-v2.0.4 → {versionName: 2.0.4, versionCode: 16}", () => {
    const p = decidirVersaoWorker(OFICIAIS, { tag: "android-v2.0.4" });
    expect(p).toStrictEqual({ versionName: "2.0.4", versionCode: 16 });
    expect(p.versionName).toBe("2.0.4"); // extraído da tag
    expect(p.versionCode).toBe(16); // extraído das notas da release
  });

  it("payload só com versionName e versionCode (nenhuma URL ou campo do GitHub)", () => {
    const p = decidirVersaoWorker(OFICIAIS, { tag: "android-v2.0.4" });
    expect(Object.keys(p).sort()).toEqual(["versionCode", "versionName"]);
    expect(JSON.stringify(p)).not.toMatch(/http|evil|apk/);
  });

  it("draft é rejeitado", () => {
    const lista = [rel("android-v2.0.4", 16, { draft: true }), rel("android-v2.0.3", 15)];
    expect(() => decidirVersaoWorker(lista, { tag: "android-v2.0.4" })).toThrow(/não encontrada/);
  });

  it("pré-release é rejeitada", () => {
    const lista = [rel("android-v2.0.4", 16, { prerelease: true }), rel("android-v2.0.3", 15)];
    expect(() => decidirVersaoWorker(lista, { tag: "android-v2.0.4" })).toThrow(/não encontrada/);
  });

  it("tag fora do padrão android-vX.Y.Z é rejeitada", () => {
    for (const tag of [
      "android-claude-app-to-android-apk-irx1ru",
      "v2.0.4",
      "android-v2.0",
      "android-v2.0.4-beta",
      "android-v02.0.4",
    ]) {
      expect(() => decidirVersaoWorker(OFICIAIS, { tag })).toThrow(/padrão oficial/);
    }
  });

  it("versão inválida: releases fora do padrão são ignoradas; sem nenhuma válida → erro", () => {
    expect(() =>
      decidirVersaoWorker([rel("android-v2.0", 16), rel("android-v2.0.4-rc1", 16)]),
    ).toThrow(/nenhuma release/);
    expect(() => decidirVersaoWorker({ nao: "lista" })).toThrow(/nenhuma release/);
  });

  it("sem versionCode válido nas notas → erro (nada é gravado)", () => {
    expect(() => decidirVersaoWorker([rel("android-v2.0.4", null)])).toThrow(/versionCode/);
    expect(() => decidirVersaoWorker([rel("android-v2.0.4", 0)])).toThrow(/versionCode/);
  });

  it("versão inferior não sobrescreve a superior", () => {
    // Publicada no endpoint: 2.0.5; GitHub só mostra até 2.0.4 → recusa.
    expect(() =>
      decidirVersaoWorker(OFICIAIS, {
        tag: "android-v2.0.4",
        atual: { versionName: "2.0.5", versionCode: 17 },
      }),
    ).toThrow(/inferior/);
    // Release nova de uma versão mais antiga que a maior oficial → recusa.
    expect(() => decidirVersaoWorker(OFICIAIS, { tag: "android-v2.0.3" })).toThrow(/não é a maior/);
    // Igual ou superior à atual → segue.
    for (const atual of [
      { versionName: "2.0.4", versionCode: 16 },
      { versionName: "2.0.3", versionCode: 15 },
    ]) {
      expect(decidirVersaoWorker(OFICIAIS, { tag: "android-v2.0.4", atual })).toStrictEqual({
        versionName: "2.0.4",
        versionCode: 16,
      });
    }
    // Resposta inválida do endpoint (ex.: 503) não bloqueia nem vira versão.
    expect(decidirVersaoWorker(OFICIAIS, { atual: { erro: "indisponivel" } }).versionName).toBe(
      "2.0.4",
    );
  });
});

describe("executar (script usado pelos workflows)", () => {
  const TOKEN = "ghs_TOKEN_SECRETO_DE_TESTE_123";
  function rodar(argv: string[], resposta: () => Promise<Response>) {
    const saida: string[] = [];
    const erro: string[] = [];
    const f = vi.fn(async () => resposta());
    const p = executar({
      argv,
      token: TOKEN,
      fetch: f as unknown as typeof fetch,
      saida: (s) => saida.push(s),
      erro: (s) => erro.push(s),
    });
    return { p, saida, erro, f };
  }

  it("estrito + release válida: imprime só o payload; token usado só no cabeçalho", async () => {
    const r = rodar(["--estrito", "--tag", "android-v2.0.4"], async () => Response.json(OFICIAIS));
    expect(await r.p).toBe(0);
    expect(r.saida.join("")).toBe('{"versionName":"2.0.4","versionCode":16}');
    expect(r.f).toHaveBeenCalledWith(
      "https://api.github.com/repos/CuryyOliveira/CrTech/releases?per_page=30",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({ authorization: `Bearer ${TOKEN}` }),
      }),
    );
    expect([...r.saida, ...r.erro].join("\n")).not.toContain(TOKEN);
  });

  it("estrito + falha (HTTP, pré-release, inferior): saída 1, nada impresso, motivo claro", async () => {
    const casos: [string[], () => Promise<Response>, RegExp][] = [
      [["--estrito"], async () => new Response("{}", { status: 403 }), /HTTP 403/],
      [
        ["--estrito", "--tag", "android-v2.0.4"],
        async () => Response.json([rel("android-v2.0.4", 16, { prerelease: true })]),
        /nenhuma release|não encontrada/,
      ],
      [
        [
          "--estrito",
          "--tag",
          "android-v2.0.4",
          "--atual",
          '{"versionName":"2.0.9","versionCode":30}',
        ],
        async () => Response.json(OFICIAIS),
        /inferior/,
      ],
    ];
    for (const [argv, resp, motivo] of casos) {
      const r = rodar(argv, resp);
      expect(await r.p).toBe(1);
      expect(r.saida).toEqual([]);
      expect(r.erro.join("\n")).toMatch(motivo);
      expect(r.erro.join("\n")).not.toContain(TOKEN);
    }
  });

  it("modo do deploy Web (não estrito): falha não derruba o deploy", async () => {
    const fora = async (): Promise<Response> => {
      throw new TypeError("network");
    };
    // Sem versão publicada conhecida: não imprime nada.
    const r = rodar(["--atual", "nao-json"], fora);
    expect(await r.p).toBe(0);
    expect(r.saida).toEqual([]);
    // Com a versão publicada: mantém-na (validada), em vez de deixar a reserva vazia.
    const r2 = rodar(["--atual", '{"versionName":"2.0.3","versionCode":15,"url":"x"}'], fora);
    expect(await r2.p).toBe(0);
    expect(r2.saida.join("")).toBe('{"versionName":"2.0.3","versionCode":15}');
    // Publicada inválida: nada.
    for (const atual of ['{"versionName":"2.0","versionCode":15}', '{"versionName":"2.0.3"}']) {
      const r3 = rodar(["--atual", atual], fora);
      expect(await r3.p).toBe(0);
      expect(r3.saida).toEqual([]);
    }
    // Modo estrito nunca usa a publicada como substituta.
    const r4 = rodar(["--estrito", "--atual", '{"versionName":"2.0.3","versionCode":15}'], fora);
    expect(await r4.p).toBe(1);
    expect(r4.saida).toEqual([]);
  });
});

describe("workflows: credenciais e segredos", () => {
  const apk = readFileSync(".github/workflows/android-apk.yml", "utf8");
  const web = readFileSync(".github/workflows/deploy-web.yml", "utf8");
  const job = apk.slice(apk.indexOf("versao-no-worker:"));

  it("job do Worker: reutiliza as credenciais da Cloudflare, mascara o token e não grava a chave do GitHub", () => {
    expect(job).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(job).toContain('echo "::add-mask::$TOKEN"');
    expect(job).toContain("secret put VERSAO_ANDROID_RELEASE");
    // A variável do deploy Web não é tocada pelo job (sem janela sem versão).
    expect(job).not.toMatch(/secret (put|delete) VERSAO_ANDROID_DEPLOY/);
    // O que vai para o Worker é só o payload validado (chaves exatas conferidas com jq).
    expect(job).toContain(`jq -e 'keys == ["versionCode","versionName"]'`);
    // A chave do GitHub só é usada na etapa de leitura, nunca na de gravação.
    const gravar = job.slice(job.indexOf("Gravar a versão no Worker"));
    expect(gravar).not.toContain("GITHUB_TOKEN");
    expect(gravar).not.toContain("github.token");
    // Confere o endpoint e fica vermelho se a versão nova não aparecer.
    expect(gravar).toContain("exit 1");
  });

  it("deploy Web: mantém a variável VERSAO_ANDROID_DEPLOY (sem transição) e não envia chave do GitHub", () => {
    expect(web).toMatch(/\.vars = \{[^}]*VERSAO_ANDROID_DEPLOY: \$versao\}/);
    const segredos = web.slice(web.indexOf("const nomes"), web.indexOf("console.log"));
    expect(segredos).not.toContain("GITHUB_TOKEN");
    expect(segredos).not.toContain("VERSAO_ANDROID");
  });

  it("mudar só o workflow do APK não gera nem republica APK", () => {
    const gatilho = apk.slice(0, apk.indexOf("permissions:"));
    expect(gatilho).toContain('- "mobile/**"');
    expect(gatilho).not.toContain(".github/workflows/android-apk.yml");
  });
});
