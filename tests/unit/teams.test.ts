/**
 * Microsoft Teams: card com o mesmo conteúdo do e-mail, formato esperado pelo fluxo do
 * Power Automate, validação do endereço (segredo nunca exposto) e envio idempotente.
 * Banco e fluxo são simulados; o endereço usado aqui é fictício.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardDaNotificacao,
  CONFIG_TEAMS_PADRAO,
  emailPessoal,
  erroSeguro,
  mascararUrlFluxo,
  motivoParaNaoEnviar,
  normalizarDestinatarios,
  payloadFluxo,
  teamsLiberado,
  validarUrlFluxo,
  type ConfigTeams,
} from "@/lib/teams";
import {
  conteudoNotificacao,
  type NotificacaoConferenciaRow,
} from "@/lib/notificacoes-conferencia";

const URL_FLUXO =
  "https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ASSINATURA-SECRETA";
const URL_PP =
  "https://default1234.56.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=OUTRA-ASSINATURA";

// ---------- Banco simulado (funções do servidor) ----------
const sim = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  notificacao: null as Record<string, unknown> | null,
  reserva: true,
  chamadas: [] as { fn: string; args: Record<string, unknown> | undefined }[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      sim.chamadas.push({ fn, args });
      if (fn === "teams_config_obter") return { data: [sim.config], error: null };
      if (fn === "teams_config_salvar") {
        const patch = (args?._patch ?? {}) as Record<string, unknown>;
        if ("webhook_url" in patch && patch.webhook_url !== sim.config.webhook_url) {
          Object.assign(sim.config, { validado_em: null, validado_por: null, liberado_em: null });
        }
        Object.assign(sim.config, patch);
        return { data: null, error: null };
      }
      if (fn === "reservar_envio_teams") return { data: sim.reserva, error: null };
      if (fn === "teams_envios_recentes") return { data: [], error: null };
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: sim.notificacao, error: null }) }),
      }),
    }),
  },
}));

function notificacao(extra: Partial<NotificacaoConferenciaRow> = {}): NotificacaoConferenciaRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    conferencia_id: "conf-1",
    unidade_id: null,
    tipo: "conferencia_concluida",
    user_id: "u1",
    usuario_nome: "Lenílson",
    usuario_email: null,
    matricula: "123",
    frota: "FR-1204",
    local: "Oficina",
    modulo: null,
    data: "2026-10-21",
    hora: "09:30",
    status: "concluida",
    email_status: "enviado",
    assunto: null,
    mensagem: null,
    payload: {
      responsavel: "Fernando",
      conferente: "Lenílson",
      lista: "ABRASIVOS",
      previstos: 10,
      corretos: 8,
      divergentes: 2,
      inicio: "21/10/2026 09:00",
      fim: "21/10/2026 09:30",
      duracao: "30min 0s",
      divergencias: [
        { codigo: "P01", descricao: "Lixa 80", esperada: 10, encontrada: 7 },
        { codigo: "P02", descricao: "Lixa 120", esperada: 4, encontrada: 6 },
      ],
    },
    tipo_conferencia: "Completa",
    gravidade: "sucesso",
    tentativas: 0,
    ultima_tentativa: null,
    created_at: "2026-10-21T12:30:00.000Z",
    ...extra,
  };
}

function cfgLiberada(extra: Partial<ConfigTeams> = {}): ConfigTeams {
  return {
    ...CONFIG_TEAMS_PADRAO,
    webhook_url: URL_FLUXO,
    destinatarios: ["lucas.oliveira@alcoeste.com", "fernando.guedis@alcoeste.com"],
    validado_em: "2026-10-21T10:00:00.000Z",
    validado_por: "lucas.oliveira@alcoeste.com",
    liberado_em: "2026-10-21T10:00:00.000Z",
    ...extra,
  };
}

function fetchOk(status = 202) {
  return vi.fn(async (..._a: unknown[]) => new Response("", { status }));
}

beforeEach(() => {
  sim.config = { ...cfgLiberada() };
  sim.notificacao = notificacao() as unknown as Record<string, unknown>;
  sim.reserva = true;
  sim.chamadas = [];
});

describe("endereço do fluxo", () => {
  it("aceita os dois formatos do Power Automate (Logic Apps e Power Platform)", () => {
    expect(validarUrlFluxo(URL_FLUXO)).toMatchObject({ ok: true });
    expect(validarUrlFluxo(`  ${URL_PP}  `)).toMatchObject({ ok: true });
  });

  it("recusa http, outros domínios, endereço sem assinatura e texto inválido", () => {
    expect(validarUrlFluxo(URL_FLUXO.replace("https://", "http://")).ok).toBe(false);
    expect(validarUrlFluxo("https://evil.example.com/workflows/x?sig=abc").ok).toBe(false);
    expect(validarUrlFluxo("https://logic.azure.com.evil.com/x?sig=abc").ok).toBe(false);
    expect(validarUrlFluxo(URL_FLUXO.replace(/&sig=.*/, "")).ok).toBe(false);
    expect(validarUrlFluxo("não é url").ok).toBe(false);
    expect(validarUrlFluxo("").ok).toBe(false);
  });

  it("a versão exibível nunca contém a assinatura", () => {
    const m = mascararUrlFluxo(URL_FLUXO)!;
    expect(m).toBe("prod-12.westus.logic.azure.com/…");
    expect(m).not.toContain("ASSINATURA");
    expect(mascararUrlFluxo(null)).toBeNull();
  });

  it("mensagens de erro gravadas/exibidas nunca contêm o endereço", () => {
    const e = erroSeguro(`Falha ao chamar ${URL_FLUXO}: HTTP 500`);
    expect(e).not.toContain("ASSINATURA");
    expect(e).toContain("[endereço do fluxo]");
  });
});

