/**
 * Registro de tentativas de login inválidas (lógica pura, testável sem servidor).
 *
 * Regras de segurança:
 *  - NUNCA recebe nem testa a senha: quem autentica é o Supabase Auth. O cliente só
 *    informa que o Auth recusou o login (a V1 retestava a senha no servidor, o que
 *    permitia descobrir senhas pela diferença na resposta).
 *  - Resposta SEMPRE idêntica (`RESPOSTA_UNIFORME`), exista ou não a conta, esteja ou
 *    não no limite, dê certo ou errado o registro: não permite enumeração.
 *  - Limite de frequência persistente no banco, por e-mail e por IP, com chaves em
 *    hash SHA-256 (e-mail e IP não ficam na tabela de controle).
 *  - O e-mail só é registrado na auditoria se tiver formato de e-mail (evita gravar,
 *    por engano, uma senha digitada no campo de e-mail).
 */

export const RESPOSTA_UNIFORME = Object.freeze({ ok: true as const });

export const LIMITE_POR_EMAIL = { maximo: 5, janelaSegundos: 15 * 60 };
export const LIMITE_POR_IP = { maximo: 20, janelaSegundos: 15 * 60 };

const MOTIVOS = {
  credenciais_invalidas: "credenciais inválidas",
  email_nao_confirmado: "e-mail não confirmado",
  recusado: "acesso recusado pelo servidor de autenticação",
} as const;

export type MotivoTentativa = keyof typeof MOTIVOS;

export type RegistroTentativa = {
  usuario: string;
  tipo_acao: "autenticacao";
  acao: "login_invalido";
  detalhe: string;
  resultado: "erro";
  ip: string;
};

export type DependenciasTentativa = {
  /** true = ainda dentro do limite. Qualquer erro deve ser tratado como "fora do limite". */
  consumirLimite: (chave: string, maximo: number, janelaSegundos: number) => Promise<boolean>;
  registrar: (registro: RegistroTentativa) => Promise<void>;
  hash: (texto: string) => Promise<string>;
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function normalizarEmail(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const email = valor.trim().toLowerCase().slice(0, 254);
  return EMAIL.test(email) ? email : null;
}

export function normalizarMotivo(valor: unknown): MotivoTentativa {
  return typeof valor === "string" && valor in MOTIVOS
    ? (valor as MotivoTentativa)
    : "credenciais_invalidas";
}

/** SHA-256 em hexadecimal (Web Crypto: disponível no Cloudflare Workers e no Node 20+). */
export async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function processarTentativaLogin(
  entrada: { email?: unknown; motivo?: unknown },
  ip: string,
  deps: DependenciasTentativa,
): Promise<typeof RESPOSTA_UNIFORME> {
  try {
    const email = normalizarEmail(entrada?.email);
    if (!email) return RESPOSTA_UNIFORME;
    const ipSeguro = (ip || "desconhecido").slice(0, 64);

    const [chaveEmail, chaveIp] = await Promise.all([
      deps.hash(`login:email:${email}`),
      deps.hash(`login:ip:${ipSeguro}`),
    ]);
    const dentroEmail = await deps
      .consumirLimite(`e:${chaveEmail}`, LIMITE_POR_EMAIL.maximo, LIMITE_POR_EMAIL.janelaSegundos)
      .catch(() => false);
    const dentroIp = await deps
      .consumirLimite(`i:${chaveIp}`, LIMITE_POR_IP.maximo, LIMITE_POR_IP.janelaSegundos)
      .catch(() => false);
    if (!dentroEmail || !dentroIp) return RESPOSTA_UNIFORME;

    await deps.registrar({
      usuario: email,
      tipo_acao: "autenticacao",
      acao: "login_invalido",
      detalhe: `Tentativa de login inválida: ${MOTIVOS[normalizarMotivo(entrada?.motivo)]}`,
      resultado: "erro",
      ip: ipSeguro,
    });
  } catch {
    // Falhas internas nunca mudam a resposta.
  }
  return RESPOSTA_UNIFORME;
}
