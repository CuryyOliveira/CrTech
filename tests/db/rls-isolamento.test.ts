/**
 * RLS e isolamento por empresa.
 * Papéis: ADMIN (administrador A), ESTOQUISTA (conferente A), VISUALIZADOR (perfil "usuario" A),
 * usuário da Empresa A × usuário da Empresa B, usuário BLOQUEADO, anônimo e global (proprietário).
 * Operações: SELECT, INSERT, UPDATE e DELETE nas entidades críticas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonimo, Banco, usuario, type Ator } from "./ambiente";
import { CONF, EMPRESA_A, EMPRESA_B, ITEM, LISTA, MATERIAL, U } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const ADMIN_A = usuario(U.ADMIN_A);
const ESTQ_A = usuario(U.ESTQ_A);
const VISU_A = usuario(U.VISU_A);
const GESTOR_A = usuario(U.GESTOR_A);
const BLOQ_A = usuario(U.BLOQ_A);
const ADMIN_B = usuario(U.ADMIN_B);
const ESTQ_B = usuario(U.ESTQ_B);
const LEGADO = usuario(U.LEGADO);
const DONO = usuario(U.DONO);

async function ids(ator: Ator, sql: string, params: unknown[] = []) {
  const r = await db.tentar<{ id: string }>(ator, sql, params);
  if (!r.ok) throw new Error(r.erro.message);
  return r.linhas.map((l) => l.id);
}

/** Linhas afetadas por um comando (0 quando a RLS esconde a linha). */
async function afetadas(ator: Ator, sql: string, params: unknown[] = []) {
  const r = await db.tentar(ator, `${sql} RETURNING 1`, params);
  return r.ok ? r.linhas.length : -1; // -1 = recusado com erro
}

