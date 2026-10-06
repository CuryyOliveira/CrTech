/**
 * Ambiente de HOMOLOGAÇÃO local (descartável): Supabase local (`supabase start`, imagens
 * oficiais) com as migrations do repositório + o app real compilado duas vezes
 * (VITE_CONFERENCE_V2=0 e =1). Nunca aponta para produção.
 *
 * As chaves vêm do `supabase status` local (chaves de demonstração do CLI) pelas variáveis
 * HOMOLOG_SUPABASE_URL / HOMOLOG_ANON_KEY / HOMOLOG_SERVICE_ROLE_KEY / HOMOLOG_DB_URL.
 * As senhas dos usuários de teste são geradas a cada execução e ficam só na memória.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

function exigir(nome: string) {
  const v = process.env[nome];
  if (!v) throw new Error(`Defina ${nome} (ver tests/homologacao/README.md).`);
  return v;
}

export const URL_SUPABASE = exigir("HOMOLOG_SUPABASE_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_SUPABASE)) {
  throw new Error("A homologação só roda contra um Supabase LOCAL.");
}
export const APP_V1 = process.env.HOMOLOG_APP_V1 ?? "http://localhost:3100";
export const APP_V2 = process.env.HOMOLOG_APP_V2 ?? "http://localhost:3101";

export const admin = createClient(URL_SUPABASE, exigir("HOMOLOG_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const pool = new pg.Pool({ connectionString: exigir("HOMOLOG_DB_URL"), max: 4 });
export async function sql<T = Record<string, unknown>>(texto: string, params: unknown[] = []) {
  const r = await pool.query(texto, params);
  return r.rows as T[];
}
export async function encerrar() {
  await pool.end();
}

export const SENHA = `Hml-${randomBytes(9).toString("base64url")}9!`;

export type Usuario = { id: string; email: string; nome: string };

export async function criarUsuario(email: string, nome: string): Promise<Usuario> {
  const existente = await sql<{ id: string }>("SELECT id FROM auth.users WHERE email = $1", [
    email,
  ]);
  if (existente[0]) {
    const { error } = await admin.auth.admin.updateUserById(existente[0].id, { password: SENHA });
    if (error) throw error;
    return { id: existente[0].id, email, nome };
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    user_metadata: { nome },
  });
  if (error) throw error;
  return { id: data.user.id, email, nome };
}
