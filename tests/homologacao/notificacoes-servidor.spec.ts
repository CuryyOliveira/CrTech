/**
 * Homologação das notificações disparadas pelo SERVIDOR (ponta a ponta, tudo local):
 * Supabase local (pg_net + pg_cron) → hook real do app (/api/public/hooks/notificacoes) →
 * provedor de e-mail SIMULADO (servidor HTTP deste teste no lugar do Brevo).
 *
 * O "aparelho" só grava os eventos da conferência e não faz mais nada: é o cenário do
 * aplicativo fechado logo depois de finalizar.
 *
 * Requer o app V2 (porta 3101) iniciado com:
 *   BREVO_API_KEY=teste BREVO_API_URL=http://127.0.0.1:3999/v3/smtp/email
 * e HOMOLOG_EMAIL_SIMULADO=1 (senão o arquivo é ignorado).
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { SENHA, URL_SUPABASE, encerrar, sql } from "./ambiente";
import { LISTAS, semear, type Usuarios } from "./semear";

test.skip(
  process.env.HOMOLOG_EMAIL_SIMULADO !== "1",
  "precisa do app com o provedor de e-mail simulado",
);

const DESTINOS = ["lucasaranttess@gmail.com", "lucas.oliveira@alcoeste.com"];
const PORTA_EMAIL = 3999;
const APP_PARA_O_BANCO = process.env.HOMOLOG_APP_PARA_O_BANCO ?? "http://172.18.0.1:3101";
const APP = process.env.HOMOLOG_APP_V2 ?? "http://localhost:3101";

type Email = { para: string; assunto: string; html: string; texto: string; em: number };
const recebidos: Email[] = [];
let falharProximos = 0;
let servidorEmail: http.Server;
let u: Usuarios;
let segredo: string;

async function configurarBanco(appUrl: string) {
  await sql("UPDATE app_private.config_servidor SET valor = $1 WHERE chave = 'app_url'", [appUrl]);
  await sql(
    `SELECT cron.schedule('notificacoes-pendentes', '*/2 * * * *', format($f$
       select net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','x-hook-secret',%L),
                            body:='{}'::jsonb, timeout_milliseconds:=60000) $f$,
       $1::text || '/api/public/hooks/notificacoes',
       (SELECT valor FROM app_private.hook_secrets WHERE nome = 'notificacoes')))`,
    [appUrl],
  );
}

test.beforeAll(async () => {
  servidorEmail = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      if (falharProximos > 0) {
        falharProximos--;
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "invalid_parameter", message: "falha simulada" }));
        return;
      }
      const b = JSON.parse(corpo) as {
        to: { email: string }[];
        subject: string;
        htmlContent: string;
        textContent: string;
      };
      recebidos.push({
        para: b.to[0].email,
        assunto: b.subject,
        html: b.htmlContent,
        texto: b.textContent,
        em: Date.now(),
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ messageId: randomUUID() }));
    });
  });
  await new Promise<void>((r) => servidorEmail.listen(PORTA_EMAIL, "0.0.0.0", r));

  u = await semear();
  await sql(
    `INSERT INTO configuracoes_sistema (chave, valor) VALUES ('emails_conferencia', $1)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [
      JSON.stringify({
        ativo: true,
        destinatarios: DESTINOS,
        remetente: "nao-responda@conferenciarapida.com.br",
        sender_domain: "conferenciarapida.com.br",
        validado_em: new Date().toISOString(),
        validado_por: DESTINOS[0],
        ultimo_erro: null,
      }),
    ],
  );
  await sql(
    "UPDATE unidades SET frota = 'FR-1204', setor = 'Oficina Central', gestor = NULL WHERE id = $1",
    [LISTAS.pequena.id],
  );
  [{ valor: segredo }] = await sql<{ valor: string }>(
    "SELECT valor FROM app_private.hook_secrets WHERE nome = 'notificacoes'",
  );
  await configurarBanco(APP_PARA_O_BANCO);
});

test.afterAll(async () => {
  await sql(
    "UPDATE app_private.config_servidor SET valor = 'https://conferenciarapida.com.br' WHERE chave = 'app_url'",
  );
  await new Promise((r) => servidorEmail.close(r));
  await encerrar();
});

/** Cliente do "aparelho": só grava eventos (como a fila V2) e não chama mais nada. */
async function aparelho() {
  const c = createClient(URL_SUPABASE, process.env.HOMOLOG_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: u.conferenteA.email,
    password: SENHA,
  });
  if (error) throw error;
  return async (eventos: Record<string, unknown>[]) => {
    const { data, error: e } = await c.rpc("processar_eventos_conferencia", { _eventos: eventos });
    if (e) throw e;
    return data as { status: string }[];
  };
}

