/**
 * Utilitários dos testes de banco: bancos isolados e execução "como" um usuário,
 * reproduzindo o que o PostgREST do Supabase faz a cada requisição
 * (SET ROLE authenticated + request.jwt.claims com o id do usuário).
 */
import { randomUUID } from "node:crypto";
import { Client, type QueryResultRow } from "pg";

export const BANCO_MODELO = "cr_modelo_teste";

export function urlAdmin(): string {
  const url = process.env.PG_ADMIN_URL;
  if (!url) {
    throw new Error(
      "Defina PG_ADMIN_URL com um Postgres de TESTE (ex.: scripts/db-teste.sh iniciar). Nunca produção.",
    );
  }
  if (/supabase\.(co|com)/i.test(url))
    throw new Error("PG_ADMIN_URL aponta para o Supabase: recusado.");
  return url;
}

export function urlComo(
  base: string,
  banco: string,
  credenciais?: { usuario: string; senha: string },
) {
  const u = new URL(base);
  u.pathname = `/${banco}`;
  if (credenciais) {
    u.username = credenciais.usuario;
    u.password = credenciais.senha;
  }
  return u.toString();
}

export type Papel = "authenticated" | "anon" | "service_role";
export type Ator = { id?: string; papel: Papel; email?: string };

export const servidor: Ator = { papel: "service_role" };
export const anonimo: Ator = { papel: "anon" };
export const usuario = (id: string, email = `${id.slice(-4)}@teste.local`): Ator => ({
  id,
  papel: "authenticated",
  email,
});

export type Consulta = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export type ErroBanco = { code?: string; message: string };

export class Banco {
  private constructor(
    readonly nome: string,
    readonly url: string,
  ) {}

  static async novo(): Promise<Banco> {
    const nome = `cr_t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new Client({ connectionString: urlAdmin() });
    await admin.connect();
    try {
      // Cópias simultâneas do mesmo modelo podem colidir ("being accessed by other users").
      for (let tentativa = 1; ; tentativa++) {
        try {
          await admin.query(`CREATE DATABASE ${nome} TEMPLATE ${BANCO_MODELO}`);
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== "55006" || tentativa >= 20) throw e;
          await new Promise((r) => setTimeout(r, 200 * tentativa));
        }
      }
    } finally {
      await admin.end();
    }
    return new Banco(nome, urlComo(urlAdmin(), nome, { usuario: "postgres", senha: "postgres" }));
  }

  async remover() {
    const admin = new Client({ connectionString: urlAdmin() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${this.nome} WITH (FORCE)`);
    await admin.end();
  }

  /** Nova conexão como "postgres" (dono dos objetos) — usada para preparar e conferir dados. */
  async conectar(): Promise<Client> {
    const c = new Client({ connectionString: this.url });
    await c.connect();
    return c;
  }

  /** Consulta direta como "postgres" (ignora RLS, como o dono das tabelas). */
  async dono<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const c = await this.conectar();
    try {
      return (await c.query<T>(sql, params)).rows;
    } finally {
      await c.end();
    }
  }

  /**
   * Executa `fn` numa transação com o papel e as claims do ator, exatamente como uma
   * requisição à API do Supabase. Por padrão desfaz tudo ao final (ROLLBACK).
   */
  async como<T>(
    ator: Ator,
    fn: (q: Consulta) => Promise<T>,
    opcoes: { gravar?: boolean } = {},
  ): Promise<T> {
    const c = await this.conectar();
    try {
      await c.query("BEGIN");
      await prepararSessao(c, ator);
      const q: Consulta = async (sql, params) => (await c.query(sql, params)).rows;
      const r = await fn(q);
      await c.query(opcoes.gravar ? "COMMIT" : "ROLLBACK");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      await c.end();
    }
  }

  /** Um único comando como o ator. Devolve as linhas ou o erro do banco (sem lançar). */
  async tentar<T extends QueryResultRow = QueryResultRow>(
    ator: Ator,
    sql: string,
    params?: unknown[],
    opcoes: { gravar?: boolean } = {},
  ): Promise<{ ok: true; linhas: T[] } | { ok: false; erro: ErroBanco }> {
    try {
      const linhas = await this.como(ator, (q) => q<T>(sql, params), opcoes);
      return { ok: true, linhas };
    } catch (e) {
      const err = e as { code?: string; message: string };
      return { ok: false, erro: { code: err.code, message: err.message } };
    }
  }
}

export async function prepararSessao(c: Client, ator: Ator) {
  const claims =
    ator.papel === "authenticated"
      ? { sub: ator.id, role: "authenticated", email: ator.email }
      : { role: ator.papel };
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query(`SET LOCAL ROLE ${ator.papel}`);
}