describe("SELECT — cada usuário só enxerga a própria empresa", () => {
  it("listas (unidades)", async () => {
    const a = await ids(ESTQ_A, "SELECT id FROM unidades");
    expect(a).toContain(LISTA.A);
    expect(a).toContain(LISTA.A_MOD);
    expect(a).not.toContain(LISTA.B);
    expect(a).not.toContain(LISTA.SEM_EMPRESA);
    expect(a).not.toContain(LISTA.A_IND); // agrícola não vê listas da indústria

    const b = await ids(ESTQ_B, "SELECT id FROM unidades");
    expect(b).toEqual([LISTA.B]);

    expect(await ids(ADMIN_A, "SELECT id FROM unidades")).not.toContain(LISTA.B);
    expect(await ids(DONO, "SELECT id FROM unidades")).toEqual(
      expect.arrayContaining([LISTA.A, LISTA.B, LISTA.SEM_EMPRESA]),
    );
  });

  it("materiais", async () => {
    const a = await ids(ESTQ_A, "SELECT id FROM materiais");
    expect(a).toContain(MATERIAL.A1);
    expect(a).not.toContain(MATERIAL.B1);
    expect(a).not.toContain(MATERIAL.SEM);
    expect(await ids(ESTQ_B, "SELECT id FROM materiais")).toEqual([MATERIAL.B1]);
    expect(await ids(ADMIN_B, "SELECT id FROM materiais WHERE id = $1", [MATERIAL.A1])).toEqual([]);
  });

  it("conferências e itens", async () => {
    const a = await ids(ESTQ_A, "SELECT id FROM conferencias");
    expect(a).toContain(CONF.A_FIN);
    expect(a).not.toContain(CONF.B_FIN);
    expect(await ids(ESTQ_B, "SELECT id FROM conferencias")).toEqual([CONF.B_FIN]);
    expect(
      await ids(ESTQ_A, "SELECT id FROM conferencia_itens WHERE id = $1", [ITEM.B_FIN_1]),
    ).toEqual([]);
    expect(
      await ids(ADMIN_B, "SELECT id FROM conferencia_itens WHERE id = $1", [ITEM.A_FIN_1]),
    ).toEqual([]);
  });

  it("usuários (user_profiles): administrador só vê a própria empresa", async () => {
    const a = await db.tentar<{ user_id: string }>(ADMIN_A, "SELECT user_id FROM user_profiles");
    if (!a.ok) throw new Error(a.erro.message);
    const vistos = a.linhas.map((l) => l.user_id);
    expect(vistos).toContain(U.ESTQ_A);
    expect(vistos).not.toContain(U.ESTQ_B);
    expect(vistos).not.toContain(U.ADMIN_B);

    const b = await db.tentar<{ user_id: string }>(ADMIN_B, "SELECT user_id FROM user_profiles");
    if (!b.ok) throw new Error(b.erro.message);
    expect(b.linhas.map((l) => l.user_id).sort()).toEqual([U.ADMIN_B, U.ESTQ_B].sort());

    // Usuário comum só vê o próprio perfil.
    const e = await db.tentar<{ user_id: string }>(ESTQ_A, "SELECT user_id FROM user_profiles");
    if (!e.ok) throw new Error(e.erro.message);
    expect(e.linhas.map((l) => l.user_id)).toEqual([U.ESTQ_A]);
  });

  it("vínculos com empresas (empresa_usuarios) e empresas", async () => {
    const r = await db.tentar<{ empresa_id: string }>(
      ADMIN_B,
      "SELECT DISTINCT empresa_id FROM empresa_usuarios",
    );
    if (!r.ok) throw new Error(r.erro.message);
    expect(r.linhas.map((l) => l.empresa_id)).toEqual([EMPRESA_B]);
    expect(await ids(ADMIN_B, "SELECT id FROM empresas")).toEqual([EMPRESA_B]);
    expect(await ids(ESTQ_A, "SELECT id FROM empresas")).toEqual([EMPRESA_A]);
  });

  it("histórico, auditoria, sessões e notificações", async () => {
    const hist = await db.tentar<{ conferencia_id: string }>(
      ADMIN_A,
      "SELECT conferencia_id FROM historico_conferencias",
    );
    if (!hist.ok) throw new Error(hist.erro.message);
    expect(hist.linhas.map((l) => l.conferencia_id)).not.toContain(CONF.B_FIN);

    const aud = await db.tentar<{ usuario: string }>(ADMIN_A, "SELECT usuario FROM auditoria");
    if (!aud.ok) throw new Error(aud.erro.message);
    expect(aud.linhas.map((l) => l.usuario)).not.toContain("estq.b@teste.local");

    expect(await ids(ADMIN_A, "SELECT id FROM sessoes_usuario")).toEqual([]);
    expect(await ids(ADMIN_A, "SELECT id FROM notificacoes_conferencia")).toEqual([]);
    expect((await ids(ADMIN_B, "SELECT id FROM notificacoes_conferencia")).length).toBe(1);
  });

  it("pausas de conferências de outra empresa ficam ocultas para administradores", async () => {
    await db.dono("UPDATE conferencias SET status = 'pausada' WHERE id = $1", [CONF.A2_ABERTA]);
    expect((await ids(ADMIN_A, "SELECT id FROM conferencia_pausas")).length).toBe(1);
    expect(await ids(ADMIN_B, "SELECT id FROM conferencia_pausas")).toEqual([]);
    await db.dono("UPDATE conferencias SET status = 'em_andamento' WHERE id = $1", [
      CONF.A2_ABERTA,
    ]);
  });

  it("administrador criado antes de 10/08/2026 não tem mais visão global de usuários", async () => {
    // ADMIN_A tem created_at = 01/07/2026: antes da Fase 0 ele via e alterava usuários de TODAS as empresas.
    const r = await db.tentar(ADMIN_A, "SELECT 1 FROM user_profiles WHERE user_id = $1", [
      U.ESTQ_B,
    ]);
    expect(r.ok && r.linhas.length).toBe(0);
  });

  it("usuário legado sem empresa vê as listas da empresa legada, não as de outras empresas", async () => {
    const r = await ids(LEGADO, "SELECT id FROM unidades");
    expect(r).toContain(LISTA.A);
    expect(r).not.toContain(LISTA.B);
  });

  it("anônimo não vê nada", async () => {
    for (const t of [
      "unidades",
      "materiais",
      "conferencias",
      "conferencia_itens",
      "user_profiles",
      "empresas",
      "auditoria",
    ]) {
      const r = await db.tentar(anonimo, `SELECT 1 FROM ${t}`);
      expect(r.ok ? r.linhas.length : 0, t).toBe(0);
    }
  });
});

