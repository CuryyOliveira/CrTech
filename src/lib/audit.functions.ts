import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { MotivoTentativa } from "@/lib/tentativas-login.server";

/**
 * Registro de tentativas de login inválidas — precisa do cliente privilegiado
 * porque não existe sessão no momento da falha.
 *
 * Segurança (ver src/lib/tentativas-login.server.ts):
 *  - a senha NUNCA é enviada nem testada aqui (a autenticação é do Supabase Auth);
 *  - a resposta é sempre a mesma, para não permitir descobrir senhas nem contas;
 *  - o limite de frequência é persistente no banco (por e-mail e por IP, em hash).
 */
export const registrarTentativaLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; motivo?: MotivoTentativa }) => ({
    // Só estes campos são lidos; qualquer outro (inclusive uma senha) é descartado.
    email: typeof d?.email === "string" ? d.email.slice(0, 254) : "",
    motivo: typeof d?.motivo === "string" ? d.motivo.slice(0, 40) : undefined,
  }))
  .handler(async ({ data }) => {
    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "desconhecido";

    const { processarTentativaLogin, sha256 } = await import("@/lib/tentativas-login.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    return processarTentativaLogin(data, ip, {
      hash: sha256,
      consumirLimite: async (chave, maximo, janelaSegundos) => {
        const { data: dentro, error } = await admin.rpc("consumir_limite_tentativa", {
          _chave: chave,
          _maximo: maximo,
          _janela_segundos: janelaSegundos,
        });
        // Sem a função no banco (migration não aplicada) ou com erro: não registra.
        return !error && dentro === true;
      },
      registrar: async (registro) => {
        await admin.from("auditoria").insert({ ...registro, user_id: null, nome: null });
      },
    });
  });
