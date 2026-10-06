/**
 * Transporte da harness E2E: chama o servidor de teste (tests/e2e/servidor.ts) por HTTP.
 * "Sem rede" é simulado de verdade: a flag faz o fetch nem sair (como no aparelho offline).
 */
import { lerComoArrayBuffer } from "@/components/conferencia-v2/ConferencePhotos";
import type { TabelaSync, Transporte } from "@/lib/sync-v2/transporte";
import { pareceErroDeRede } from "@/lib/sync-v2/transporte";
import {
  ErroRede,
  ErroServidor,
  type PaginaAlteracoes,
  type ResultadoServidor,
} from "@/lib/sync-v2/tipos";

export const redeSimulada = {
  get offline() {
    return sessionStorage.getItem("cr-e2e-offline") === "1";
  },
  set offline(v: boolean) {
    sessionStorage.setItem("cr-e2e-offline", v ? "1" : "0");
  },
};

export class TransporteHttp implements Transporte {
  constructor(private readonly usuario: string) {}

  private async chamar<T>(op: string, corpo: Record<string, unknown> = {}): Promise<T> {
    if (redeSimulada.offline) throw new ErroRede(undefined, "offline");
    let r: Response;
    try {
      r = await fetch(`/api/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-usuario": this.usuario },
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      if (pareceErroDeRede(e)) throw new ErroRede();
      throw e;
    }
    const dados = (await r.json()) as T & {
      message?: string;
      code?: string | null;
      definitivo?: boolean;
    };
    if (!r.ok)
      throw new ErroServidor(
        dados.message ?? "Erro",
        dados.code ?? null,
        Boolean(dados.definitivo),
      );
    return dados;
  }

  enviarEventos(eventos: Record<string, unknown>[]) {
    return this.chamar<ResultadoServidor[]>("eventos", { eventos });
  }
  cursorInicial() {
    return this.chamar<string>("cursor");
  }
  snapshot(tabela: TabelaSync, apos: string | null, limite: number) {
    return this.chamar<{ linhas: Record<string, unknown>[]; proximo: string | null }>("snapshot", {
      tabela,
      apos,
      limite,
    });
  }
  alteracoes(cursor: string, limite: number) {
    return this.chamar<PaginaAlteracoes & { ate?: string }>("alteracoes", { cursor, limite });
  }
  async enviarFoto(caminho: string, arquivo: Blob, mime: string) {
    const bytes = new Uint8Array(await lerComoArrayBuffer(arquivo));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    await this.chamar("foto", { caminho, mime, base64: btoa(bin) });
  }
}
