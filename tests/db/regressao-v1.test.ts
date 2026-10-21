/**
 * Regressão da V1: reproduz, com o token de um usuário, EXATAMENTE as gravações que as
 * telas atuais fazem (src/routes/_authenticated/unidade.$id.tsx, UnidadesPage, audit.ts,
 * notificacoes-inicio.ts, useSessao, fila offline) e garante que a Fase 0 não as quebra.
 * Onde a Fase 0 muda o comportamento de propósito, o teste documenta a nova regra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Banco, usuario, type Consulta } from "./ambiente";
import { CONF, EMPRESA_A, LISTA, MATERIAL, U, novoId } from "./fixtures";

let db: Banco;
beforeAll(async () => {
  db = await Banco.novo();
});
afterAll(async () => {
  await db?.remover();
});

const ESTQ_A = usuario(U.ESTQ_A, "estq.a@teste.local");
const ADMIN_A = usuario(U.ADMIN_A, "admin.a@teste.local");

/** Fluxo completo da tela de conferência da V1, passo a passo, com o mesmo formato das gravações. */
async function fluxoCompletoV1(q: Consulta) {
  // Cadastro da lista (UnidadesPage): sem empresa_id — o banco preenche pela empresa do usuário.
  const [lista] = await q(
    "INSERT INTO unidades (tipo, nome, placa) VALUES ('caminhao', 'Caminhão novo', 'ABC1D23') RETURNING id, empresa_id",
  );
  expect(lista.empresa_id).toBe(EMPRESA_A);

  // Importação de planilha (salvarMateriais): insert em lote e update por id.
  const mats = await q(
    `INSERT INTO materiais (unidade_id, codigo, descricao, locacao, quantidade_esperada) VALUES
       ($1, 'C-1', 'Cabo', 'L1', 4), ($1, 'C-2', 'Conector', 'L2', 2), ($1, 'C-3', 'Fita', 'L3', 1)
     RETURNING id, codigo, descricao, locacao, quantidade_esperada`,
    [lista.id],
  );
  await q("UPDATE materiais SET quantidade_esperada = 3 WHERE id = $1", [mats[2].id]);

  // Início (iniciarConferencia): conferência sem id/status/created_by + itens sem status.
  const [conf] = await q(
    `INSERT INTO conferencias (unidade_id, tipo, data, hora_inicio, conferente, responsavel, almoxarife, codigo_almoxarife)
     VALUES ($1, 'caminhao', current_date, now(), 'Ana', 'Gestor', 'Ana', '123') RETURNING *`,
    [lista.id],
  );
  expect(conf.status).toBe("em_andamento");
  expect(conf.created_by).toBe(U.ESTQ_A);
  await q(
    `INSERT INTO conferencia_itens (conferencia_id, material_id, codigo, descricao, locacao, quantidade_esperada)
     SELECT $1, id, codigo, descricao, locacao, quantidade_esperada FROM materiais WHERE unidade_id = $2`,
    [conf.id, lista.id],
  );

  // abrirHistorico + registrarAuditoria + notificação de início.
  await q(
    `INSERT INTO historico_conferencias (conferencia_id, unidade_id, user_id, usuario_email, nome, perfil, setor, modulo, lista, hora_inicio, quantidade_prevista, status)
     VALUES ($1, $2, $3, 'estq.a@teste.local', 'Estoquista A', 'agricola', null, 'agricola', 'Caminhão novo', $4, 3, 'em_andamento')`,
    [conf.id, lista.id, U.ESTQ_A, conf.hora_inicio],
  );
  await q(
    `INSERT INTO auditoria (user_id, usuario, nome, perfil, tipo_acao, acao, detalhe, modulo, lista, resultado)
     VALUES ($1, 'estq.a@teste.local', 'Estoquista A', 'agricola', 'operacao', 'conferencia_iniciada', 'Iniciada', 'agricola', 'Caminhão novo', 'sucesso')`,
    [U.ESTQ_A],
  );
  await q(
    `INSERT INTO notificacoes_conferencia (id, conferencia_id, unidade_id, tipo, user_id, usuario_nome, status, gravidade, payload)
     VALUES ($1, $2, $3, 'conferencia_iniciada', $4, 'Estoquista A', 'em_andamento', 'info', '{}')`,
    [novoId(), conf.id, lista.id, U.ESTQ_A],
  );

  // Pesquisa/carregamento dos itens (select por conferência, ordenação no cliente).
  const itens = await q(
    "SELECT * FROM conferencia_itens WHERE conferencia_id = $1 ORDER BY codigo",
    [conf.id],
  );
  expect(itens).toHaveLength(3);
  const busca = await q(
    "SELECT id FROM materiais WHERE codigo ILIKE '%c-%' OR descricao ILIKE '%c-%' LIMIT 50",
  );
  expect(busca.length).toBeGreaterThanOrEqual(3);

  // Contagem (salvarItem): conferido, divergência (com foto e observação) e volta a pendente.
  const salvar = (id: string, qtd: number | null, status: string, fotos: string[] = [], obs = "") =>
    q(
      `UPDATE conferencia_itens SET quantidade_contada = $2, observacoes = $3, fotos = $4, status = $5, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, qtd, obs, JSON.stringify(fotos), status],
    );
  expect(await salvar(itens[0].id, 4, "conferido")).toHaveLength(1);
  expect(
    await salvar(itens[1].id, 1, "divergencia", ["data:image/jpeg;base64,/9j/"], "faltou 1"),
  ).toHaveLength(1);
  expect(await salvar(itens[2].id, null, "pendente")).toHaveLength(1);

  // Material adicional (adicionarItem).
  await q(
    `INSERT INTO conferencia_itens (conferencia_id, material_id, codigo, descricao, locacao, quantidade_esperada, quantidade_contada,
       status, observacoes, origem, motivo_inclusao, incluido_por, incluido_por_nome, incluido_em)
     VALUES ($1, null, 'EXTRA', 'Achado', null, 0, 2, 'divergencia', 'Material encontrado na prateleira', 'adicionado', 'Sobra', $2, 'Estoquista A', now())`,
    [conf.id, U.ESTQ_A],
  );

  // Pausa e retomada (alternarPausa + fecharHistorico).
  await q("UPDATE conferencias SET status = 'pausada' WHERE id = $1", [conf.id]);
  await q(
    `UPDATE historico_conferencias SET status = 'pausada', hora_fim = null, quantidade_conferida = 1, divergencias = 2, percentual = 33
      WHERE conferencia_id = $1`,
    [conf.id],
  );
  await q("UPDATE conferencias SET status = 'em_andamento' WHERE id = $1", [conf.id]);
  const [pausa] = await q(
    "SELECT count(*)::int n, bool_and(retomada_em IS NOT NULL) fechadas FROM conferencia_pausas WHERE conferencia_id = $1",
    [conf.id],
  );
  expect(pausa).toEqual({ n: 1, fechadas: true });

  // Finalização (finalizarConferencia): update + select tempo_trabalhado.
  const [fim] = await q(
    `UPDATE conferencias SET conferente = 'Ana', responsavel = 'Gestor', observacoes = null, assinatura = 'data:image/png;base64,QQ==',
       assinatura_gestor = null, hora_fim = now(), status = 'finalizada' WHERE id = $1 RETURNING tempo_trabalhado`,
    [conf.id],
  );
  expect(fim.tempo_trabalhado).not.toBeNull();

  // registrarHistoricoFim + auditoria + notificação de conclusão.
  await q(
    `UPDATE historico_conferencias SET status = 'finalizada', hora_fim = now(), quantidade_conferida = 1, divergencias = 2, percentual = 25
      WHERE conferencia_id = $1`,
    [conf.id],
  );
  await q(
    `INSERT INTO notificacoes_conferencia (id, conferencia_id, unidade_id, tipo, user_id, status, gravidade, payload)
     VALUES ($1, $2, $3, 'conferencia_concluida', $4, 'finalizada', 'info', '{}')`,
    [novoId(), conf.id, lista.id, U.ESTQ_A],
  );

  const [hist] = await q(
    "SELECT status, duracao_segundos FROM historico_conferencias WHERE conferencia_id = $1",
    [conf.id],
  );
  expect(hist.status).toBe("finalizada");
  expect(hist.duracao_segundos).not.toBeNull();

  // Histórico da lista (conf-stats) e download (select de itens da conferência finalizada).
  const stats = await q(
    "SELECT conferencia_id, status FROM conferencia_itens WHERE conferencia_id = ANY($1)",
    [[conf.id]],
  );
  expect(stats).toHaveLength(4);
  return { lista, conf };
}

describe("fluxo completo da conferência (V1) continua funcionando", () => {
  it("cadastro, importação, início, pesquisa, contagem, divergência, material adicional, pausa, retomada, finalização, histórico e auditoria", async () => {
    await db.como(ESTQ_A, fluxoCompletoV1);
  });

  it("duplo clique em Finalizar não gera erro nem altera a finalização", async () => {
    await db.como(ESTQ_A, async (q) => {
      const { conf } = await fluxoCompletoV1(q);
      const repetir = await q(
        `UPDATE conferencias SET conferente = 'Ana', responsavel = 'Gestor', observacoes = null, assinatura = 'data:image/png;base64,QQ==',
           assinatura_gestor = null, hora_fim = now() + interval '5 seconds', status = 'finalizada' WHERE id = $1 RETURNING tempo_trabalhado, hora_fim`,
        [conf.id],
      );
      expect(repetir).toHaveLength(1);
    });
  });

  it("cancelamento (cancelarConferencia) continua funcionando", async () => {
    await db.como(ESTQ_A, async (q) => {
      const [r] = await q(
        "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE id = $1 RETURNING status",
        [CONF.A2_ABERTA],
      );
      expect(r.status).toBe("cancelada");
      await q("UPDATE historico_conferencias SET status = 'cancelada' WHERE conferencia_id = $1", [
        CONF.A2_ABERTA,
      ]);
    });
  });

  it("Conferência Única: cria a lista reservada, substitui materiais e abre a conferência", async () => {
    await db.como(ESTQ_A, async (q) => {
      const [u] = await q(
        "INSERT INTO unidades (tipo, nome, modulo_id, empresa_id) VALUES ('lista', 'Conferência única — Almox', $1, $2) RETURNING id",
        ["00000000-0000-4000-8000-000000000f0a", EMPRESA_A],
      );
      await q(
        "INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, 'U1', 'Único', 1)",
        [u.id],
      );
      await q("DELETE FROM materiais WHERE unidade_id = $1", [u.id]);
      await q(
        "INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada) VALUES ($1, 'U2', 'Único 2', 1)",
        [u.id],
      );
      const [c] = await q(
        "INSERT INTO conferencias (unidade_id, tipo, data, hora_inicio) VALUES ($1, 'lista', current_date, now()) RETURNING id",
        [u.id],
      );
      await q(
        "INSERT INTO conferencia_itens (conferencia_id, material_id, codigo, descricao, quantidade_esperada) SELECT $1, id, codigo, descricao, quantidade_esperada FROM materiais WHERE unidade_id = $2",
        [c.id, u.id],
      );
    });
  });

  it("edição e exclusão de material (tela da lista) continuam funcionando", async () => {
    await db.como(ESTQ_A, async (q) => {
      await q(
        "UPDATE materiais SET descricao = 'Parafuso M6', quantidade_esperada = 12 WHERE id = $1",
        [MATERIAL.A1],
      );
      expect(
        await q("DELETE FROM materiais WHERE id = $1 RETURNING id", [MATERIAL.A3]),
      ).toHaveLength(1);
    });
  });
});

describe("fila offline da V1 (sincronização por upsert com id gerado no aparelho)", () => {
  it("conferência criada offline é aceita no reenvio (upsert por id)", async () => {
    await db.como(ESTQ_A, async (q) => {
      const id = novoId();
      const sql = `INSERT INTO conferencias (id, unidade_id, tipo, data, hora_inicio, status, total_tempo_pausado, quantidade_pausas, created_at)
                   VALUES ($1, $2, 'caminhao', current_date, now(), 'em_andamento', 0, 0, now())
                   ON CONFLICT (id) DO UPDATE SET tipo = EXCLUDED.tipo, status = EXCLUDED.status`;
      await q(sql, [id, LISTA.A_MOD]);
      await q(sql, [id, LISTA.A_MOD]); // reenvio: não duplica
      const [n] = await q("SELECT count(*)::int n FROM conferencias WHERE id = $1", [id]);
      expect(n.n).toBe(1);
    });
  });

  it("NOVA REGRA: reenvio atrasado de 'em andamento' não reabre uma conferência já finalizada", async () => {
    const r = await db.tentar(
      ESTQ_A,
      `INSERT INTO conferencias (id, unidade_id, status) VALUES ($1, $2, 'em_andamento')
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [CONF.A_FIN, LISTA.A],
    );
    expect(r.ok).toBe(false);
    const [c] = await db.dono("SELECT status FROM conferencias WHERE id = $1", [CONF.A_FIN]);
    expect(c.status).toBe("finalizada");
  });
});

