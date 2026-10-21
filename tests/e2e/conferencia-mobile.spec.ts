/**
 * V2.1 — conferência mobile no navegador real (Chromium, perfil Pixel 5: tela pequena, toque),
 * motor V2 real (IndexedDB) e servidor de TESTE real (Postgres com as migrations).
 */
import { expect, test } from "@playwright/test";
import {
  abrirConferencia,
  conferenciaNoServidor,
  contar,
  esperarSincronizado,
  offline,
  PNG_1X1,
  prepararBanco,
  sincronizar,
  sql,
} from "./apoio";

test.beforeEach(async () => {
  await prepararBanco(20);
});

test("abre a conferência, carrega os itens e mostra o progresso", async ({ page }) => {
  await abrirConferencia(page);
  await expect(page.getByTestId("progresso")).toHaveText("0 / 23");
  await expect(page.getByTestId("qtd-pendentes")).toHaveText("23");
  await expect(page.getByTestId("posicao")).toHaveText("Item 1 de 23");
  // Localização em destaque, código e esperado visíveis sem abrir menus.
  await expect(page.getByTestId("localizacao")).toBeVisible();
  await expect(page.getByTestId("codigo-atual")).toBeVisible();
  await expect(page.getByTestId("esperado")).toBeVisible();
  await expect(page.getByTestId("estado-sync")).toBeVisible();
  // A conferência foi criada no servidor pelo evento do aparelho.
  await esperarSincronizado(page);
  expect((await conferenciaNoServidor()).status).toBe("em_andamento");
});

test("conferir: digitar, confirmar e avançar sozinho; aumentar, diminuir e zerar", async ({
  page,
}) => {
  await abrirConferencia(page);
  const primeiro = await page.getByTestId("codigo-atual").textContent();
  const esperado = await page.getByTestId("esperado").textContent();
  await contar(page, esperado!.trim());
  // Foi para o próximo item e o progresso atualizou na hora.
  await expect(page.getByTestId("codigo-atual")).not.toHaveText(primeiro!);
  await expect(page.getByTestId("progresso")).toHaveText("1 / 23");
  await expect(page.getByTestId("qtd-conferidos")).toHaveText("1");

  const campo = page.getByLabel("QUANTIDADE CONFERIDA");
  await page.getByRole("button", { name: "Aumentar 1" }).click();
  await page.getByRole("button", { name: "Aumentar 1" }).click();
  await expect(campo).toHaveValue("2");
  await page.getByRole("button", { name: "Diminuir 1" }).click();
  await expect(campo).toHaveValue("1");
  await page.getByRole("button", { name: "ZERAR" }).click();
  await expect(campo).toHaveValue("0");
  await campo.fill("abc");
  await expect(campo).toHaveValue(""); // só aceita números
  await campo.fill("1,5");
  await expect(campo).toHaveValue("1,5");

  // Voltar funciona e mostra o valor salvo.
  await page.getByRole("button", { name: "Item anterior" }).click();
  await expect(page.getByTestId("codigo-atual")).toHaveText(primeiro!);
  await expect(campo).toHaveValue(esperado!.trim());
});

test("divergência mostra ESPERADO, CONFERIDO e DIFERENÇA na própria tela", async ({ page }) => {
  await abrirConferencia(page);
  const esperado = Number((await page.getByTestId("esperado").textContent())!.replace(",", "."));
  await page.getByLabel("QUANTIDADE CONFERIDA").fill(String(esperado + 3));
  const div = page.getByTestId("divergencia");
  await expect(div).toBeVisible();
  await expect(page.getByTestId("diferenca")).toHaveText("+3");
  await page.getByRole("button", { name: "Adicionar observação" }).click();
  await page.getByLabel("Observação").fill("Caixa extra no fundo da prateleira");
  await page.getByRole("button", { name: "CONFIRMAR" }).click();
  await expect(page.getByTestId("qtd-divergencias")).toHaveText("1");
  await esperarSincronizado(page);
  const [i] = await sql<{ status: string; observacoes: string }>(
    "SELECT status, observacoes FROM conferencia_itens WHERE conferencia_id = $1 AND observacoes IS NOT NULL",
    [(await conferenciaNoServidor()).id],
  );
  expect(i).toEqual({ status: "divergencia", observacoes: "Caixa extra no fundo da prateleira" });
});