describe("destinatários", () => {
  it("normaliza: minúsculas, sem espaços, sem repetição, só e-mails válidos", () => {
    expect(
      normalizarDestinatarios([
        " Lucas.Oliveira@alcoeste.com",
        "lucas.oliveira@alcoeste.com",
        "x",
        "",
      ]),
    ).toEqual(["lucas.oliveira@alcoeste.com"]);
  });
  it("identifica e-mail pessoal (não recebe Teams da organização)", () => {
    expect(emailPessoal("lucasaranttess@gmail.com")).toBe(true);
    expect(emailPessoal("fernando.guedis@alcoeste.com")).toBe(false);
  });
});

describe("card: mesmo conteúdo do e-mail", () => {
  it("título, introdução e todas as linhas do e-mail, na mesma ordem", () => {
    const n = notificacao();
    const c = conteudoNotificacao(n);
    const card = cardDaNotificacao(n, {
      painelUrl: "https://conferenciarapida.com.br/admin/notificacoes",
    });
    const json = JSON.stringify(card);
    expect(json).toContain(c.titulo);
    expect(json).toContain(c.intro);
    const factset = (
      card.body as { type: string; facts?: { title: string; value: string }[] }[]
    ).find((b) => b.type === "FactSet")!;
    expect(factset.facts).toEqual(c.linhas.map((l) => ({ title: l.rotulo, value: l.valor })));
    expect(card).toMatchObject({ type: "AdaptiveCard", version: "1.4" });
    expect(card.actions).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Abrir no sistema",
        url: "https://conferenciarapida.com.br/admin/notificacoes",
      },
    ]);
  });

  it("divergências com esperada, encontrada e diferença; excesso resumido", () => {
    const card = cardDaNotificacao(notificacao(), { painelUrl: "https://x" });
    const json = JSON.stringify(card);
    expect(json).toContain("Divergências (2)");
    expect(json).toContain("P01 — Lixa 80");
    expect(json).toContain("esperada 10 · encontrada 7 · diferença -3");
    expect(json).toContain("diferença +2");

    const muitas = Array.from({ length: 30 }, (_, i) => ({
      codigo: `C${i}`,
      descricao: "Item",
      esperada: 1,
      encontrada: 0,
    }));
    const grande = cardDaNotificacao(
      notificacao({ payload: { ...notificacao().payload, divergencias: muitas } }),
      { painelUrl: "https://x" },
    );
    expect(JSON.stringify(grande)).toContain("+ 5 item(ns)");
  });

  it("cores por gravidade, prefixo de teste e textos longos cortados", () => {
    const critica = cardDaNotificacao(
      notificacao({ tipo: "divergencia_estoque", gravidade: "critica" }),
      {
        painelUrl: "https://x",
      },
    );
    expect((critica.body as { style?: string }[])[0].style).toBe("attention");
    const teste = cardDaNotificacao(
      notificacao({ tipo: "conferencia_iniciada", gravidade: "info" }),
      {
        painelUrl: "https://x",
        teste: true,
      },
    );
    expect(JSON.stringify(teste)).toContain("TESTE — Nova conferência iniciada");
    const erro = cardDaNotificacao(
      notificacao({ tipo: "erro_conferencia", payload: { stack: "x".repeat(5000) } }),
      { painelUrl: "https://x" },
    );
    expect(JSON.stringify(erro).length).toBeLessThan(4000);
  });

  it("corpo enviado ao fluxo: o card em attachments[0].content e a lista de destinatários", () => {
    const card = cardDaNotificacao(notificacao(), { painelUrl: "https://x" });
    const p = payloadFluxo(card, ["a@alcoeste.com"]);
    // Expressões do fluxo: triggerBody()?['attachments']?[0]?['content'] e triggerBody()?['destinatarios']
    expect(p.attachments[0].content).toBe(card);
    expect(p.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(p.destinatarios).toEqual(["a@alcoeste.com"]);
    expect(p.type).toBe("message");
  });
});

