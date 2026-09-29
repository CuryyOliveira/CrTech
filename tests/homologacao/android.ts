/**
 * V2.1 no WebView REAL do Android (emulador), dentro do app (APK de DEBUG), com o app web REAL
 * (VITE_CONFERENCE_V2=1) e o Supabase LOCAL do CI — login real, nada de produção.
 *
 * O aparelho acessa o computador por `adb reverse` (app na porta 3101, Supabase na 54321).
 * "Sem internet" é real: o Wi-Fi/dados do emulador são desligados e os túneis removidos.
 * Toques, digitação, gestos, rotação e botão voltar são do próprio Android (adb input).
 *
 * Uso: npx vite-node tests/homologacao/android.ts <pasta-de-saida>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _android as android, type AndroidDevice, type Page } from "@playwright/test";
import { SENHA, encerrar, sql } from "./ambiente";
import { LISTAS, semear } from "./semear";

const SAIDA = process.argv[2] ?? "android-resultados";
const PKG = "br.com.conferenciarapida.app";
const APP = process.env.HOMOLOG_APP_ANDROID ?? "http://127.0.0.1:3101";
const LISTA = LISTAS.media;

mkdirSync(SAIDA, { recursive: true });
type Etapa = { nome: string; ok: boolean; detalhe?: unknown; ms?: number };
const resultado: {
  aparelho?: Record<string, string>;
  etapas: Etapa[];
  errosJs: string[];
  ok: boolean;
} = { etapas: [], errosJs: [], ok: true };

function registrar(nome: string, ok: boolean, detalhe?: unknown, ms?: number) {
  resultado.etapas.push({ nome, ok, detalhe, ms });
  console.log(
    `${ok ? "✓" : "✗"} ${nome}${ms != null ? ` (${ms} ms)` : ""}${detalhe != null ? ` — ${JSON.stringify(detalhe)}` : ""}`,
  );
  if (!ok) resultado.ok = false;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sh = async (d: AndroidDevice, cmd: string) => (await d.shell(cmd)).toString().trim();

async function tela(d: AndroidDevice, nome: string) {
  await d.screenshot({ path: path.join(SAIDA, `${nome}.png`) }).catch(() => undefined);
}

async function tuneis(d: AndroidDevice, ligar: boolean) {
  const adb = async (args: string) => {
    const { execSync } = await import("node:child_process");
    execSync(`adb ${args}`, { stdio: "ignore" });
  };
  if (ligar) {
    await adb("reverse tcp:3101 tcp:3101");
    await adb("reverse tcp:54321 tcp:54321");
  } else {
    await adb("reverse --remove-all");
  }
  void d;
}

async function rede(d: AndroidDevice, ligada: boolean) {
  await sh(d, `svc wifi ${ligada ? "enable" : "disable"}`);
  await sh(d, `svc data ${ligada ? "enable" : "disable"}`);
  await tuneis(d, ligada);
}

async function girar(d: AndroidDevice, rotacao: 0 | 1) {
  await sh(d, "settings put system accelerometer_rotation 0");
  await sh(d, `settings put system user_rotation ${rotacao}`);
  await sh(d, `wm user-rotation lock ${rotacao}`).catch(() => "");
  await esperar(2500);
}

async function diagnostico(d: AndroidDevice, nome: string) {
  await tela(d, `diag-${nome}`);
  const log = await sh(d, "logcat -d -t 400").catch(() => "");
  writeFileSync(path.join(SAIDA, `diag-${nome}.txt`), log);
  return log.split("\n").slice(-6).join(" | ").slice(0, 600);
}

async function abrirApp(d: AndroidDevice, url: string) {
  await sh(d, `am force-stop ${PKG}`);
  await sh(d, `am start -W -n ${PKG}/.MainActivity --es cr_url_teste '${url}'`);
  const wv = await d.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await wv.page();
  page.on("pageerror", (e) => resultado.errosJs.push(String(e.message ?? e).slice(0, 300)));
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  return page;
}

/** Diferença entre a coordenada da tela (px físicos) e a do WebView (px CSS). */
let calib = { dpr: 2.75, dx: 0, dy: 0 };
async function calibrar(d: AndroidDevice, page: Page) {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await page.evaluate(() => {
    (window as unknown as { __toque?: number[] }).__toque = undefined;
    addEventListener(
      "touchstart",
      (e) => {
        (window as unknown as { __toque?: number[] }).__toque = [
          e.touches[0].clientX,
          e.touches[0].clientY,
        ];
      },
      { once: true, capture: true },
    );
  });
  const [lx, ly] = [300, 900];
  await sh(d, `input tap ${lx} ${ly}`);
  await esperar(500);
  const t = await page.evaluate(() => (window as unknown as { __toque?: number[] }).__toque);
  calib = t ? { dpr, dx: lx - t[0] * dpr, dy: ly - t[1] * dpr } : { dpr, dx: 0, dy: 0 };
  return calib;
}