test("busca por código parcial, descrição e localização; leitor de código (Enter)", async ({
  page,
}) => {
  await abrirConferencia(page);
  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  const busca = page.getByLabel("Buscar por código, descrição ou localização");
  await busca.fill("0007");
  await expect(page.getByTestId("lista-itens").getByRole("option")).toHaveCount(1);
  await busca.fill("teste 1");
  await expect(page.getByTestId("lista-itens").getByRole("option")).not.toHaveCount(0);
  await busca.fill("C02-P");
  await expect(page.getByTestId("lista-itens").getByRole("option").first()).toContainText("C02-P");
  await page.getByRole("button", { name: "Limpar busca" }).click();
  // Leitor: código completo + Enter abre o item e deixa o campo pronto para a próxima leitura.
  await busca.fill("E-0015");
  await busca.press("Enter");
  await expect(page.getByTestId("codigo-atual")).toHaveText("E-0015");
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeFocused();
});

test("filtros rápidos: pendentes, conferidos, divergências, adicionados", async ({ page }) => {
  await abrirConferencia(page);
  const esperado = (await page.getByTestId("esperado").textContent())!.trim();
  await contar(page, esperado); // conferido
  await contar(page, "999"); // divergência
  await page.getByRole("button", { name: /Ver lista de itens/ }).click();
  const filtro = (nome: RegExp) => page.getByRole("radio", { name: nome });
  const linhas = page.getByTestId("lista-itens").getByRole("option");
  await filtro(/^Conferidos/).click();
  await expect(linhas).toHaveCount(1);
  await filtro(/^Divergências/).click();
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toContainText("DIVERGÊNCIA");
  await filtro(/^Pendentes/).click();
  await expect(filtro(/^Pendentes/)).toHaveAccessibleName("Pendentes 21");
  await expect(linhas.first()).toContainText("PENDENTE");
  await filtro(/^Adicionados/).click();
  await expect(linhas).toHaveCount(0);
  await expect(page.getByText("Nenhum item encontrado.")).toBeVisible();
});

test("adicionar material: pesquisa antes, evita duplicidade, inclui com localização (evento V2)", async ({
  page,
}) => {
  await abrirConferencia(page);
  await page.getByRole("button", { name: "ADICIONAR MATERIAL" }).click();
  const dialogo = page.getByRole("dialog");
  // Já está na conferência: oferece ir para o item (não duplica).
  await dialogo.getByLabel("Pesquisar material por código ou descrição").fill("E-0003");
  await expect(dialogo.getByText("JÁ ESTÁ NESTA CONFERÊNCIA")).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "ADICIONAR À CONFERÊNCIA" })).toBeDisabled();
  // Material fora da lista e do cadastro: inclusão manual.
  await dialogo.getByLabel("Pesquisar material por código ou descrição").fill("NOVO-77");
  await expect(dialogo.getByText(/Não encontrado/)).toBeVisible();
  await dialogo.getByLabel("Descrição *").fill("Mangueira encontrada");
  await dialogo.getByLabel("Localização").fill("Corredor 09 Prateleira Z");
  await dialogo.getByLabel("Quantidade encontrada *").fill("4");
  await dialogo.getByLabel("Motivo da inclusão *").fill("Estava na prateleira sem cadastro");
  await dialogo.getByRole("button", { name: "ADICIONAR À CONFERÊNCIA" }).click();
  await expect(page.getByTestId("codigo-atual")).toHaveText("NOVO-77");
  await expect(page.getByTestId("item-atual").getByText("ADICIONADO")).toBeVisible();
  await expect(page.getByTestId("progresso")).toHaveText("1 / 24");
  await esperarSincronizado(page);
  const [i] = await sql<{ origem: string; locacao: string; quantidade_contada: string }>(
    "SELECT origem, locacao, quantidade_contada FROM conferencia_itens WHERE codigo = 'NOVO-77'",
  );
  expect(i).toEqual({
    origem: "adicionado",
    locacao: "Corredor 09 Prateleira Z",
    quantidade_contada: "4",
  });
});