describe("liberação dos disparos", () => {
  it("só com endereço, teste aprovado, destinatários e canal ativo", () => {
    expect(teamsLiberado(cfgLiberada())).toBe(true);
    expect(teamsLiberado(cfgLiberada({ webhook_url: null }))).toBe(false);
    expect(teamsLiberado(cfgLiberada({ validado_em: null }))).toBe(false);
    expect(teamsLiberado(cfgLiberada({ destinatarios: [] }))).toBe(false);
    expect(teamsLiberado(cfgLiberada({ ativo: false }))).toBe(false);
  });
  it("notificações anteriores à liberação não vão ao Teams", () => {
    expect(motivoParaNaoEnviar(cfgLiberada(), "2026-10-21T09:59:00Z")).toBe("anterior_liberacao");
    expect(motivoParaNaoEnviar(cfgLiberada(), "2026-10-21T10:01:00Z")).toBeNull();
    expect(motivoParaNaoEnviar(cfgLiberada({ ativo: false }), null)).toBe("desativado");
    expect(motivoParaNaoEnviar(cfgLiberada({ validado_em: null }), null)).toBe("nao_configurado");
  });
});

describe("envio pelo servidor", () => {
  it("liberado: um POST ao fluxo com o card e os destinatários; registra enviado", async () => {
    const { enviarTeamsNotificacao } = await import("@/lib/teams-envio.server");
    const f = fetchOk();
    const r = await enviarTeamsNotificacao("11111111-1111-1111-1111-111111111111", f as never);
    expect(r).toMatchObject({ ok: true, status: "enviado" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_FLUXO);
    expect(init.method).toBe("POST");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.destinatarios).toEqual([
      "lucas.oliveira@alcoeste.com",
      "fernando.guedis@alcoeste.com",
    ]);
    expect(corpo.attachments[0].content.type).toBe("AdaptiveCard");
    expect(sim.chamadas.find((c) => c.fn === "concluir_envio_teams")?.args).toMatchObject({
      _enviado: true,
    });
  });

  it("já enviado/em envio (reserva negada): não chama o fluxo de novo", async () => {
    const { enviarTeamsNotificacao } = await import("@/lib/teams-envio.server");
    sim.reserva = false;
    const f = fetchOk();
    const r = await enviarTeamsNotificacao("x", f as never);
    expect(r.status).toBe("ja_processado");
    expect(f).not.toHaveBeenCalled();
  });

  it("não configurado, desativado ou notificação antiga: não reserva nem envia", async () => {
    const { enviarTeamsNotificacao } = await import("@/lib/teams-envio.server");
    const f = fetchOk();
    sim.config = { ...cfgLiberada({ validado_em: null }) };
    expect((await enviarTeamsNotificacao("x", f as never)).status).toBe("nao_configurado");
    sim.config = { ...cfgLiberada({ ativo: false }) };
    expect((await enviarTeamsNotificacao("x", f as never)).status).toBe("desativado");
    sim.config = { ...cfgLiberada() };
    sim.notificacao = notificacao({ created_at: "2026-10-20T00:00:00Z" }) as never;
    expect((await enviarTeamsNotificacao("x", f as never)).status).toBe("anterior_liberacao");
    expect(f).not.toHaveBeenCalled();
    expect(sim.chamadas.some((c) => c.fn === "reservar_envio_teams")).toBe(false);
  });

  it("fluxo recusa (404/401) ou não responde: falha registrada sem o endereço e sem lançar", async () => {
    const { enviarTeamsNotificacao } = await import("@/lib/teams-envio.server");
    const f404 = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "WorkflowNotFound" } }), { status: 404 }),
    );
    const r = await enviarTeamsNotificacao("x", f404 as never);
    expect(r).toMatchObject({ ok: false, status: "falha" });
    expect(r.erro).toContain("HTTP 404");
    expect(r.erro).not.toContain("ASSINATURA");
    expect(sim.chamadas.find((c) => c.fn === "concluir_envio_teams")?.args).toMatchObject({
      _enviado: false,
    });

    const f401 = vi.fn(async () => new Response("", { status: 401 }));
    expect((await enviarTeamsNotificacao("x", f401 as never)).erro).toContain("Anyone");

    const fRede = vi.fn(async () => {
      throw Object.assign(new Error(`connect ${URL_FLUXO}`), { name: "TimeoutError" });
    });
    const rr = await enviarTeamsNotificacao("x", fRede as never);
    expect(rr.erro).toBe("O fluxo do Teams não respondeu a tempo.");
  });
});

