/**
 * Cofre local de credenciais (Offline Login).
 *
 * Guarda no dispositivo, de forma criptografada (AES-GCM 256), os dados
 * mínimos do usuário que já autenticou online: identificador, nome, matrícula,
 * perfil, setor e unidades autorizadas. Tokens de acesso NÃO são guardados aqui
 * (a sessão online é do cliente do Supabase); a senha NUNCA é armazenada: apenas
 * um hash PBKDF2-SHA256 com salt aleatório.
 */

const PREFIXO = "cr:cofre:";
const SESSAO = "cr:sessao-offline";
const ITERACOES = 210_000;

export type DadosCofre = {
  userId: string;
  email: string;
  nome: string | null;
  matricula: string | null;
  perfil: string | null;
  setor: string | null;
  unidades: string[];
  /** Sempre null: mantido só por compatibilidade com cofres antigos. */
  token: string | null;
  refreshToken: string | null;
  validadoEm: string;
};

/** Remove qualquer token (cofres/sessões gravados por versões antigas). */
function semTokens(d: DadosCofre): DadosCofre {
  return { ...d, token: null, refreshToken: null };
}

type Cofre = {
  email: string;
  salt: string;
  hash: string;
  iv: string;
  dados: string;
  atualizado_em: string;
};

function temCrypto() {
  return typeof window !== "undefined" && !!window.crypto?.subtle;
}

function chave(email: string) {
  return `${PREFIXO}${email.trim().toLowerCase()}`;
}

function paraB64(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function deB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function material(senha: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
}

/** Hash PBKDF2 da senha (nunca a senha em texto). */
async function hashSenha(senha: string, salt: Uint8Array) {
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERACOES, hash: "SHA-256" },
    await material(senha),
    256,
  );
  return paraB64(bits);
}

async function chaveAes(senha: string, salt: Uint8Array) {
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERACOES, hash: "SHA-256" },
    await material(senha),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** Salva/atualiza o cofre local após um login online bem-sucedido. */
export async function salvarCofre(senha: string, dados: DadosCofre) {
  if (!temCrypto()) {
    console.warn("[cofre] WebCrypto indisponível: cofre offline não pode ser criado");
    return false;
  }
  if (!senha) {
    console.warn("[cofre] senha ausente: cofre offline não criado");
    return false;
  }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await chaveAes(senha, salt);
    const cifra = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      new TextEncoder().encode(JSON.stringify(semTokens(dados))),
    );
    const cofre: Cofre = {
      email: dados.email.toLowerCase(),
      salt: paraB64(salt),
      hash: await hashSenha(senha, salt),
      iv: paraB64(iv),
      dados: paraB64(cifra),
      atualizado_em: new Date().toISOString(),
    };
    localStorage.setItem(chave(dados.email), JSON.stringify(cofre));
    return true;
  } catch {
    console.warn("[cofre] Falha ao criar o cofre local");
    return false;
  }
}

export function cofreExiste(email: string) {
  if (typeof window === "undefined" || !email) return false;
  return !!localStorage.getItem(chave(email));
}

/** Valida e-mail + senha usando somente os dados locais (sem internet). */
export async function validarCofre(email: string, senha: string): Promise<DadosCofre | null> {
  if (!temCrypto()) {
    console.warn("[cofre] WebCrypto indisponível: login offline impossível");
    return null;
  }
  const bruto = localStorage.getItem(chave(email));
  if (!bruto) return null;
  try {
    const cofre = JSON.parse(bruto) as Cofre;
    const salt = deB64(cofre.salt);
    if (!iguais(await hashSenha(senha, salt), cofre.hash)) return null;
    const key = await chaveAes(senha, salt);
    const aberto = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deB64(cofre.iv) as unknown as BufferSource },
      key,
      deB64(cofre.dados) as unknown as BufferSource,
    );
    return semTokens(JSON.parse(new TextDecoder().decode(aberto)) as DadosCofre);
  } catch {
    console.warn("[cofre] Falha ao abrir o cofre local");
    return null;
  }
}

/** Sessão offline ativa (usuário autenticado pelo cofre local). */
export function sessaoOffline(): DadosCofre | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = sessionStorage.getItem(SESSAO) ?? localStorage.getItem(SESSAO);
    return bruto ? semTokens(JSON.parse(bruto) as DadosCofre) : null;
  } catch {
    return null;
  }
}

/** A sessão offline guarda só identificação/perfil — nenhum token. */
export function abrirSessaoOffline(dados: DadosCofre) {
  const limpo = JSON.stringify(semTokens(dados));
  localStorage.setItem(SESSAO, limpo);
  sessionStorage.setItem(SESSAO, limpo);
}

export function encerrarSessaoOffline() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSAO);
  sessionStorage.removeItem(SESSAO);
}