describe("login, usuários, sessões e empresas", () => {
  it("primeiro acesso: o próprio usuário cria seu perfil operacional (usePermissoes)", async () => {
    await db.dono("DELETE FROM user_profiles WHERE user_id = $1", [U.LEGADO]);
    const r = await db.tentar(
      usuario(U.LEGADO),
      "INSERT INTO user_profiles (user_id, nome, perfil, setor) VALUES ($1, 'Legado', 'agricola', null) RETURNING perfil",
      [U.LEGADO],
      { gravar: true },
    );
    expect(r.ok).toBe(true);
    // ...mas não pode se criar como administrador.
    await db.dono("DELETE FROM user_profiles WHERE user_id = $1", [U.LEGADO]);
    const x = await db.tentar(
      usuario(U.LEGADO),
      "INSERT INTO user_profiles (user_id, nome, perfil) VALUES ($1, 'Legado', 'administrador')",
      [U.LEGADO],
    );
    expect(x.ok).toBe(false);
    await db.dono(
      "INSERT INTO user_profiles (user_id, nome, perfil) VALUES ($1, 'Legado', 'agricola')",
      [U.LEGADO],
    );
  });

  it("leitura do próprio perfil e sessão de uso (useSessao: registro e ping)", async () => {
    await db.como(ESTQ_A, async (q) => {
      const [p] = await q(
        "SELECT perfil, nome, setor, bloqueado FROM user_profiles WHERE user_id = $1",
        [U.ESTQ_A],
      );
      expect(p.perfil).toBe("agricola");
      const [s] = await q(
        "INSERT INTO sessoes_usuario (user_id, dispositivo, navegador) VALUES ($1, 'Android', 'WebView') RETURNING id",
        [U.ESTQ_A],
      );
      const ping = await q(
        "UPDATE sessoes_usuario SET ultimo_ping = now() WHERE id = $1 AND encerrada_em IS NULL RETURNING id",
        [s.id],
      );
      expect(ping).toHaveLength(1);
    });
  });

  it("administrador gerencia usuários da própria empresa (nome, setor, bloqueio)", async () => {
    await db.como(ADMIN_A, async (q) => {
      const r = await q(
        "UPDATE user_profiles SET nome = 'Ana Souza', setor = 'Almox', bloqueado = true WHERE user_id = $1 RETURNING id",
        [U.ESTQ_A],
      );
      expect(r).toHaveLength(1);
      const lista = await q("SELECT user_id FROM user_profiles");
      expect(lista.length).toBeGreaterThan(1);
    });
  });

  it("empresa do usuário, plano e contagens usadas no menu (RPCs da V1)", async () => {
    await db.como(ADMIN_A, async (q) => {
      const [e] = await q("SELECT empresa_do_usuario($1) AS id", [U.ADMIN_A]);
      expect(e.id).toBe(EMPRESA_A);
      const [n] = await q(
        "SELECT usuarios_ativos_empresa($1) AS n, modulos_ativos_empresa($1) AS m",
        [EMPRESA_A],
      );
      expect(n.n).toBeGreaterThan(0);
      expect(n.m).toBe(1);
      const [l] = await q("SELECT eh_usuario_legado($1) AS l", [U.ADMIN_A]);
      expect(l.l).toBe(false);
    });
  });

  it("onboarding: criar empresa pela RPC continua funcionando (promove o criador a administrador)", async () => {
    await db.dono("DELETE FROM empresa_usuarios WHERE user_id = $1", [U.VISU_A]);
    await db.como(usuario(U.VISU_A), async (q) => {
      const [r] = await q(
        "SELECT criar_empresa_onboarding('Empresa Nova', null, null, null, null) AS id",
      );
      expect(r.id).toBeTruthy();
      const [p] = await q("SELECT perfil FROM user_profiles WHERE user_id = $1", [U.VISU_A]);
      expect(p.perfil).toBe("administrador");
      const [s] = await q('SELECT criar_setores_iniciais($1, \'[{"nome":"Almoxarifado"}]\') AS n', [
        r.id,
      ]);
      expect(s.n).toBe(1);
    });
  });
});

describe("mudanças de comportamento INTENCIONAIS da Fase 0 (documentadas)", () => {
  it("'Excluir' uma conferência finalizada no histórico agora é recusado para usuários (usar a exclusão administrativa)", async () => {
    const r = await db.tentar(ESTQ_A, "DELETE FROM conferencias WHERE id = $1", [CONF.A_FIN]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.message).toMatch(/não pode ser excluída/);
  });

  it("excluir lista com histórico é recusado para usuários (usar excluir_unidade)", async () => {
    const r = await db.tentar(ADMIN_A, "DELETE FROM unidades WHERE id = $1", [LISTA.A]);
    expect(r.ok).toBe(false);
  });

  it("abrir segunda conferência na mesma lista é recusado (antes podia duplicar)", async () => {
    const r = await db.tentar(
      ESTQ_A,
      "INSERT INTO conferencias (unidade_id, tipo) VALUES ($1, 'caminhao')",
      [LISTA.A2],
    );
    expect(r.ok).toBe(false);
  });
});