describe("INSERT / UPDATE / DELETE — nunca em outra empresa", () => {
  it("estoquista de B não altera nem exclui materiais/conferências/listas de A", async () => {
    expect(
      await afetadas(ESTQ_B, "UPDATE materiais SET quantidade_esperada = 99 WHERE id = $1", [
        MATERIAL.A1,
      ]),
    ).toBe(0);
    expect(await afetadas(ESTQ_B, "DELETE FROM materiais WHERE id = $1", [MATERIAL.A1])).toBe(0);
    expect(
      await afetadas(ESTQ_B, "UPDATE conferencias SET observacoes = 'x' WHERE id = $1", [
        CONF.A2_ABERTA,
      ]),
    ).toBe(0);
    expect(
      await afetadas(ESTQ_B, "UPDATE conferencia_itens SET observacoes = 'x' WHERE id = $1", [
        ITEM.A2_1,
      ]),
    ).toBe(0);
    expect(await afetadas(ESTQ_B, "DELETE FROM unidades WHERE id = $1", [LISTA.A2])).toBe(0);
  });

  it("estoquista de B não insere material, lista, conferência ou item na empresa A", async () => {
    expect(
      await afetadas(ESTQ_B, "INSERT INTO materiais (unidade_id, codigo) VALUES ($1, 'Z')", [
        LISTA.A,
      ]),
    ).toBe(-1);
    expect(
      await afetadas(
        ESTQ_B,
        "INSERT INTO unidades (nome, tipo, empresa_id) VALUES ('x', 'caminhao', $1)",
        [EMPRESA_A],
      ),
    ).toBe(-1);
    expect(
      await afetadas(ESTQ_B, "INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2)", [
        LISTA.A,
        U.ESTQ_B,
      ]),
    ).toBe(-1);
    expect(
      await afetadas(
        ESTQ_B,
        "INSERT INTO conferencia_itens (conferencia_id, codigo) VALUES ($1, 'Z')",
        [CONF.A2_ABERTA],
      ),
    ).toBe(-1);
  });

  it("imagens de material: não é possível anexar a material de outra empresa", async () => {
    expect(
      await afetadas(
        ESTQ_B,
        "INSERT INTO material_imagens (material_id, url_imagem) VALUES ($1, 'x')",
        [MATERIAL.A1],
      ),
    ).toBe(-1);
    expect(
      await afetadas(
        ESTQ_A,
        "INSERT INTO material_imagens (material_id, url_imagem) VALUES ($1, 'x')",
        [MATERIAL.A1],
      ),
    ).toBe(1);
  });

  it("administrador de B não altera nem exclui usuários de A", async () => {
    expect(
      await afetadas(ADMIN_B, "UPDATE user_profiles SET nome = 'x' WHERE user_id = $1", [U.ESTQ_A]),
    ).toBe(0);
    expect(
      await afetadas(ADMIN_B, "DELETE FROM user_profiles WHERE user_id = $1", [U.ESTQ_A]),
    ).toBe(0);
    expect(
      await afetadas(
        ADMIN_B,
        "UPDATE sessoes_usuario SET encerrada_em = now() WHERE user_id = $1",
        [U.ESTQ_A],
      ),
    ).toBe(0);
    expect(
      await afetadas(ADMIN_B, "INSERT INTO permissoes_usuario (user_id, modulo) VALUES ($1, 'x')", [
        U.ESTQ_A,
      ]),
    ).toBe(-1);
  });

  it("administrador de A administra usuários de A", async () => {
    expect(
      await afetadas(ADMIN_A, "UPDATE user_profiles SET nome = 'Novo nome' WHERE user_id = $1", [
        U.ESTQ_A,
      ]),
    ).toBe(1);
    expect(
      await afetadas(ADMIN_A, "INSERT INTO permissoes_usuario (user_id, modulo) VALUES ($1, 'x')", [
        U.ESTQ_A,
      ]),
    ).toBe(1);
  });
});