test("pausar e retomar pelos eventos do motor: item bloqueado e tempo congelado", async ({
  page,
}) => {
  await abrirConferencia(page);
  await page.getByRole("button", { name: "PAUSAR CONFERÊNCIA" }).click();
  await expect(
    page.getByText("Conferência pausada. Retome para continuar contando."),
  ).toBeVisible();
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeDisabled();
  await expect(page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" })).toBeDisabled();
  await expect(page.getByTestId("tempo")).toContainText("PAUSADA");
  const t1 = await page.getByTestId("tempo").textContent();
  await page.waitForTimeout(2100);
  await expect(page.getByTestId("tempo")).toHaveText(t1!);
  await page.getByRole("button", { name: "RETOMAR CONFERÊNCIA" }).click();
  await expect(page.getByLabel("QUANTIDADE CONFERIDA")).toBeEnabled();
  await esperarSincronizado(page);
  const { id } = await conferenciaNoServidor();
  const [c] = await sql<{ status: string; quantidade_pausas: number }>(
    "SELECT status, quantidade_pausas FROM conferencias WHERE id = $1",
    [id],
  );
  expect(c).toEqual({ status: "em_andamento", quantidade_pausas: 1 });
});

test("offline: continua funcionando, avisa, sobrevive a fechar/abrir o app e sincroniza depois", async ({
  page,
}) => {
  await abrirConferencia(page);
  await esperarSincronizado(page);
  await offline(page, true);
  await expect(page.getByTestId("estado-sync")).toHaveAttribute("data-estado", "OFFLINE");
  await expect(page.getByTestId("aviso-offline")).toHaveText(
    "Trabalhando offline. As alterações serão sincronizadas quando a conexão voltar.",
  );
  for (let i = 0; i < 5; i++) await contar(page, String(i + 1));
  await expect(page.getByTestId("progresso")).toHaveText("5 / 23");
  await expect(page.getByTestId("aguardando-sync")).toContainText("5 alterações");

  // Fecha e abre o "aplicativo" (recarrega a página) ainda sem internet.
  await page.reload();
  await expect(page.getByTestId("progresso")).toHaveText("5 / 23");
  await expect(page.getByTestId("estado-sync")).toHaveAttribute("data-estado", "OFFLINE");

  await offline(page, false);
  await sincronizar(page);
  await esperarSincronizado(page);
  const { id } = await conferenciaNoServidor();
  const [n] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM conferencia_itens WHERE conferencia_id = $1 AND quantidade_contada IS NOT NULL",
    [id],
  );
  expect(n.n).toBe(5);
  await expect(page.getByTestId("aguardando-sync")).toHaveText(
    "Tudo desta conferência foi enviado",
  );
});

test("conflito: mostra MINHA CONTAGEM × CONTAGEM NO SERVIDOR e só muda por decisão", async ({
  page,
}) => {
  await abrirConferencia(page);
  await esperarSincronizado(page);
  const codigo = (await page.getByTestId("codigo-atual").textContent())!.trim();
  await offline(page, true);
  await contar(page, "7");
  // Enquanto isso, o mesmo item é alterado em outro lugar (versão sobe no servidor).
  const { id } = await conferenciaNoServidor();
  await sql(
    "UPDATE conferencia_itens SET quantidade_contada = 9, status = 'divergencia' WHERE conferencia_id = $1 AND codigo = $2",
    [id, codigo],
  );
  await offline(page, false);
  await sincronizar(page);
  await expect(page.getByTestId("aviso-atencao")).toBeVisible();
  await page.getByTestId("aviso-atencao").click();
  const evento = page.getByTestId("evento-atencao");
  await expect(evento).toContainText("Este item também foi alterado em outro dispositivo.");
  await expect(evento.getByTestId("minha-contagem")).toHaveText("7");
  await expect(evento.getByTestId("contagem-servidor")).toHaveText("9");
  // Nada foi sobrescrito ainda.
  const antes = await sql<{ q: string }>(
    "SELECT quantidade_contada AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = $2",
    [id, codigo],
  );
  expect(antes[0].q).toBe("9");
  await evento.getByRole("button", { name: "MANTER MINHA CONTAGEM" }).click();
  // Última pendência resolvida: o painel fecha sozinho.
  await expect(page.getByTestId("evento-atencao")).toHaveCount(0);
  await expect(page.getByTestId("aviso-atencao")).toHaveCount(0);
  await esperarSincronizado(page);
  const depois = await sql<{ q: string }>(
    "SELECT quantidade_contada AS q FROM conferencia_itens WHERE conferencia_id = $1 AND codigo = $2",
    [id, codigo],
  );
  expect(depois[0].q).toBe("7");
});

