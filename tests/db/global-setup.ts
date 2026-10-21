/**
 * Prepara o banco-MODELO dos testes (uma vez por execução):
 *   bootstrap da plataforma → todas as migrations (como "postgres") → dados de teste fixos.
 * Cada arquivo de teste recebe uma cópia isolada deste modelo (CREATE DATABASE ... TEMPLATE).
 *
 * Requer PG_ADMIN_URL (superusuário de um Postgres DE TESTE). Nunca apontar para produção:
 * a URL é recusada se contiver "supabase.co" / "supabase.com".
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { BANCO_MODELO, urlAdmin, urlComo } from "./ambiente";

const RAIZ = path.resolve(__dirname, "../..");

async function executarArquivo(url: string, arquivo: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(readFileSync(arquivo, "utf-8"));
  } catch (e) {
    throw new Error(`Falha ao aplicar ${path.relative(RAIZ, arquivo)}: ${(e as Error).message}`);
  } finally {
    await c.end();
  }
}

export default async function setup() {
  const admin = urlAdmin();
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${BANCO_MODELO} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${BANCO_MODELO}`);
  await c.end();

  const modeloAdmin = urlComo(admin, BANCO_MODELO);
  await executarArquivo(modeloAdmin, path.join(RAIZ, "supabase/tests/bootstrap.sql"));

  const dirMigrations = path.join(RAIZ, "supabase/migrations");
  const modeloPostgres = urlComo(admin, BANCO_MODELO, { usuario: "postgres", senha: "postgres" });
  // CR_MIGRATIONS_ATE=<versão> aplica só até essa versão (ex.: só a baseline, para comparar
  // o comportamento da produção atual com o da Fase 0).
  const ate = process.env.CR_MIGRATIONS_ATE;
  const arquivos = readdirSync(dirMigrations)
    .filter((a) => a.endsWith(".sql"))
    .sort()
    .filter((a) => !ate || a.split("_")[0] <= ate);
  for (const arq of arquivos) {
    await executarArquivo(modeloPostgres, path.join(dirMigrations, arq));
  }
  await executarArquivo(modeloPostgres, path.join(__dirname, "fixtures.sql"));
}