function ev(
  tipo: string,
  conf: string,
  payload: Record<string, unknown> = {},
  quando = new Date(),
) {
  return {
    event_id: randomUUID(),
    conference_id: conf,
    device_id: "aparelho-homologacao",
    event_type: tipo,
    created_at_device: quando.toISOString(),
    schema_version: 1,
    payload,
  };
}
const ASSINATURA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const daConferencia = (conf: string, filtro: RegExp) =>
  recebidos.filter((e) => e.html.includes(conf) && filtro.test(e.assunto));

async function esperarEmails(conf: string, filtro: RegExp, total: number, timeout = 30_000) {
  await expect.poll(() => daConferencia(conf, filtro).length, { timeout }).toBe(total);
  await new Promise((r) => setTimeout(r, 3000)); // janela para detectar duplicados
  expect(daConferencia(conf, filtro)).toHaveLength(total);
  expect(
    daConferencia(conf, filtro)
      .map((e) => e.para)
      .sort(),
  ).toEqual([...DESTINOS].sort());
}

async function chamarHook(corpo: Record<string, unknown>) {
  const r = await fetch(`${APP}/api/public/hooks/notificacoes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hook-secret": segredo },
    body: JSON.stringify(corpo),
  });
  expect(r.status).toBe(200);
  return r.json();
}

async function itensDa(conf: string) {
  return sql<{ id: string; quantidade_esperada: number }>(
    "SELECT id, quantidade_esperada FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conf],
  );
}

test("início e término enviados pelo servidor com o aplicativo fechado; conteúdo completo", async () => {
  const enviarEventos = await aparelho();
  const conf = randomUUID();
  const r1 = await enviarEventos([
    ev("CONFERENCE_CREATED", conf, {
      unidade_id: LISTAS.pequena.id,
      conferente: "Lenílson Conferente",
      responsavel: "Fernando Responsável",
    }),
  ]);
  expect(r1[0].status).toBe("aplicado");
  // Nada mais é chamado pelo aparelho: o e-mail sai pelo banco → servidor.
  await esperarEmails(conf, /iniciada/i, 2);
  const ini = daConferencia(conf, /iniciada/i)[0].texto;
  // Texto do e-mail: cada rótulo seguido do seu valor.
  const par = (rotulo: string, valor: string | number) =>
    expect(ini).toMatch(
      new RegExp(`${rotulo}\\s+${String(valor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  par("Status", "Em andamento");
  par("Responsável", "Fernando Responsável");
  par("Conferente", "Lenílson Conferente");
  par("Lista", LISTAS.pequena.nome);
  par("Unidade/Local", "Empresa Homologação");
  expect(ini).toContain("Oficina Central");
  par("Frota", "FR-1204");
  expect(ini).toMatch(/Início\s+\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  par("Término", "Em andamento");
  par("Quantidade de itens", LISTAS.pequena.itens);
  par("Divergências", 0);

  const itens = await itensDa(conf);
  const contagens = itens.map((i, k) =>
    ev("ITEM_COUNTED", conf, {
      item_id: i.id,
      quantidade: k === 0 ? i.quantidade_esperada + 2 : i.quantidade_esperada,
    }),
  );
  await enviarEventos([
    ...contagens,
    ev("SIGNATURE_ADDED", conf, { imagem: ASSINATURA }),
    ev("CONFERENCE_FINALIZED", conf),
  ]);
  // Aplicativo "fechado" aqui: nenhuma outra chamada do aparelho.
  await esperarEmails(conf, /conclu/i, 2);
  await esperarEmails(conf, /diverg/i, 2);
  const fim = daConferencia(conf, /conclu/i)[0].texto;
  for (const t of [
    "Status",
    "Concluída",
    "Responsável",
    "Fernando Responsável",
    "Conferente",
    "Lenílson Conferente",
    "Lista",
    LISTAS.pequena.nome,
    "Unidade/Local",
    "Oficina Central",
    "Frota",
    "FR-1204",
    "Início",
    "Término",
    "Tempo total",
    "Quantidade de itens",
    "Divergências",
    "Itens com divergência",
  ]) {
    expect(fim.toLowerCase()).toContain(t.toLowerCase());
  }
  expect(fim).toMatch(/Esperada: \d+ · Encontrada: \d+ · Diferença: [+-]?\d+/);
  const [n] = await sql<{ email_status: string }>(
    "SELECT email_status FROM notificacoes_conferencia WHERE conferencia_id = $1 AND tipo = 'conferencia_concluida'",
    [conf],
  );
  expect(n.email_status).toBe("enviado");
});

test("duplicidade: reenvio do evento, hook repetido e simultâneo e agendador não duplicam e-mails", async () => {
  const enviarEventos = await aparelho();
  const conf = randomUUID();
  const criar = ev("CONFERENCE_CREATED", conf, {
    unidade_id: LISTAS.pequena.id,
    conferente: "Ana",
    responsavel: "Bruno",
  });
  await enviarEventos([criar]);
  await enviarEventos([criar]); // retry do mesmo evento (resposta perdida)
  await esperarEmails(conf, /iniciada/i, 2);
  const itens = await itensDa(conf);
  const fin = ev("CONFERENCE_FINALIZED", conf);
  await enviarEventos([
    ...itens.map((i) =>
      ev("ITEM_COUNTED", conf, { item_id: i.id, quantidade: i.quantidade_esperada }),
    ),
    ev("SIGNATURE_ADDED", conf, { imagem: ASSINATURA }),
    fin,
  ]);
  await enviarEventos([fin]); // retry/timeout da finalização
  await esperarEmails(conf, /conclu/i, 2);

  const ids = await sql<{ id: string }>(
    "SELECT id FROM notificacoes_conferencia WHERE conferencia_id = $1",
    [conf],
  );
  // 5 chamadas simultâneas por notificação + 3 varreduras do agendador.
  await Promise.all([
    ...ids.flatMap((n) => [1, 2, 3, 4, 5].map(() => chamarHook({ id: n.id }))),
    chamarHook({}),
    chamarHook({}),
    chamarHook({}),
  ]);
  await esperarEmails(conf, /iniciada/i, 2);
  await esperarEmails(conf, /conclu/i, 2);
  expect(daConferencia(conf, /diverg/i)).toHaveLength(0); // sem divergências
});

test("retry: falha do provedor em um destinatário é reenviada só para ele pelo agendador", async () => {
  const enviarEventos = await aparelho();
  const conf = randomUUID();
  const itensAntes = recebidos.length;
  falharProximos = 1; // primeiro e-mail (primeiro destinatário) falha
  await enviarEventos([
    ev("CONFERENCE_CREATED", conf, {
      unidade_id: LISTAS.pequena.id,
      conferente: "Caio",
      responsavel: "Dora",
    }),
  ]);
  await expect
    .poll(async () => {
      const [n] = await sql<{ email_status: string }>(
        "SELECT email_status FROM notificacoes_conferencia WHERE conferencia_id = $1",
        [conf],
      );
      return n?.email_status;
    })
    .toBe("falha");
  expect(daConferencia(conf, /iniciada/i)).toHaveLength(1);
  await chamarHook({}); // varredura do agendador
  await esperarEmails(conf, /iniciada/i, 2);
  expect(recebidos.length - itensAntes).toBe(2);
  await enviarEventos([ev("CONFERENCE_CANCELLED", conf, { motivo: "fim do teste de retry" })]);
});

test("offline: conferência feita sem internet e sincronizada depois — horários do aparelho", async () => {
  const enviarEventos = await aparelho();
  const conf = randomUUID();
  const t0 = new Date(Date.now() - 2 * 3600_000);
  const minutos = (m: number) => new Date(t0.getTime() + m * 60_000);
  const [mat] = await sql<{ id: string; quantidade_esperada: number }>(
    "SELECT id, quantidade_esperada FROM materiais WHERE unidade_id = $1 ORDER BY codigo LIMIT 1",
    [LISTAS.pequena.id],
  );
  await enviarEventos([
    ev(
      "CONFERENCE_CREATED",
      conf,
      { unidade_id: LISTAS.pequena.id, conferente: "Eva", responsavel: "Fábio" },
      t0,
    ),
    ev(
      "ITEM_COUNTED",
      conf,
      { material_id: mat.id, quantidade: mat.quantidade_esperada },
      minutos(3),
    ),
    ev("SIGNATURE_ADDED", conf, { imagem: ASSINATURA }, minutos(14)),
    ev("CONFERENCE_FINALIZED", conf, {}, minutos(15)),
  ]);
  await esperarEmails(conf, /iniciada/i, 2);
  await esperarEmails(conf, /conclu/i, 2);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(d)
      .replace(",", "");
  const fim = daConferencia(conf, /conclu/i)[0].texto;
  expect(fim).toContain(fmt(t0));
  expect(fim).toContain(fmt(minutos(15)));
  expect(fim).toContain("15min");
});

test("queda do servidor no momento da finalização: o agendador (pg_cron) entrega depois", async () => {
  test.setTimeout(300_000);
  const enviarEventos = await aparelho();
  const conf = randomUUID();
  // Servidor inacessível: o pedido imediato do banco se perde.
  await sql(
    "UPDATE app_private.config_servidor SET valor = 'http://172.18.0.1:9' WHERE chave = 'app_url'",
  );
  await enviarEventos([
    ev("CONFERENCE_CREATED", conf, {
      unidade_id: LISTAS.pequena.id,
      conferente: "Gil",
      responsavel: "Hana",
    }),
  ]);
  await new Promise((r) => setTimeout(r, 5000));
  expect(daConferencia(conf, /iniciada/i)).toHaveLength(0);
  // O servidor volta; ninguém chama nada: o pg_cron (a cada 2 min) processa a pendência.
  await sql("UPDATE app_private.config_servidor SET valor = $1 WHERE chave = 'app_url'", [
    APP_PARA_O_BANCO,
  ]);
  await esperarEmails(conf, /iniciada/i, 2, 170_000);
  await enviarEventos([ev("CONFERENCE_CANCELLED", conf, { motivo: "fim do teste de queda" })]);
});