test("fotos: galeria entra na fila V2, mostra ENVIANDO → ENVIADA e chega ao servidor", async ({
  page,
}) => {
  await abrirConferencia(page);
  await esperarSincronizado(page);
  await offline(page, true);
  await page
    .getByTestId("foto-galeria")
    .setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 });
  const foto = page.getByTestId("foto-item");
  await expect(foto).toHaveAttribute("data-status", "pendente_upload");
  await expect(foto).toContainText("ENVIANDO");
  await offline(page, false);
  await esperarSincronizado(page);
  await expect(foto).toContainText("ENVIADA");
  const [f] = await sql<{ n: number }>("SELECT count(*)::int AS n FROM conferencia_fotos");
  expect(f.n).toBe(1);
  const [o] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'conferencias'",
  );
  expect(o.n).toBe(1);
});

test("finalização offline com assinatura: resumo, nada perdido, idempotente", async ({ page }) => {
  await abrirConferencia(page);
  await esperarSincronizado(page);
  await offline(page, true);
  await contar(page, "1");
  await contar(page, "2");
  await page.getByRole("button", { name: "FINALIZAR CONFERÊNCIA" }).click();
  const resumo = page.getByTestId("resumo-finalizacao");
  await expect(resumo).toContainText("Itens conferidos2");
  await expect(resumo).toContainText("Pendentes21");
  await expect(page.getByTestId("aviso-pendentes-finalizacao")).toBeVisible();
  const finalizar = page.getByRole("button", { name: "ASSINAR E FINALIZAR" });
  await expect(finalizar).toBeDisabled(); // falta a assinatura
  const canvas = page.getByTestId("assinatura-conferente").locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const caixa = (await canvas.boundingBox())!;
  await page.mouse.move(caixa.x + 20, caixa.y + 20);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 120, caixa.y + 60, { steps: 8 });
  await page.mouse.move(caixa.x + 200, caixa.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(finalizar).toBeEnabled();
  await finalizar.click();
  await expect(page.getByTestId("conferencia-encerrada")).toContainText("aguardando sincronização");

  await offline(page, false);
  await esperarSincronizado(page);
  const [c] = await sql<{ status: string; assinada: boolean; n: number }>(
    "SELECT status, assinatura IS NOT NULL AS assinada, (SELECT count(*)::int FROM conferencia_eventos e WHERE e.conferencia_id = c.id AND e.event_type = 'CONFERENCE_FINALIZED') AS n FROM conferencias c WHERE status = 'finalizada' ORDER BY hora_fim DESC LIMIT 1",
  );
  expect(c).toEqual({ status: "finalizada", assinada: true, n: 1 });
  const [h] = await sql<{ quantidade_conferida: string; quantidade_prevista: string }>(
    "SELECT quantidade_conferida, quantidade_prevista FROM historico_conferencias h JOIN conferencias c ON c.id = h.conferencia_id WHERE c.status = 'finalizada' ORDER BY c.hora_fim DESC LIMIT 1",
  );
  expect(Number(h.quantidade_prevista)).toBe(23);
});

test("voltar com alterações não sincronizadas pede confirmação e não apaga nada", async ({
  page,
}) => {
  await abrirConferencia(page);
  await esperarSincronizado(page);
  await offline(page, true);
  await contar(page, "3");
  await page.getByRole("button", { name: "Voltar para a lista" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("Existem alterações ainda não sincronizadas.");
  await dialogo.getByRole("button", { name: "CONTINUAR" }).click();
  await expect(page.getByTestId("item-atual")).toBeVisible();
  await page.getByRole("button", { name: "Voltar para a lista" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "SAIR" }).click();
  await expect(page.getByTestId("saiu")).toBeVisible();
  await page.getByRole("button", { name: "Abrir novamente" }).click();
  await expect(page.getByTestId("progresso")).toHaveText("1 / 23");
});

test("teclado: o campo de quantidade fica visível ao receber foco (celular)", async ({ page }) => {
  await abrirConferencia(page);
  await page.getByRole("button", { name: "Adicionar observação" }).click();
  await page.mouse.wheel(0, 2000); // rola até o fim
  const campo = page.getByLabel("QUANTIDADE CONFERIDA");
  await campo.focus();
  await page.waitForTimeout(700);
  await expect(campo).toBeInViewport({ ratio: 1 });
  // Controles principais com área de toque confortável (≥ 44 px).
  for (const nome of ["CONFIRMAR", "Item anterior", "Próximo item", "Aumentar 1", "Diminuir 1"]) {
    const b = (await page.getByRole("button", { name: nome }).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
});
