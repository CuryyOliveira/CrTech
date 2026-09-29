/**
 * Transporte de teste: chama as MESMAS funções do servidor (Postgres real) como o usuário,
 * com injeção de falhas para simular rede, timeout, resposta perdida e servidor lento.
 */
import type { Transporte, TabelaSync } from "@/lib/sync-v2/transporte";
import {
  ErroRede,
  ErroServidor,
  type PaginaAlteracoes,
  type ResultadoServidor,
} from "@/lib/sync-v2/tipos";
import type { Ator, Banco } from "./ambiente";

export type Falhas = {
  /** Sem internet: toda chamada falha antes de chegar ao servidor. */
  offline: boolean;
  /** Próximos N envios de eventos: o servidor APLICA, mas a resposta se perde (timeout). */
  perderResposta: number;
  /** Próximos N envios de eventos: erro do servidor (HTTP 500) sem aplicar. */
  erroServidor: number;
  /** Atraso (ms) antes de responder o envio de eventos. */
  atrasoMs: number;
  /** Próximos N uploads de foto falham por rede. */
  fotoSemRede: number;
  /** Próximos N envios de eventos falham por rede ANTES de chegar ao servidor (aparelho acha que está online). */
  quedaRede: number;
};

export class TransportePg implements Transporte {
  falhas: Falhas = {
    offline: false,
    perderResposta: 0,
    erroServidor: 0,
    atrasoMs: 0,
    fotoSemRede: 0,
    quedaRede: 0,
  };
  chamadas = { eventos: 0, eventosEnviados: 0, alteracoes: 0, snapshot: 0, fotos: 0 };
  /** Tempo (ms) gasto esperando o servidor, por tipo de chamada. */
  tempo = { eventos: 0, pull: 0 };

  constructor(
    private readonly db: Banco,
    private readonly ator: Ator,
  ) {}

  private rede() {
    if (this.falhas.offline) throw new ErroRede(undefined, "offline");
  }

  private async rpc<T>(sql: string, params: unknown[], gravar = true): Promise<T> {
    try {
      return await this.db.como(
        this.ator,
        async (q) => {
          const [r] = await q<{ r: T }>(sql, params);
          return r.r;
        },
        { gravar },
      );
    } catch (e) {
      const err = e as { code?: string; message: string };
      throw new ErroServidor(
        err.message,
        err.code ?? null,
        err.code === "22023" || err.code === "42501",
      );
    }
  }

  async enviarEventos(eventos: Record<string, unknown>[]): Promise<ResultadoServidor[]> {
    this.rede();
    if (this.falhas.quedaRede > 0) {
      this.falhas.quedaRede--;
      throw new ErroRede();
    }
    this.chamadas.eventos++;
    this.chamadas.eventosEnviados += eventos.length;
    if (this.falhas.erroServidor > 0) {
      this.falhas.erroServidor--;
      throw new ErroServidor("Internal Server Error", "500");
    }
    if (this.falhas.atrasoMs) await new Promise((r) => setTimeout(r, this.falhas.atrasoMs));
    const t0 = performance.now();
    const r = await this.rpc<ResultadoServidor[]>("SELECT processar_eventos_conferencia($1) AS r", [
      JSON.stringify(eventos),
    ]);
    this.tempo.eventos += performance.now() - t0;
    if (this.falhas.perderResposta > 0) {
      this.falhas.perderResposta--;
      throw new ErroRede("Tempo esgotado", "timeout"); // o servidor aplicou; o aparelho não soube
    }
    return r;
  }

  cursorInicial() {
    this.rede();
    return this.rpc<string>("SELECT cursor_sync_inicial() AS r", [], false);
  }

  snapshot(tabela: TabelaSync, apos: string | null, limite: number) {
    this.rede();
    this.chamadas.snapshot++;
    return this.rpc<{ linhas: Record<string, unknown>[]; proximo: string | null }>(
      "SELECT snapshot_sync($1, $2, $3) AS r",
      [tabela, apos, limite],
      false,
    );
  }

  async alteracoes(cursor: string, limite: number) {
    this.rede();
    this.chamadas.alteracoes++;
    const t0 = performance.now();
    const r = await this.rpc<PaginaAlteracoes & { ate?: string }>(
      "SELECT alteracoes_sync($1, $2) AS r",
      [cursor, limite],
      false,
    );
    this.tempo.pull += performance.now() - t0;
    return r;
  }

  async enviarFoto(caminho: string, arquivo: Blob, mime: string) {
    this.rede();
    if (this.falhas.fotoSemRede > 0) {
      this.falhas.fotoSemRede--;
      throw new ErroRede();
    }
    this.chamadas.fotos++;
    const bytes = arquivo.size;
    await this.db
      .como(
        this.ator,
        async (q) => {
          const ja = await q(
            "SELECT 1 FROM storage.objects WHERE bucket_id = 'conferencias' AND name = $1",
            [caminho],
          );
          if (ja.length) return; // 409: já enviado antes (resposta perdida)
          await q(
            "INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('conferencias', $1, $2)",
            [caminho, JSON.stringify({ mimetype: mime, size: bytes })],
          );
        },
        { gravar: true },
      )
      .catch((e: { code?: string; message: string }) => {
        throw new ErroServidor(e.message, e.code === "42501" ? "403" : (e.code ?? null));
      });
  }
}
