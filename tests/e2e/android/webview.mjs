/**
 * V2.1 — conferência no WebView REAL do Android (emulador), dentro do app (MainActivity de debug),
 * com o servidor de TESTE no computador (adb reverse tcp:4173).
 *
 * Verifica: abrir/iniciar, teclado virtual sem esconder o campo, contar, rolagem, toque,
 * sem rolagem lateral, rotação, botão voltar, câmera/galeria (abre o seletor do sistema),
 * offline + fechar e reabrir o app + sincronizar. Gera capturas de tela e um resumo JSON.
 *
 * Uso (no CI, com emulador ligado): node tests/e2e/android/webview.mjs <pasta-de-saida>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { _android as android } from "@playwright/test";

const SAIDA = process.argv[2] ?? "android-resultados";
const PKG = "br.com.conferenciarapida.app";
const PORTA = 4173;
const BASE = `http://localhost:${PORTA}`;
const U = "00000000-0000-4000-8000-00000000a002";
const LISTA = "00000000-0000-4000-8000-0000000001a1";
const EMPRESA = "00000000-0000-4000-8000-000000000e0a";
const URL_APP = (extra = "") => `${BASE}/?usuario=${U}&lista=${LISTA}&empresa=${EMPRESA}${extra}`;

mkdirSync(SAIDA, { recursive: true });
const resultado = { etapas: [], ok: true };
const registrar = (nome, ok, detalhe = null) => {
  resultado.etapas.push({ nome, ok, detalhe });
  console.log(`${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${JSON.stringify(detalhe)}` : ""}`);
  if (!ok) resultado.ok = false;
};

async function sql(texto, params = []) {
  const r = await fetch(`${BASE}/api/_sql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: texto, params }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function prepararBanco() {
  await fetch(`${BASE}/api/_reset`, { method: "POST" });
  await sql(
    "UPDATE conferencias SET status='cancelada', hora_fim=now() WHERE unidade_id=$1 AND status IN ('em_andamento','pausada')",
    [LISTA],
  );
  await sql(
    `INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada, locacao)
     SELECT gen_random_uuid(), $1, 'E-'||lpad(g::text,4,'0'), 'Material de teste '||g, (g%5)+1,
            'C'||lpad((g/10)::text,2,'0')||'-P'||chr(65+g%4)||'-'||lpad(g::text,2,'0')
       FROM generate_series(1, 30) g`,
    [LISTA],
  );
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrirApp(device, extra = "") {
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`am start -W -n ${PKG}/.MainActivity --es cr_url_teste '${URL_APP(extra)}'`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  await page.waitForFunction(() => document.body && document.body.innerText.length > 0, null, {
    timeout: 60_000,
  });
  return page;
}

async function tela(device, page, nome) {
  await device.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  void page;
}

async function main() {
  const [device] = await android.devices();
  if (!device) throw new Error("Nenhum emulador/dispositivo encontrado pelo adb.");
  await device.shell("settings put system accelerometer_rotation 0");
  await device.shell("settings put system user_rotation 0");
  resultado.aparelho = {
    modelo: (await device.shell("getprop ro.product.model")).toString().trim(),
    android: (await device.shell("getprop ro.build.version.release")).toString().trim(),
    api: (await device.shell("getprop ro.build.version.sdk")).toString().trim(),
    webview: (await device.shell("dumpsys webviewupdate"))
      .toString()
      .split("\n")
      .find((l) => /Current WebView package/i.test(l))
      ?.trim(),
  };
  console.log("Aparelho:", resultado.aparelho);

  await prepararBanco();
  let page = await abrirApp(device, "&offline=0");

  // 1. Abrir e iniciar
  const iniciar = page.getByRole("button", { name: "INICIAR CONFERÊNCIA" });
  await iniciar.waitFor({ timeout: 60_000 });
  await iniciar.tap();
  await page.getByTestId("item-atual").waitFor({ timeout: 30_000 });
  registrar(
    "abrir e iniciar conferência",
    (await page.getByTestId("progresso").textContent()) === "0 / 33",
  );
  await tela(device, page, "01-item");

  // 2. Sem rolagem lateral (largura da página = largura da tela)
  const larg = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  registrar("sem rolagem lateral (retrato)", larg[0] <= larg[1], larg);

  // 3. Teclado virtual: tocar na quantidade abre o teclado e o campo continua visível
  const campo = page.getByLabel("QUANTIDADE CONFERIDA");
  await campo.tap();
  await esperar(1500);
  const ime = (await device.shell("dumpsys input_method")).toString();
  const tecladoAberto = /mInputShown=true/.test(ime);
  const visivel = await page.evaluate(() => {
    const el = document.getElementById("qtd-conferida");
    const r = el.getBoundingClientRect();
    const altura = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    return { topo: Math.round(r.top), base: Math.round(r.bottom), altura: Math.round(altura) };
  });
  registrar("teclado abre ao tocar na quantidade", tecladoAberto);
  registrar(
    "campo visível com o teclado aberto",
    visivel.topo >= 0 && visivel.base <= visivel.altura,
    visivel,
  );
  await tela(device, page, "02-teclado");

  // 4. Contar (digitação no teclado do Android) e confirmar
  await device.input.type("2");
  await esperar(300);
  await page.getByRole("button", { name: "CONFIRMAR" }).tap();
  await esperar(800);
  registrar(
    "contagem pelo teclado do Android + avanço",
    (await page.getByTestId("progresso").textContent()) === "1 / 33",
  );
  await device.input.press("Back"); // fecha o teclado se ainda estiver aberto
  await esperar(500);

  // 5. Rolagem por gesto (swipe) na lista
  await page.getByRole("button", { name: /Ver lista de itens/ }).tap();
  const lista = page.getByTestId("lista-itens");
  const antes = await lista.evaluate((el) => el.scrollTop);
  const caixa = await lista.boundingBox();
  const dens =
    Number((await device.shell("wm density")).toString().match(/(\d+)\s*$/)?.[1] ?? 440) / 160;
  const x = Math.round((caixa.x + caixa.width / 2) * dens);
  const y1 = Math.round((caixa.y + caixa.height * 0.8) * dens);
  const y2 = Math.round((caixa.y + caixa.height * 0.2) * dens);
  await device.shell(`input swipe ${x} ${y1} ${x} ${y2} 300`);
  await esperar(800);
  const depois = await lista.evaluate((el) => el.scrollTop);
  registrar("rolagem da lista por gesto", depois > antes, { antes, depois });
  await tela(device, page, "03-lista");
  await page.getByRole("button", { name: "Voltar ao item", exact: true }).first().tap();

  // 6. Rotação para paisagem e de volta
  await device.shell("settings put system user_rotation 1");
  await esperar(2500);
  const pais = await page.evaluate(() => [
    innerWidth,
    innerHeight,
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  registrar(
    "paisagem: largura > altura e sem rolagem lateral",
    pais[0] > pais[1] && pais[2] <= pais[3],
    pais,
  );
  registrar(
    "paisagem: item e CONFIRMAR visíveis",
    await page.getByRole("button", { name: "CONFIRMAR" }).isVisible(),
  );
  await tela(device, page, "04-paisagem");
  await device.shell("settings put system user_rotation 0");
  await esperar(2000);

  // 7. Câmera e galeria: tocar abre o seletor/câmera do sistema; voltar retorna ao app
  const foco = async () =>
    (await device.shell("dumpsys window")).toString().match(/mCurrentFocus=.*\}/)?.[0] ?? "";
  await page.getByText("TIRAR FOTO").tap();
  await esperar(3000);
  const focoCamera = await foco();
  await tela(device, page, "05-camera");
  registrar(
    "TIRAR FOTO abre câmera/permissão do sistema",
    !focoCamera.includes(`${PKG}/${PKG}.MainActivity`),
    focoCamera,
  );
  for (let i = 0; i < 3 && !(await foco()).includes("MainActivity"); i++) {
    await device.input.press("Back");
    await esperar(1200);
  }
  await page.getByText("GALERIA").tap();
  await esperar(3000);
  const focoGaleria = await foco();
  await tela(device, page, "06-galeria");
  registrar(
    "GALERIA abre o seletor do sistema",
    !focoGaleria.includes(`${PKG}/${PKG}.MainActivity`),
    focoGaleria,
  );
  for (let i = 0; i < 3 && !(await foco()).includes("MainActivity"); i++) {
    await device.input.press("Back");
    await esperar(1200);
  }
  registrar("volta ao app depois do seletor", (await foco()).includes("MainActivity"));

  // 8. Offline: contar sem internet, fechar o app, reabrir sem internet, dados continuam
  await page.evaluate(() => {
    window.__cr.rede.offline = true;
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByTestId("aviso-offline").waitFor({ timeout: 10_000 });
  for (const q of ["3", "4"]) {
    await campo.fill(q);
    await page.getByRole("button", { name: "CONFIRMAR" }).tap();
    await esperar(600);
  }
  registrar("contagem offline", (await page.getByTestId("progresso").textContent()) === "3 / 33");
  await tela(device, page, "07-offline");

  page = await abrirApp(device, "&offline=1"); // fecha e reabre o app, ainda sem internet
  await page.getByTestId("item-atual").waitFor({ timeout: 30_000 });
  registrar(
    "reabrir o app offline mantém as contagens",
    (await page.getByTestId("progresso").textContent()) === "3 / 33",
  );

  // 9. Botão voltar do Android com alterações pendentes: o app sai sem perder nada
  await device.input.press("Back");
  await esperar(1500);
  page = await abrirApp(device, "&offline=0");
  await page.getByTestId("item-atual").waitFor({ timeout: 30_000 });
  registrar(
    "botão voltar + reabrir: nada perdido",
    (await page.getByTestId("progresso").textContent()) === "3 / 33",
  );

  // 10. Internet volta: sincroniza e o servidor recebe tudo
  await page.getByRole("button", { name: "SINCRONIZAR AGORA" }).first().tap();
  let enviados = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.__cr.motor.sincronizarAgora());
    const fila = await page.evaluate(async () => (await window.__cr.motor.fila()).length);
    if (fila === 0) break;
    await esperar(1000);
  }
  const [c] = await sql(
    "SELECT count(*)::int AS n FROM conferencia_itens i JOIN conferencias c ON c.id = i.conferencia_id WHERE c.unidade_id = $1 AND c.status = 'em_andamento' AND i.quantidade_contada IS NOT NULL",
    [LISTA],
  );
  enviados = c.n;
  registrar("sincronização após voltar a internet", enviados === 3, { enviados });
  await tela(device, page, "08-sincronizado");
}

main()
  .catch((e) => {
    registrar("execução", false, String(e?.stack ?? e));
  })
  .finally(() => {
    writeFileSync(path.join(SAIDA, "resultado.json"), JSON.stringify(resultado, null, 2));
    console.log(JSON.stringify(resultado.aparelho ?? {}, null, 2));
    process.exit(resultado.ok ? 0 : 1);
  });
