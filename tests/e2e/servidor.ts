/**
 * Servidor dos testes E2E da conferência V2 (NUNCA aponta para produção).
 *
 *  - Prepara um banco de TESTE a partir das migrations (mesmo modelo dos testes de banco).
 *  - Expõe /api/<operação> chamando AS MESMAS funções do servidor (processar_eventos_conferencia,
 *    alteracoes_sync, …) como o usuário informado (x-usuario), via TransportePg.
 *  - Serve a página harness já compilada (dist-harness).
 *  - /api/_sql: comandos de preparação/conferência dos testes (somente neste servidor de teste).
 *
 * Uso: PG_ADMIN_URL=... npx vite-node tests/e2e/servidor.ts   (porta: E2E_PORTA, padrão 4173)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Banco, usuario } from "../db/ambiente";
import setup from "../db/global-setup";
import { TransportePg } from "../db/transporte-pg";

const PORTA = Number(process.env.E2E_PORTA ?? 4173);
const RAIZ = path.resolve(__dirname, "../..");
const DIST = path.join(RAIZ, "dist-harness");
const UUID = /^[0-9a-f-]{36}$/i;

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

async function corpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  const txt = Buffer.concat(partes).toString("utf-8");
  return txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
}

function json(res: ServerResponse, status: number, dados: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(dados));
}

async function main() {
  await setup();
  let banco = await Banco.novo();
  const antigos: Banco[] = [];
  console.log(`[e2e] banco de teste: ${banco.nome}`);

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const op = url.pathname.slice(5);
        const b = req.method === "POST" ? await corpo(req) : {};
        if (op === "_sql") {
          const linhas = await banco.dono(String(b.sql), (b.params as unknown[]) ?? []);
          return json(res, 200, linhas);
        }
        if (op === "_reset") {
          const antigo = banco;
          banco = await Banco.novo();
          antigos.push(antigo);
          // Remove bancos antigos só depois: páginas do teste anterior podem ainda estar
          // terminando uma sincronização automática.
          while (antigos.length > 2)
            void antigos
              .shift()!
              .remover()
              .catch(() => undefined);
          return json(res, 200, { banco: banco.nome });
        }
        const id = String(req.headers["x-usuario"] ?? "");
        if (!UUID.test(id)) return json(res, 401, { message: "Usuário inválido" });
        const t = new TransportePg(banco, usuario(id));
        try {
          switch (op) {
            case "eventos":
              return json(res, 200, await t.enviarEventos(b.eventos as Record<string, unknown>[]));
            case "cursor":
              return json(res, 200, await t.cursorInicial());
            case "snapshot":
              return json(
                res,
                200,
                await t.snapshot(
                  b.tabela as never,
                  (b.apos as string | null) ?? null,
                  Number(b.limite),
                ),
              );
            case "alteracoes":
              return json(res, 200, await t.alteracoes(String(b.cursor), Number(b.limite)));
            case "foto": {
              const dados = Buffer.from(String(b.base64), "base64");
              await t.enviarFoto(String(b.caminho), new Blob([dados]), String(b.mime));
              return json(res, 200, { ok: true });
            }
            default:
              return json(res, 404, { message: "Operação desconhecida" });
          }
        } catch (e) {
          const err = e as { message: string; codigo?: string | null; definitivo?: boolean };
          return json(res, 500, {
            message: err.message,
            code: err.codigo ?? null,
            definitivo: Boolean(err.definitivo),
          });
        }
      }

      // Arquivos da harness.
      let arquivo = path.join(DIST, decodeURIComponent(url.pathname));
      if (!arquivo.startsWith(DIST)) return json(res, 403, {});
      if (!existsSync(arquivo) || statSync(arquivo).isDirectory())
        arquivo = path.join(DIST, "index.html");
      res.writeHead(200, {
        "content-type": TIPOS[path.extname(arquivo)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(readFileSync(arquivo));
    } catch (e) {
      json(res, 500, { message: (e as Error).message });
    }
  });

  servidor.listen(PORTA, "0.0.0.0", () => console.log(`[e2e] servidor em http://0.0.0.0:${PORTA}`));
  const sair = async () => {
    servidor.close();
    for (const b of [banco, ...antigos]) await b.remover().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void sair());
  process.on("SIGTERM", () => void sair());
}

// Servidor de TESTE: uma conexão derrubada (banco trocado entre testes) não pode parar tudo.
process.on("uncaughtException", (e) => console.error("[e2e] erro ignorado:", e.message));

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
