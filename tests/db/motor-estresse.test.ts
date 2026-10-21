/**
 * Item 27 — estresse: 500, 1.000 e 5.000 eventos gerados offline, enviados com queda de
 * rede e "app fechado" no meio do envio. Mede tempo, memória, fila, duplicidade e recuperação.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MotorSync } from "@/lib/sync-v2/motor";
import type { Transporte } from "@/lib/sync-v2/transporte";
import { Banco, usuario } from "./ambiente";
import { LISTA, U } from "./fixtures";
import { aparelho, sincronizarTudo } from "./motor-apoio";

let db: Banco;
const resultados: Record<string, unknown>[] = [];
beforeAll(async () => {
  db = await Banco.novo();
  for (let i = 4; i <= 100; i++) {
    await db.dono(
      "INSERT INTO materiais (id, unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, $2, $3, 'Estresse', 5)",
      [randomUUID(), LISTA.A, `E-${String(i).padStart(3, "0")}`],
    );
  }
});
afterAll(async () => {
  await db?.remover();
  if (resultados.length) {
    mkdirSync("tests/resultados", { recursive: true });
    writeFileSync("tests/resultados/estresse-sync.json", JSON.stringify(resultados, null, 2));
  }
});

const ESTQ_A = usuario(U.ESTQ_A);
const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

// Demorado (minutos): roda no CI em passo próprio, ou localmente com CR_ESTRESSE=1.
describe.skipIf(process.env.CR_ESTRESSE !== "1")("estresse da fila de sincronização", () => {
  it.each([500, 1000, 5000])(
    "%i eventos: sem perda, sem duplicidade, com recuperação",
    async (total) => {
      await db.dono(
        "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
        [LISTA.A],
      );
      const ap = await aparelho(db, ESTQ_A, { inicio: new Date(Date.now() - 6 * 3600_000) });
      await ap.motor.sincronizarAgora();
      ap.transporte.falhas.offline = true;
      const conf = await ap.motor.criarConferencia({ unidade_id: LISTA.A });
      const itens = await ap.motor.itens(conf);
      expect(itens).toHaveLength(100);

      global.gc?.();
      const memAntes = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const esperado = new Map<string, number>();
      for (let n = 0; n < total - 1; n++) {
        const item = itens[n % itens.length];
        const qtd = (n * 7) % 11;
        ap.relogio.avancar(0.01);
        await ap.motor.contarItem(conf, item.k, qtd);
        esperado.set(String(item.material_id), qtd);
      }
      const tLocal = performance.now() - t0;
      const filaAntes = (await ap.motor.fila()).length;
      expect(filaAntes).toBe(total);

      // Volta a internet; o envio cai no meio (rede) e depois o app "fecha" durante um lote.
      ap.transporte.falhas.offline = false;
      const t1 = performance.now();
      let lotes = 0;
      const base = ap.transporte;
      const instavel: Transporte = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
        enviarEventos: async (evs: Record<string, unknown>[]) => {
          lotes++;
          if (lotes === 3) base.falhas.quedaRede = 1;
          if (lotes === 6) {
            await base.enviarEventos(evs); // servidor aplica...
            return new Promise(() => undefined); // ...e o app fecha sem receber a resposta
          }
          return base.enviarEventos(evs);
        },
      });
      const m1 = await MotorSync.abrir(ap.motor.sessao, instavel, {
        fabrica: ap.fabrica,
        online: () => true,
        agora: () => ap.relogio.agora,
      });
      await ap.motor.encerrar();
      await m1.sincronizarAgora(); // cai na rede no 3º lote
      void m1.sincronizarAgora(); // trava no 6º lote (app fechado)
      for (let i = 0; i < 500 && lotes < 6; i++) await new Promise((r) => setTimeout(r, 10));
      const presos = (await m1.fila("SYNCING")).length;
      expect(presos).toBeGreaterThan(0);

      // Reabre o app.
      const m2 = await MotorSync.abrir(ap.motor.sessao, base, {
        fabrica: ap.fabrica,
        online: () => true,
        agora: () => ap.relogio.agora,
      });
      expect(await m2.fila("SYNCING")).toHaveLength(0);
      const r = await sincronizarTudo(m2, async () => (await m2.fila()).length === 0);
      const tSync = performance.now() - t1;
      const memDepois = process.memoryUsage().heapUsed;

      expect(r.ok).toBe(true);
      expect(await m2.fila()).toHaveLength(0);
      const [ev] = await db.dono(
        "SELECT count(*)::int AS n, count(DISTINCT event_id)::int AS d, count(*) FILTER (WHERE status <> 'aplicado')::int AS falhas FROM conferencia_eventos WHERE conferencia_id = $1",
        [conf],
      );
      expect(ev).toEqual({ n: total, d: total, falhas: 0 });
      const locais = await m2.eventos(conf);
      expect(locais).toHaveLength(total);
      const srv = await db.dono(
        "SELECT material_id, quantidade_contada FROM conferencia_itens WHERE conferencia_id = $1",
        [conf],
      );
      for (const i of srv) {
        if (esperado.has(i.material_id))
          expect(Number(i.quantidade_contada)).toBe(esperado.get(i.material_id));
      }
      const itensLocais = await m2.itens(conf);
      for (const i of itensLocais) {
        if (esperado.has(String(i.material_id)))
          expect(i.quantidade_contada).toBe(esperado.get(String(i.material_id)));
        expect(i.pendente).toBe(false);
      }
      const metricas = {
        eventos: total,
        gravacao_local_ms: Math.round(tLocal),
        gravacao_local_por_evento_ms: Math.round((tLocal / total) * 100) / 100,
        sincronizacao_ms: Math.round(tSync),
        servidor_eventos_ms: Math.round(base.tempo.eventos),
        servidor_pull_ms: Math.round(base.tempo.pull),
        requisicoes_pull: base.chamadas.alteracoes,
        requisicoes_envio: base.chamadas.eventos,
        eventos_enviados_incluindo_reenvios: base.chamadas.eventosEnviados,
        presos_no_fechamento: presos,
        fila_antes: filaAntes,
        fila_depois: 0,
        duplicados_no_servidor: ev.n - ev.d,
        heap_delta_mb: mb(memDepois - memAntes),
        heap_final_mb: mb(memDepois),
      };
      resultados.push(metricas);
      console.log("[estresse]", JSON.stringify(metricas));
      await m2.encerrar();
    },
    600_000,
  );
});