describe("configuração e teste de conexão", () => {
  it("salvar: recusa endereço inválido e normaliza destinatários", async () => {
    const { salvarConfigTeams } = await import("@/lib/teams-envio.server");
    await expect(
      salvarConfigTeams({ webhookUrl: "https://evil.example.com/x?sig=1" }),
    ).rejects.toThrow(/Power Automate/);
    await expect(salvarConfigTeams({ destinatarios: ["nao-e-email"] })).rejects.toThrow(/inválido/);
    const s = await salvarConfigTeams({ destinatarios: [" A@alcoeste.com", "a@alcoeste.com"] });
    expect(s.destinatarios).toEqual(["a@alcoeste.com"]);
    // O status devolvido ao navegador nunca traz o endereço completo.
    expect(JSON.stringify(s)).not.toContain("ASSINATURA");
    expect(s.urlMascarada).toBe("prod-12.westus.logic.azure.com/…");
  });

  it("teste aprovado valida e libera; teste reprovado bloqueia de novo", async () => {
    const { testarConexaoTeams } = await import("@/lib/teams-envio.server");
    sim.config = { ...cfgLiberada({ validado_em: null, liberado_em: null }) };
    const ok = await testarConexaoTeams(null, fetchOk() as never);
    expect(ok.ok).toBe(true);
    expect(sim.config.validado_em).toBeTruthy();
    expect(sim.config.liberado_em).toBeTruthy();
    expect(sim.chamadas.find((c) => c.fn === "registrar_teste_teams")?.args).toMatchObject({
      _enviado: true,
    });

    const falha = await testarConexaoTeams(
      null,
      vi.fn(async () => new Response("", { status: 404 })) as never,
    );
    expect(falha.ok).toBe(false);
    expect(sim.config.validado_em).toBeNull();
    expect(sim.config.ultimo_erro).toContain("HTTP 404");
  });

  it("teste para um destinatário específico envia só para ele", async () => {
    const { testarConexaoTeams } = await import("@/lib/teams-envio.server");
    const f = fetchOk();
    await testarConexaoTeams("Teste@Alcoeste.com", f as never);
    const corpo = JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body));
    expect(corpo.destinatarios).toEqual(["teste@alcoeste.com"]);
    expect(JSON.stringify(corpo)).toContain("TESTE — ");
  });

  it("sem endereço ou sem destinatários: não chama o fluxo", async () => {
    const { testarConexaoTeams } = await import("@/lib/teams-envio.server");
    const f = fetchOk();
    sim.config = { ...cfgLiberada({ webhook_url: null }) };
    expect((await testarConexaoTeams(null, f as never)).status).toBe("nao_configurado");
    sim.config = { ...cfgLiberada({ destinatarios: [] }) };
    expect((await testarConexaoTeams(null, f as never)).status).toBe("nao_configurado");
    expect(f).not.toHaveBeenCalled();
  });
});