async function tocar(d: AndroidDevice, page: Page, seletor: string) {
  const el = page.locator(seletor).first();
  await el.scrollIntoViewIfNeeded();
  const c = (await el.boundingBox())!;
  const x = Math.round((c.x + c.width / 2) * calib.dpr + calib.dx);
  const y = Math.round((c.y + c.height / 2) * calib.dpr + calib.dy);
  await sh(d, `input tap ${x} ${y}`);
}

async function filaPendente(page: Page, userId: string) {
  return page.evaluate(async (uid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const q = indexedDB.open(`cr-v2:${uid}`);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const itens: { status: string }[] = await new Promise((res) => {
      const q = db.transaction("fila").objectStore("fila").getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return itens.filter((i) => i.status !== "SYNCED" && i.status !== "RESOLVED").length;
  }, userId);
}

async function ate<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000) {
  const fim = Date.now() + ms;
  let v = await fn().catch(() => undefined as T);
  while (!ok(v) && Date.now() < fim) {
    await esperar(1000);
    v = await fn().catch(() => undefined as T);
  }
  return v;
}

const texto = (page: Page, testid: string) =>
  page
    .getByTestId(testid)
    .textContent({ timeout: 15_000 })
    .catch(() => null);

async function etapa(
  nome: string,
  fn: () => Promise<{ ok: boolean; detalhe?: unknown } | boolean>,
) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const obj = typeof r === "boolean" ? { ok: r } : r;
    registrar(nome, obj.ok, obj.detalhe, Date.now() - t0);
    return obj.ok;
  } catch (e) {
    registrar(nome, false, String((e as Error)?.message ?? e).split("\n")[0], Date.now() - t0);
    return false;
  }
}

