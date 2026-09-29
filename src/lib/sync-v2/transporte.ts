/**
 * Transporte: a única parte do motor que fala com a rede. Toda chamada tem tempo-limite.
 * Timeout NÃO significa "falhou": o servidor pode ter aplicado. Por isso o motor reenvia o
 * MESMO event_id e o servidor responde "duplicado" sem aplicar de novo.
 */
import { ErroRede, ErroServidor, type PaginaAlteracoes, type ResultadoServidor } from "./tipos";

export type TabelaSync = "unidades" | "materiais" | "conferencias" | "conferencia_itens";

export interface Transporte {
  enviarEventos(eventos: Record<string, unknown>[]): Promise<ResultadoServidor[]>;
  cursorInicial(): Promise<string>;
  snapshot(
    tabela: TabelaSync,
    apos: string | null,
    limite: number,
  ): Promise<{ linhas: Record<string, unknown>[]; proximo: string | null }>;
  alteracoes(cursor: string, limite: number): Promise<PaginaAlteracoes & { ate?: string }>;
  enviarFoto(caminho: string, arquivo: Blob, mime: string): Promise<void>;
}

export function pareceErroDeRede(e: unknown) {
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed") ||
    msg.includes("aborted") ||
    msg.includes("abort")
  );
}

type RespostaRpc = {
  data: unknown;
  error: { message: string; code?: string; details?: string } | null;
  status?: number;
};
type ClienteRpc = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): { abortSignal(s: AbortSignal): PromiseLike<RespostaRpc> };
  storage: {
    from(bucket: string): {
      upload(
        caminho: string,
        arquivo: Blob,
        opcoes: { contentType: string; upsert: boolean },
      ): Promise<{ error: { message: string; statusCode?: string | number } | null }>;
    };
  };
};

/** Transporte real (Supabase). `cliente` é o supabase-js do app. */
export class TransporteSupabase implements Transporte {
  constructor(
    private readonly cliente: ClienteRpc,
    private readonly tempoLimiteMs = 20_000,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new ErroRede(undefined, "offline");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.tempoLimiteMs);
    try {
      const r = await this.cliente.rpc(fn, args).abortSignal(ctrl.signal);
      if (r.error) {
        if (ctrl.signal.aborted) throw new ErroRede("Tempo esgotado", "timeout");
        if (!r.error.code && pareceErroDeRede(r.error)) throw new ErroRede();
        const definitivo =
          r.error.code === "22023" || r.error.code === "42501" || r.error.code === "PGRST202";
        throw new ErroServidor(r.error.message, r.error.code ?? null, definitivo);
      }
      return r.data as T;
    } catch (e) {
      if (e instanceof ErroRede || e instanceof ErroServidor) throw e;
      if (ctrl.signal.aborted) throw new ErroRede("Tempo esgotado", "timeout");
      if (pareceErroDeRede(e)) throw new ErroRede();
      throw new ErroServidor(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  enviarEventos(eventos: Record<string, unknown>[]) {
    return this.rpc<ResultadoServidor[]>("processar_eventos_conferencia", { _eventos: eventos });
  }
  cursorInicial() {
    return this.rpc<string>("cursor_sync_inicial", {});
  }
  snapshot(tabela: TabelaSync, apos: string | null, limite: number) {
    return this.rpc<{ linhas: Record<string, unknown>[]; proximo: string | null }>(
      "snapshot_sync",
      {
        _tabela: tabela,
        _apos: apos,
        _limite: limite,
      },
    );
  }
  alteracoes(cursor: string, limite: number) {
    return this.rpc<PaginaAlteracoes & { ate?: string }>("alteracoes_sync", {
      _cursor: cursor,
      _limite: limite,
    });
  }

  async enviarFoto(caminho: string, arquivo: Blob, mime: string) {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new ErroRede(undefined, "offline");
    const envio = this.cliente.storage
      .from("conferencias")
      .upload(caminho, arquivo, { contentType: mime, upsert: false });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<never>((_, erro) => {
      timer = setTimeout(
        () => erro(new ErroRede("Tempo esgotado", "timeout")),
        Math.max(this.tempoLimiteMs, 60_000),
      );
    });
    try {
      const { error } = await Promise.race([envio, limite]);
      if (!error) return;
      // O arquivo já existe: um envio anterior chegou (resposta perdida). O caminho é único por foto.
      if (String(error.statusCode) === "409" || /already exists|duplicate/i.test(error.message))
        return;
      if (pareceErroDeRede(error)) throw new ErroRede();
      throw new ErroServidor(error.message, String(error.statusCode ?? ""), false);
    } catch (e) {
      if (e instanceof ErroRede || e instanceof ErroServidor) throw e;
      if (pareceErroDeRede(e)) throw new ErroRede();
      throw new ErroServidor(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }
}
