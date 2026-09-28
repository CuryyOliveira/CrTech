import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Registro de tentativas de login inválidas — precisa do cliente privilegiado
 * porque não existe sessão no momento da falha.
 *
 * Segurança: a falha é confirmada no servidor (a credencial enviada é testada
 * de novo e só é registrada se realmente for recusada), o motivo é gerado pelo
 * próprio servidor e há limite de frequência por e-mail/IP para evitar que
 * alguém polua o log de auditoria com entradas forjadas.
 */

/** Janela e teto do limite de frequência (por e-mail e por IP). */
const JANELA_MS = 5 * 60 * 1000;
const MAX_REGISTROS = 5;
const contadores = new Map<string, { inicio: number; total: number }>();

function excedeuLimite(chave: string) {
  const agora = Date.now();
  const atual = contadores.get(chave);
  if (!atual || agora - atual.inicio > JANELA_MS) {
    contadores.set(chave, { inicio: agora, total: 1 });
    return false;
  }
  atual.total += 1;
  return atual.total > MAX_REGISTROS;
}

export const registrarTentativaLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; senha: string }) => ({
    email: String(d.email ?? "")
      .trim()
      .slice(0, 200),
    senha: String(d.senha ?? "").slice(0, 200),
  }))
  .handler(async ({ data }) => {
    if (!data.email || !data.senha) return { ok: false };

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "desconhecido";
    if (excedeuLimite(`e:${data.email.toLowerCase()}`) || excedeuLimite(`i:${ip}`))
      return { ok: false };

    // Confirma no servidor que a credencial realmente é recusada pelo Auth.
    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"]!;
    const client = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input: any, init?: any) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
            h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: sessao, error } = await client.auth.signInWithPassword({
      email: data.email,
      password: data.senha,
    });
    if (!error) {
      // Credencial válida: nada a registrar (e a sessão criada é descartada).
      await client.auth.signOut().catch(() => {});
      return { ok: false };
    }
    if (sessao?.session) return { ok: false };

    const motivo =
      error.status === 400 || error.message.toLowerCase().includes("credentials")
        ? "credenciais inválidas"
        : "acesso recusado pelo servidor de autenticação";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("auditoria").insert({
      usuario: data.email,
      nome: null,
      tipo_acao: "autenticacao",
      acao: "login_invalido",
      detalhe: `Tentativa de login inválida: ${motivo}`,
      resultado: "erro",
      ip,
    });
    return { ok: true };
  });