describe("papéis dentro da empresa", () => {
  it("ESTOQUISTA: lê e opera listas, materiais e conferências", async () => {
    expect(
      await afetadas(
        ESTQ_A,
        "INSERT INTO materiais (unidade_id, codigo, descricao) VALUES ($1, 'NOVO', 'Novo')",
        [LISTA.A],
      ),
    ).toBe(1);
    expect(
      await afetadas(ESTQ_A, "UPDATE materiais SET quantidade_esperada = 11 WHERE id = $1", [
        MATERIAL.A1,
      ]),
    ).toBe(1);
    expect(
      await afetadas(
        ESTQ_A,
        "UPDATE conferencia_itens SET quantidade_contada = 2, status = 'conferido' WHERE id = $1",
        [ITEM.A2_1],
      ),
    ).toBe(1);
    expect(
      await afetadas(
        ESTQ_A,
        "INSERT INTO unidades (nome, tipo, empresa_id) VALUES ('Nova', 'caminhao', $1)",
        [EMPRESA_A],
      ),
    ).toBe(1);
  });

  it("ESTOQUISTA: não acessa auditoria, sessões ou permissões de outros usuários", async () => {
    const aud = await db.tentar<{ usuario: string }>(ESTQ_A, "SELECT usuario FROM auditoria");
    if (!aud.ok) throw new Error(aud.erro.message);
    expect(aud.linhas.every((l) => l.usuario === "estq.a@teste.local")).toBe(true);
    expect(
      await afetadas(ESTQ_A, "UPDATE user_profiles SET nome = 'x' WHERE user_id = $1", [U.VISU_A]),
    ).toBe(0);
  });

  it("VISUALIZADOR (nível 1): não vê listas e não grava nada", async () => {
    expect(await ids(VISU_A, "SELECT id FROM unidades")).toEqual([]);
    expect(await ids(VISU_A, "SELECT id FROM conferencias")).toEqual([]);
    expect(
      await afetadas(VISU_A, "INSERT INTO materiais (unidade_id, codigo) VALUES ($1, 'V')", [
        LISTA.A,
      ]),
    ).toBe(-1);
    expect(
      await afetadas(VISU_A, "UPDATE conferencia_itens SET observacoes = 'x' WHERE id = $1", [
        ITEM.A2_1,
      ]),
    ).toBe(0);
    expect(
      await afetadas(VISU_A, "INSERT INTO conferencias (unidade_id, created_by) VALUES ($1, $2)", [
        LISTA.A_MOD,
        U.VISU_A,
      ]),
    ).toBe(-1);
  });

  it("GESTOR (nível 3): vê todas as listas da empresa e o histórico", async () => {
    const r = await ids(GESTOR_A, "SELECT id FROM unidades");
    expect(r).toEqual(expect.arrayContaining([LISTA.A, LISTA.A_IND, LISTA.A_MOD]));
    expect(r).not.toContain(LISTA.B);
  });

  it("usuário BLOQUEADO perde todo o acesso", async () => {
    expect(await ids(BLOQ_A, "SELECT id FROM unidades")).toEqual([]);
    expect(
      await afetadas(BLOQ_A, "INSERT INTO materiais (unidade_id, codigo) VALUES ($1, 'B')", [
        LISTA.A,
      ]),
    ).toBe(-1);
  });

  it("ADMIN: não grava dados globais do sistema (planos, avisos, configurações, permissões por perfil)", async () => {
    expect(
      await afetadas(ADMIN_A, "INSERT INTO planos (codigo, nome) VALUES ('hack', 'Hack')"),
    ).toBe(-1);
    expect(await afetadas(ADMIN_A, "UPDATE planos SET valor_centavos = 1")).toBe(0);
    expect(
      await afetadas(ADMIN_A, "INSERT INTO avisos_sistema (titulo, mensagem) VALUES ('x', 'y')"),
    ).toBe(-1);
    expect(
      await afetadas(
        ADMIN_A,
        "INSERT INTO permissoes_perfil (perfil, modulo) VALUES ('agricola', 'x')",
      ),
    ).toBe(-1);
    expect(await afetadas(ADMIN_A, "UPDATE configuracoes_sistema SET valor = '{}'")).toBe(0);
    expect(
      await ids(
        ADMIN_A,
        "SELECT chave AS id FROM configuracoes_sistema WHERE chave = 'emails_conferencia'",
      ),
    ).toEqual([]);
  });

  it("GLOBAL (proprietário): administra os dados globais", async () => {
    expect(
      await afetadas(
        DONO,
        "INSERT INTO avisos_sistema (titulo, mensagem) VALUES ('Aviso', 'Mensagem')",
      ),
    ).toBe(1);
    expect(
      await afetadas(DONO, "UPDATE planos SET valor_centavos = 1000 WHERE codigo = 'basico'"),
    ).toBe(1);
  });
});

