/** Unidade: projeção local (pausas pelo horário do evento) e sanitização dos logs. */
import { describe, expect, it } from "vitest";
import { sanitizar } from "@/lib/sync-v2/log";
import {
  aplicarNaConferencia,
  aplicarNoItem,
  reaplicavel,
  tempoTrabalhado,
} from "@/lib/sync-v2/projecao";
import type { EstadoConferencia, EstadoItem, ItemFila, TipoEvento } from "@/lib/sync-v2/tipos";

const T0 = Date.parse("2026-09-29T08:00:00Z");
const em = (min: number) => new Date(T0 + min * 60_000).toISOString();

function ev(tipo: TipoEvento, min: number, payload: Record<string, unknown> = {}): ItemFila {
  return {
    event_id: `${tipo}-${min}`,
    seq: min,
    conference_id: "c",
    event_type: tipo,
    status: "PENDING",
    tentativas: 0,
    falhas_rede: 0,
    created_at: em(min),
    last_attempt_at: null,
    next_attempt_at: null,
    error_code: null,
    error_message: null,
    payload,
    alvo_k: null,
    resposta: null,
    txid: null,
    refletido: false,
    aguarda_foto: null,
    resolucao: null,
  };
}

const base: EstadoConferencia = {
  unidade_id: "u",
  status: "em_andamento",
  hora_inicio: em(0),
  hora_fim: null,
  total_tempo_pausado: 0,
  quantidade_pausas: 0,
  ultima_pausa: null,
  ultima_retomada: null,
  tempo_trabalhado: null,
  conferente: null,
  responsavel: null,
  observacoes: null,
  motivo_cancelamento: null,
  tem_assinatura: false,
  tem_assinatura_gestor: false,
};

describe("projeção de pausas pelo horário dos eventos", () => {
  it("várias pausas e finalização pausada", () => {
    let c = base;
    for (const e of [
      ev("CONFERENCE_PAUSED", 10),
      ev("CONFERENCE_RESUMED", 15),
      ev("CONFERENCE_PAUSED", 30),
      ev("CONFERENCE_RESUMED", 50),
      ev("CONFERENCE_PAUSED", 60),
      ev("SIGNATURE_ADDED", 61, { tipo: "conferente" }),
      ev("CONFERENCE_FINALIZED", 90),
    ]) {
      c = aplicarNaConferencia(c, e);
    }
    expect(c).toMatchObject({ status: "finalizada", quantidade_pausas: 3, tem_assinatura: true });
    expect(c.total_tempo_pausado).toBe((5 + 20 + 30) * 60);
    expect(c.tempo_trabalhado).toBe((90 - 55) * 60);
  });

  it("eventos repetidos/fora de estado não mudam nada (como no servidor)", () => {
    const p = aplicarNaConferencia(base, ev("CONFERENCE_PAUSED", 10));
    expect(aplicarNaConferencia(p, ev("CONFERENCE_PAUSED", 12))).toBe(p);
    expect(aplicarNaConferencia(base, ev("CONFERENCE_RESUMED", 12))).toBe(base);
    const f = aplicarNaConferencia(
      { ...base, tem_assinatura: true },
      ev("CONFERENCE_FINALIZED", 20),
    );
    expect(aplicarNaConferencia(f, ev("CONFERENCE_CANCELLED", 21, { motivo: "x" }))).toBe(f);
  });

  it("relógio do aparelho atrasado não gera pausa negativa", () => {
    const p = aplicarNaConferencia(base, ev("CONFERENCE_PAUSED", 10));
    const r = aplicarNaConferencia(p, ev("CONFERENCE_RESUMED", 5));
    expect(r.total_tempo_pausado).toBe(0);
  });

  it("cronômetro congela durante a pausa", () => {
    const p = aplicarNaConferencia(base, ev("CONFERENCE_PAUSED", 10));
    expect(tempoTrabalhado(p, em(500))).toBe(600);
  });
});

describe("projeção de itens", () => {
  it("contagem define o status pela quantidade esperada", () => {
    const i: EstadoItem = {
      id: "i",
      material_id: "m",
      codigo: "P",
      descricao: "d",
      locacao: null,
      quantidade_esperada: 5,
      quantidade_contada: null,
      status: "pendente",
      observacoes: null,
      origem: "lista",
      motivo_inclusao: null,
      versao: 0,
    };
    expect(aplicarNoItem(i, ev("ITEM_COUNTED", 1, { quantidade: 5 })).status).toBe("conferido");
    expect(aplicarNoItem(i, ev("ITEM_COUNTED", 1, { quantidade: 4 })).status).toBe("divergencia");
    expect(aplicarNoItem(i, ev("ITEM_COUNTED", 1, { quantidade: null })).status).toBe("pendente");
  });

  it("só eventos não confirmados/não refletidos são reaplicados", () => {
    expect(reaplicavel({ ...ev("ITEM_COUNTED", 1), status: "CONFLICT" })).toBe(true);
    expect(reaplicavel({ ...ev("ITEM_COUNTED", 1), status: "SYNCED" })).toBe(true);
    expect(reaplicavel({ ...ev("ITEM_COUNTED", 1), status: "SYNCED", refletido: true })).toBe(
      false,
    );
    expect(reaplicavel({ ...ev("ITEM_COUNTED", 1), status: "RESOLVED" })).toBe(false);
  });
});

describe("logs sem dados sensíveis", () => {
  it("remove senha, tokens, assinaturas e imagens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJhLWZhbHNh";
    const r = JSON.stringify(
      sanitizar({
        senha: "x",
        Authorization: `Bearer ${jwt}`,
        dados: { refresh_token: "y", texto: `token ${jwt}`, foto: "data:image/png;base64,AAAA" },
        assinatura: "data:image/png;base64,BBBB",
      }),
    );
    expect(r).not.toMatch(/eyJhbGci|"x"|"y"|AAAA|BBBB/);
  });
});
