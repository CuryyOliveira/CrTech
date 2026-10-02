/**
 * registrarTentativaLogin: resposta uniforme (sem oráculo de senha nem enumeração),
 * limite de frequência, nenhuma senha/credencial registrada.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LIMITE_POR_EMAIL,
  RESPOSTA_UNIFORME,
  normalizarEmail,
  processarTentativaLogin,
  sha256,
  type DependenciasTentativa,
  type RegistroTentativa,
} from "@/lib/tentativas-login.server";

function dependencias(limite = () => true) {
  const registros: RegistroTentativa[] = [];
  const chaves: string[] = [];
  const deps: DependenciasTentativa = {
    hash: sha256,
    consumirLimite: vi.fn(async (chave: string) => {
      chaves.push(chave);
      return limite();
    }),
    registrar: vi.fn(async (r: RegistroTentativa) => {
      registros.push(r);
    }),
  };
  return { deps, registros, chaves };
}

describe("resposta uniforme", () => {
  it("é idêntica para qualquer entrada (conta existente, inexistente, inválida, limite, erro)", async () => {
    const respostas = await Promise.all([
      processarTentativaLogin({ email: "existe@empresa.com" }, "1.1.1.1", dependencias().deps),
      processarTentativaLogin({ email: "nao-existe@empresa.com" }, "1.1.1.1", dependencias().deps),
      processarTentativaLogin({ email: "isto não é e-mail" }, "1.1.1.1", dependencias().deps),
      processarTentativaLogin({ email: undefined }, "1.1.1.1", dependencias().deps),
      processarTentativaLogin({ email: "a@b.com" }, "1.1.1.1", dependencias(() => false).deps),
      processarTentativaLogin({ email: "a@b.com" }, "1.1.1.1", {
        ...dependencias().deps,
        registrar: async () => {
          throw new Error("banco fora");
        },
      }),
      processarTentativaLogin({ email: "a@b.com" }, "1.1.1.1", {
        ...dependencias().deps,
        consumirLimite: async () => {
          throw new Error("rpc inexistente");
        },
      }),
    ]);
    for (const r of respostas) expect(r).toEqual(RESPOSTA_UNIFORME);
  });

  it("a função não aceita nem usa senha: enviar uma senha não muda nada nem é registrada", async () => {
    const { deps, registros } = dependencias();
    const entrada = { email: "user@empresa.com", senha: "SenhaSecreta123!" } as unknown as {
      email: string;
    };
    await processarTentativaLogin(entrada, "2.2.2.2", deps);
    expect(JSON.stringify(registros)).not.toContain("SenhaSecreta123!");
    expect(processarTentativaLogin.length).toBe(3); // (entrada, ip, deps): nenhuma dependência de autenticação
  });
});

describe("registro de auditoria", () => {
  it("registra e-mail normalizado, motivo padronizado e IP — sem credenciais", async () => {
    const { deps, registros } = dependencias();
    await processarTentativaLogin(
      { email: "  User@Empresa.COM ", motivo: "email_nao_confirmado" },
      "3.3.3.3",
      deps,
    );
    expect(registros).toEqual([
      {
        usuario: "user@empresa.com",
        tipo_acao: "autenticacao",
        acao: "login_invalido",
        detalhe: "Tentativa de login inválida: e-mail não confirmado",
        resultado: "erro",
        ip: "3.3.3.3",
      },
    ]);
  });

  it("motivo desconhecido vira 'credenciais inválidas' (o cliente não injeta texto na auditoria)", async () => {
    const { deps, registros } = dependencias();
    await processarTentativaLogin(
      { email: "a@b.com", motivo: "<script>alert(1)</script>" },
      "4.4.4.4",
      deps,
    );
    expect(registros[0].detalhe).toBe("Tentativa de login inválida: credenciais inválidas");
  });

  it("não registra o que não tem formato de e-mail (evita gravar uma senha digitada no campo errado)", async () => {
    const { deps, registros } = dependencias();
    await processarTentativaLogin({ email: "MinhaSenha#2026" }, "5.5.5.5", deps);
    expect(registros).toHaveLength(0);
    expect(deps.consumirLimite).not.toHaveBeenCalled();
  });
});

describe("limite de frequência", () => {
  it("usa chaves em hash por e-mail e por IP (sem dados pessoais em texto)", async () => {
    const { deps, chaves } = dependencias();
    await processarTentativaLogin({ email: "user@empresa.com" }, "6.6.6.6", deps);
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toMatch(/^e:[0-9a-f]{64}$/);
    expect(chaves[1]).toMatch(/^i:[0-9a-f]{64}$/);
    expect(chaves.join()).not.toContain("user@empresa.com");
    expect(chaves.join()).not.toContain("6.6.6.6");
  });

  it("para de registrar ao atingir o limite, mantendo a mesma resposta", async () => {
    let usos = 0;
    const { deps, registros } = dependencias(() => ++usos <= LIMITE_POR_EMAIL.maximo * 2);
    for (let i = 0; i < 10; i++) {
      expect(await processarTentativaLogin({ email: "alvo@empresa.com" }, "7.7.7.7", deps)).toEqual(
        RESPOSTA_UNIFORME,
      );
    }
    expect(registros.length).toBe(LIMITE_POR_EMAIL.maximo);
  });

  it("falha do limite (ex.: função ausente no banco) = não registra (fail closed)", async () => {
    const { deps, registros } = dependencias();
    deps.consumirLimite = async () => {
      throw new Error("x");
    };
    await processarTentativaLogin({ email: "a@b.com" }, "8.8.8.8", deps);
    expect(registros).toHaveLength(0);
  });
});

describe("utilitários", () => {
  it("normalizarEmail", () => {
    expect(normalizarEmail(" A@B.Com ")).toBe("a@b.com");
    expect(normalizarEmail("sem-arroba")).toBeNull();
    expect(normalizarEmail(123)).toBeNull();
  });
  it("sha256 é determinístico", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