describe("hierarquia de perfis protegida no banco", () => {
  it("administrador NÃO pode se promover a super_admin pela API", async () => {
    const r = await db.tentar(
      ADMIN_A,
      "UPDATE user_profiles SET perfil = 'super_admin' WHERE user_id = $1",
      [U.ADMIN_A],
    );
    expect(r.ok).toBe(false);
  });
  it("administrador NÃO pode promover outro usuário acima do próprio nível", async () => {
    const r = await db.tentar(
      ADMIN_A,
      "UPDATE user_profiles SET perfil = 'super_admin' WHERE user_id = $1",
      [U.ESTQ_A],
    );
    expect(r.ok).toBe(false);
  });
  it("administrador NÃO altera o proprietário", async () => {
    expect(
      (
        await db.tentar(ADMIN_A, "UPDATE user_profiles SET bloqueado = true WHERE user_id = $1", [
          U.DONO,
        ])
      ).ok,
    ).toBe(false);
  });
  it("administrador NÃO se desbloqueia/bloqueia nem muda o próprio perfil", async () => {
    expect(
      (
        await db.tentar(ADMIN_A, "UPDATE user_profiles SET perfil = 'gestor' WHERE user_id = $1", [
          U.ADMIN_A,
        ])
      ).ok,
    ).toBe(false);
  });
  it("administrador pode atribuir perfis até o próprio nível dentro da empresa", async () => {
    expect(
      await afetadas(ADMIN_A, "UPDATE user_profiles SET perfil = 'gestor' WHERE user_id = $1", [
        U.ESTQ_A,
      ]),
    ).toBe(1);
    expect(
      await afetadas(
        ADMIN_A,
        "UPDATE user_profiles SET perfil = 'administrador' WHERE user_id = $1",
        [U.ESTQ_A],
      ),
    ).toBe(1);
  });
  it("usuário comum não altera o próprio perfil", async () => {
    expect(
      await afetadas(
        ESTQ_A,
        "UPDATE user_profiles SET perfil = 'administrador' WHERE user_id = $1",
        [U.ESTQ_A],
      ),
    ).toBe(0);
  });
  it("a tabela user_roles não pode ser gravada por usuários", async () => {
    expect(
      await afetadas(ESTQ_A, "INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [
        U.ESTQ_A,
      ]),
    ).toBe(-1);
  });
});

describe("funções expostas pela API (/rest/v1/rpc)", () => {
  it("has_role não é mais executável por usuários", async () => {
    const r = await db.tentar(ESTQ_A, "SELECT has_role($1, 'admin')", [U.ESTQ_A]);
    expect(r.ok).toBe(false);
  });
  it("funções administrativas internas não são executáveis por usuários", async () => {
    expect((await db.tentar(ESTQ_A, "SELECT importar_dados_legados('materiais', '[]')")).ok).toBe(
      false,
    );
    expect((await db.tentar(ESTQ_A, "SELECT consumir_limite_tentativa('x', 1, 1)")).ok).toBe(false);
    expect(
      (await db.tentar(ESTQ_A, "SELECT app_private.validar_hook('monitor_conferencias', 'x')")).ok,
    ).toBe(false);
  });
  it("funções de consulta usadas pela V1 continuam protegidas por empresa", async () => {
    const r = await db.tentar<{ v: number | null }>(
      ESTQ_B,
      "SELECT usuarios_ativos_empresa($1) AS v",
      [EMPRESA_A],
    );
    expect(r.ok && r.linhas[0].v).toBeNull();
    const p = await db.tentar<{ v: string | null }>(ADMIN_B, "SELECT empresa_do_usuario($1) AS v", [
      U.ESTQ_A,
    ]);
    expect(p.ok && p.linhas[0].v).toBeNull();
  });
});