async function main() {
  const u = await semear();
  await sql(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.id],
  );
  const [d] = await android.devices();
  if (!d) throw new Error("Nenhum emulador encontrado pelo adb.");
  await sh(d, "settings put system accelerometer_rotation 0");
  await sh(d, "settings put system user_rotation 0");
  resultado.aparelho = {
    modelo: await sh(d, "getprop ro.product.model"),
    android: await sh(d, "getprop ro.build.version.release"),
    api: await sh(d, "getprop ro.build.version.sdk"),
    webview:
      (await sh(d, "dumpsys webviewupdate"))
        .split("\n")
        .find((l) => /Current WebView package/i.test(l))
        ?.trim() ?? "?",
    webview_versao: (
      await sh(
        d,
        "dumpsys package com.android.webview | grep versionName; dumpsys package com.google.android.webview | grep versionName",
      )
    ).replace(/\s+/g, " "),
  };
  console.log("Aparelho:", resultado.aparelho);
  await tuneis(d, true);

  await etapa("instalação (APK de debug instalado)", async () =>
    (await sh(d, `pm list packages ${PKG}`)).includes(PKG),
  );

  let page!: Page;
  // WebView sem suporte ao visual do sistema (Chrome/WebView < 111): o app deve mostrar como
  // atualizar em vez de abrir quebrado. Os fluxos da conferência não se aplicam a esse aparelho.
  const versaoWebView = Number(/(\d+)\./.exec(resultado.aparelho.webview_versao ?? "")?.[1] ?? 0);
  if (versaoWebView > 0 && versaoWebView < 111) {
    await sh(d, `am force-stop ${PKG}`);
    await sh(d, `am start -W -n ${PKG}/.MainActivity --es cr_url_teste '${APP}/entrar'`);
    await esperar(15_000);
    await tela(d, "01-webview-antigo");
    // O aviso escreve "cr-navegador-antigo" no console (o Capacitor repassa ao logcat).
    const log = await sh(d, "logcat -d").catch(() => "");
    await sh(d, "uiautomator dump /sdcard/tela.xml").catch(() => "");
    const xml = await sh(d, "cat /sdcard/tela.xml").catch(() => "");
    let aviso = /cr-navegador-antigo/.test(log) || /Atualize o navegador do aparelho/.test(xml);
    if (!aviso) {
      const wv = await d.webView({ pkg: PKG }, { timeout: 20_000 }).catch(() => null);
      const pg = wv ? await wv.page().catch(() => null) : null;
      aviso = pg
        ? (await pg
            .locator("#cr-navegador-antigo")
            .count()
            .catch(() => 0)) > 0
        : false;
    }
    const textos = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).slice(0, 20);
    const relevantes = log
      .split("\n")
      .filter((l) =>
        /chromium|Console|Capacitor|cr-navegador|ERR_|ConferenciaRapida|WebView/i.test(l),
      )
      .slice(-25);
    registrar(
      `WebView antigo (${versaoWebView}): mostra como atualizar em vez de abrir quebrado`,
      aviso,
      aviso ? undefined : { textos, log: relevantes },
    );
    registrar(
      "fluxos da conferência",
      true,
      `não executados: WebView ${versaoWebView} < 111 não é suportado (o aparelho precisa atualizar o Android System WebView)`,
    );
    return;
  }

  await etapa("abertura do aplicativo", async () => {
    try {
      page = await abrirApp(d, `${APP}/entrar`);
      await page.locator("#login-email").waitFor({ timeout: 60_000 });
    } catch (e) {
      throw new Error(`${String(e).split("\n")[0]} — ${await diagnostico(d, "abertura")}`);
    }
    await tela(d, "01-login");
    return true;
  });

  await etapa("login (Supabase Auth real)", async () => {
    await page.locator("#login-email").fill(u.conferenteA.email);
    await page.locator("#login-senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/menu/, { timeout: 60_000 });
    return true;
  });

  await etapa("abertura da conferência", async () => {
    await page.goto(`${APP}/unidade/${LISTA.id}`);
    const iniciar = page.getByRole("button", { name: "Iniciar conferência" });
    await iniciar.waitFor({ timeout: 120_000 });
    await iniciar.click();
    await page.getByRole("dialog").locator("input").first().fill("Conferente Android");
    await page.getByRole("dialog").getByRole("button", { name: "Iniciar" }).click();
    await page.getByTestId("item-atual").waitFor({ timeout: 60_000 });
    await tela(d, "02-item");
    return true;
  });

  await etapa("carregamento dos itens", async () => {
    const p = await texto(page, "progresso");
    return { ok: p === `0 / ${LISTA.itens}`, detalhe: p };
  });

  await calibrar(d, page);

  await etapa("ausência de rolagem lateral (retrato)", async () => {
    const [sw, cw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    return { ok: sw <= cw, detalhe: { sw, cw } };
  });

  await etapa("quantidade: toque abre o teclado e o campo continua visível", async () => {
    await tocar(d, page, "#qtd-conferida");
    await esperar(1500);
    const ime = /mInputShown=true/.test(await sh(d, "dumpsys input_method"));
    const v = await page.evaluate(() => {
      const r = document.getElementById("qtd-conferida")!.getBoundingClientRect();
      const h = window.visualViewport ? window.visualViewport.height : innerHeight;
      return { topo: Math.round(r.top), base: Math.round(r.bottom), altura: Math.round(h) };
    });
    await tela(d, "03-teclado");
    return { ok: ime && v.topo >= 0 && v.base <= v.altura, detalhe: { ime, ...v } };
  });

  await etapa("quantidade: digitação pelo teclado do Android + confirmar", async () => {
    await sh(d, "input text 2");
    await esperar(300);
    await page.getByRole("button", { name: "CONFIRMAR" }).click();
    await esperar(800);
    const p = await texto(page, "progresso");
    // Fecha o teclado sem usar o "voltar" (que, sem teclado aberto, sairia do app).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return { ok: p === `1 / ${LISTA.itens}`, detalhe: p };
  });

  await etapa("busca por código", async () => {
    const b = page.getByLabel("Buscar por código, descrição ou localização");
    await b.fill("H0050");
    await b.press("Enter");
    await esperar(800);
    return { ok: (await texto(page, "codigo-atual")) === "H0050" };
  });

  await etapa("anterior / próximo", async () => {
    await page.getByRole("button", { name: "Próximo item" }).click();
    await esperar(400);
    const prox = await texto(page, "codigo-atual");
    await page.getByRole("button", { name: "Item anterior" }).click();
    await esperar(400);
    const ant = await texto(page, "codigo-atual");
    return { ok: prox !== "H0050" && ant === "H0050", detalhe: { prox, ant } };
  });

  await etapa("filtros", async () => {
    await page.getByRole("button", { name: /Ver lista de itens/ }).click();
    const conferidos = page.getByRole("radio", { name: /Conferidos/i });
    await conferidos.click();
    await esperar(500);
    const rotulo = await conferidos.textContent();
    await page.getByRole("radio", { name: /Todos/i }).click();
    return { ok: /1/.test(rotulo ?? ""), detalhe: rotulo };
  });

  await etapa("rolagem da lista por gesto", async () => {
    const lista = page.getByTestId("lista-itens");
    const antes = await lista.evaluate((el) => el.scrollTop);
    const c = (await lista.boundingBox())!;
    const x = Math.round((c.x + c.width / 2) * calib.dpr + calib.dx);
    const y1 = Math.round((c.y + c.height * 0.8) * calib.dpr + calib.dy);
    const y2 = Math.round((c.y + c.height * 0.2) * calib.dpr + calib.dy);
    await sh(d, `input swipe ${x} ${y1} ${x} ${y2} 300`);
    await esperar(800);
    const depois = await lista.evaluate((el) => el.scrollTop);
    await tela(d, "04-lista");
    await page.getByRole("button", { name: "Voltar ao item", exact: true }).first().click();
    return { ok: depois > antes, detalhe: { antes, depois } };
  });

  await etapa("pausa", async () => {
    await page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" }).click();
    await page.getByRole("button", { name: "RETOMAR CONFERÊNCIA" }).waitFor();
    return page.getByLabel("QUANTIDADE CONFERIDA").isDisabled();
  });
  await esperar(3000);
  await etapa("retomada", async () => {
    await page.getByRole("button", { name: "RETOMAR CONFERÊNCIA" }).click();
    await page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" }).waitFor();
    return page.getByLabel("QUANTIDADE CONFERIDA").isEnabled();
  });

  await etapa("rotação para paisagem e de volta", async () => {
    await girar(d, 1);
    const p = await page.evaluate(() => [
      innerWidth,
      innerHeight,
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    const confirmar = await page.getByRole("button", { name: "CONFIRMAR" }).isVisible();
    await tela(d, "05-paisagem");
    await girar(d, 0);
    await calibrar(d, page);
    return { ok: p[0] > p[1] && p[2] <= p[3] && confirmar, detalhe: p };
  });

  // Dado inicial sincronizado antes de cortar a rede
  const [conf] = await sql<{ id: string }>(
    "SELECT id FROM conferencias WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [LISTA.id],
  );
  await ate(
    () => filaPendente(page, u.conferenteA.id),
    (n) => n === 0,
  );

  // Item H0003 será contado aqui (sem internet) e, ao mesmo tempo, por outro aparelho.
  const [alvo] = await sql<{ material_id: string; versao: number }>(
    "SELECT material_id, coalesce(versao, 0)::int AS versao FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'H0003'",
    [conf.id],
  );

  const sw = await page.evaluate(async () => ({
    controlada: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    caches: "caches" in window ? await caches.keys() : [],
  }));
  registrar("service worker ativo antes de cortar a rede", sw.controlada, sw);
  // Como no uso real (o app já foi aberto antes com o service worker ativo): a página passa pelo
  // service worker uma vez e fica guardada para abrir sem internet.
  await page.reload();
  await page.getByTestId("item-atual").waitFor({ timeout: 60_000 });
  await calibrar(d, page);

  await etapa("sem internet (Wi-Fi e dados desligados de verdade)", async () => {
    await rede(d, false);
    const estado = await ate(
      () => page.getByTestId("estado-sync").getAttribute("data-estado"),
      (v) => v === "OFFLINE",
      30_000,
    );
    await tela(d, "06-offline");
    return { ok: estado === "OFFLINE", detalhe: estado };
  });

  await etapa("contagem sem internet", async () => {
    const b = page.getByLabel("Buscar por código, descrição ou localização");
    await b.fill("H0003");
    await b.press("Enter");
    await page.getByLabel("QUANTIDADE CONFERIDA").fill("7");
    await page.getByRole("button", { name: "CONFIRMAR" }).click();
    await esperar(600);
    await page.getByLabel("QUANTIDADE CONFERIDA").fill("1");
    await page.getByRole("button", { name: "CONFIRMAR" }).click();
    await esperar(600);
    const p = await texto(page, "progresso");
    return { ok: p === `3 / ${LISTA.itens}`, detalhe: p };
  });

  // Outro aparelho (conferente B, pela API) conta o mesmo item enquanto este está offline.
  const { createClient } = await import("@supabase/supabase-js");
  const outro = createClient(process.env.HOMOLOG_SUPABASE_URL!, process.env.HOMOLOG_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await outro.auth.signInWithPassword({ email: u.conferenteB.email, password: SENHA });
  const { randomUUID } = await import("node:crypto");
  const r = await outro.rpc("processar_eventos_conferencia", {
    _eventos: [
      {
        event_id: randomUUID(),
        conference_id: conf.id,
        device_id: "aparelho-b",
        event_type: "ITEM_COUNTED",
        created_at_device: new Date().toISOString(),
        schema_version: 1,
        payload: { material_id: alvo.material_id, quantidade: 5, versao_base: alvo.versao },
      },
    ],
  });
  registrar("outro aparelho conta o mesmo item (5)", !r.error, r.error?.message);

  // Com histórico de navegação (entrou pela lista): "voltar" tenta sair da conferência e a tela
  // pede confirmação porque há alterações não sincronizadas.
  await etapa("botão voltar com alterações pendentes pede confirmação", async () => {
    await sh(d, "input keyevent KEYCODE_BACK");
    await esperar(1500);
    const aviso = await page
      .getByText("Existem alterações ainda não sincronizadas.")
      .isVisible()
      .catch(() => false);
    await tela(d, "08-voltar");
    if (aviso) await page.getByRole("button", { name: "CONTINUAR" }).click();
    await esperar(500);
    const aindaNaConferencia = await page
      .getByTestId("item-atual")
      .isVisible()
      .catch(() => false);
    const p = await texto(page, "progresso");
    return {
      ok: aviso && aindaNaConferencia && p === `3 / ${LISTA.itens}`,
      detalhe: { aviso, aindaNaConferencia, progresso: p },
    };
  });

  await etapa("fechamento do aplicativo e reabertura sem internet", async () => {
    page = await abrirApp(d, `${APP}/unidade/${LISTA.id}`);
    try {
      await page.getByTestId("item-atual").waitFor({ timeout: 60_000 });
    } catch (e) {
      const url = await page.evaluate(() => location.href).catch(() => "?");
      throw new Error(
        `${String(e).split("\n")[0]} — url=${url} — ${await diagnostico(d, "reabertura")}`,
      );
    }
    const p = await texto(page, "progresso");
    await tela(d, "07-reaberto-offline");
    return { ok: p === `3 / ${LISTA.itens}`, detalhe: p };
  });
  await calibrar(d, page);

  // Sem histórico (app aberto direto na conferência): "voltar" manda o app para segundo plano
  // (moveTaskToBack). Ao voltar ao app, tudo continua lá.
  await etapa(
    "botão voltar sem histórico: app vai para segundo plano e volta intacto",
    async () => {
      const foco = async () =>
        (await sh(d, "dumpsys window")).match(/mCurrentFocus=.*\}/)?.[0] ?? "";
      await sh(d, "input keyevent KEYCODE_BACK");
      await esperar(1500);
      const emSegundoPlano = !(await foco()).includes("MainActivity");
      await sh(d, `monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
      await esperar(2500);
      const voltou = (await foco()).includes("MainActivity");
      const p = await texto(page, "progresso");
      return {
        ok: emSegundoPlano && voltou && p === `3 / ${LISTA.itens}`,
        detalhe: { emSegundoPlano, voltou, progresso: p },
      };
    },
  );

  await etapa("sincronização quando a internet volta", async () => {
    await rede(d, true);
    const n = await ate(
      () => filaPendente(page, u.conferenteA.id),
      (v) => v === 0 || v === 1,
      90_000,
    );
    const itens = await sql<{ codigo: string; q: string | null }>(
      "SELECT codigo, quantidade_contada::text AS q FROM conferencia_itens WHERE conferencia_id = $1 AND quantidade_contada IS NOT NULL ORDER BY codigo",
      [conf.id],
    );
    return { ok: itens.length === 3, detalhe: { fila: n, itens } };
  });

  await etapa("conflito: mostra as duas contagens e só muda por decisão", async () => {
    await page.getByTestId("aviso-atencao").waitFor({ timeout: 60_000 });
    const [antes] = await sql<{ q: string }>(
      "SELECT quantidade_contada::text AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'H0003'",
      [conf.id],
    );
    await page.getByTestId("aviso-atencao").click();
    const minha = await texto(page, "minha-contagem");
    const servidor = await texto(page, "contagem-servidor");
    await tela(d, "09-conflito");
    await page.getByRole("button", { name: "MANTER MINHA CONTAGEM" }).click();
    await ate(
      () => filaPendente(page, u.conferenteA.id),
      (v) => v === 0,
      60_000,
    );
    const [depois] = await sql<{ q: string }>(
      "SELECT quantidade_contada::text AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = 'H0003'",
      [conf.id],
    );
    return {
      ok: antes.q === "5" && /7/.test(minha ?? "") && /5/.test(servidor ?? "") && depois.q === "7",
      detalhe: { antes: antes.q, minha, servidor, depois: depois.q },
    };
  });

  await etapa("câmera: TIRAR FOTO abre a câmera/permissão do sistema", async () => {
    const foco = async () => (await sh(d, "dumpsys window")).match(/mCurrentFocus=.*\}/)?.[0] ?? "";
    await tocar(d, page, 'button:has-text("TIRAR FOTO")');
    await esperar(3000);
    const f = await foco();
    await tela(d, "10-camera");
    for (let i = 0; i < 3 && !(await foco()).includes("MainActivity"); i++) {
      await sh(d, "input keyevent KEYCODE_BACK");
      await esperar(1200);
    }
    return { ok: !f.includes(`${PKG}/${PKG}.MainActivity`), detalhe: f };
  });

  await etapa("finalização com assinatura (toque real)", async () => {
    await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
    const canvas = page.getByTestId("assinatura-conferente").locator("canvas");
    await canvas.scrollIntoViewIfNeeded();
    await esperar(500);
    const c = (await canvas.boundingBox())!;
    const px = (x: number, y: number) =>
      `${Math.round(x * calib.dpr + calib.dx)} ${Math.round(y * calib.dpr + calib.dy)}`;
    await sh(
      d,
      `input swipe ${px(c.x + 20, c.y + 20)} ${px(c.x + c.width - 20, c.y + c.height - 20)} 400`,
    );
    await sh(
      d,
      `input swipe ${px(c.x + 20, c.y + c.height - 20)} ${px(c.x + c.width - 20, c.y + 20)} 400`,
    );
    await esperar(500);
    await tela(d, "11-assinatura");
    await page.getByRole("button", { name: "ASSINAR E FINALIZAR" }).click();
    await ate(
      () => filaPendente(page, u.conferenteA.id),
      (v) => v === 0,
      60_000,
    );
    const [c2] = await sql<{ status: string; assinada: boolean; dup: number }>(
      `SELECT status, assinatura IS NOT NULL AS assinada,
              (SELECT count(*) - count(DISTINCT event_id) FROM conferencia_eventos WHERE conferencia_id = c.id)::int AS dup
         FROM conferencias c WHERE id = $1`,
      [conf.id],
    );
    await tela(d, "12-finalizada");
    return { ok: c2.status === "finalizada" && c2.assinada && c2.dup === 0, detalhe: c2 };
  });

  // A ponte nativa do Capacitor avisa a página quando o app vai/volta do segundo plano chamando
  // window.Capacitor.triggerEvent, que não existe numa página remota (casca Android da V1).
  // Esse erro é registrado à parte; qualquer outro erro de JavaScript reprova.
  const daCasca = resultado.errosJs.filter((e) => /triggerEvent/.test(e));
  const doApp = resultado.errosJs.filter((e) => !/triggerEvent/.test(e));
  registrar("casca Android: avisos de segundo plano sem window.Capacitor (V1, inofensivo)", true, {
    ocorrencias: daCasca.length,
  });
  await etapa("WebView: sem erros de JavaScript do app", async () => ({
    ok: doApp.length === 0,
    detalhe: doApp.slice(0, 5),
  }));
}

main()
  .catch((e) => registrar("execução", false, String((e as Error)?.stack ?? e).slice(0, 800)))
  .finally(async () => {
    writeFileSync(path.join(SAIDA, "resultado.json"), JSON.stringify(resultado, null, 2));
    await encerrar().catch(() => undefined);
    process.exit(resultado.ok ? 0 : 1);
  });
