/**
 * Dados de HOMOLOGAÇÃO (banco local descartável): duas empresas com assinatura ativa,
 * usuários de cada perfil e três listas — pequena (8 itens), média (120) e grande (1.000).
 * Pode rodar várias vezes: recria as listas e zera as conferências delas.
 */
import { criarUsuario, sql, type Usuario } from "./ambiente";

export const EMPRESA_H = "00000000-0000-4000-8000-0000000e0a01";
export const EMPRESA_X = "00000000-0000-4000-8000-0000000e0b01";
export const MODULO_H = "00000000-0000-4000-8000-0000000f0a01";
export const MODULO_X = "00000000-0000-4000-8000-0000000f0b01";
export const LISTAS = {
  pequena: { id: "00000000-0000-4000-8000-0000000a0001", nome: "Homolog Pequena", itens: 8 },
  media: { id: "00000000-0000-4000-8000-0000000a0002", nome: "Homolog Média", itens: 120 },
  grande: { id: "00000000-0000-4000-8000-0000000a0003", nome: "Homolog Grande", itens: 1000 },
  outra: { id: "00000000-0000-4000-8000-0000000b0001", nome: "Lista da Empresa X", itens: 5 },
} as const;

export type Usuarios = {
  admin: Usuario;
  conferenteA: Usuario;
  conferenteB: Usuario;
  outraEmpresa: Usuario;
};

async function vincular(u: Usuario, empresa: string, papel: string, perfil: string) {
  await sql(
    "UPDATE user_profiles SET perfil = $2, nome = $3, bloqueado = false WHERE user_id = $1",
    [u.id, perfil, u.nome],
  );
  await sql("DELETE FROM empresa_usuarios WHERE user_id = $1", [u.id]);
  await sql(
    "INSERT INTO empresa_usuarios (empresa_id, user_id, papel, ativo) VALUES ($1, $2, $3, true)",
    [empresa, u.id, papel],
  );
}

async function empresa(id: string, nome: string) {
  await sql(
    `INSERT INTO empresas (id, nome, ativo, bloqueada, onboarding_etapa, segmento)
     VALUES ($1, $2, true, false, 'concluido', 'industria')
     ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, ativo = true, bloqueada = false`,
    [id, nome],
  );
  await sql("DELETE FROM assinaturas WHERE empresa_id = $1", [id]);
  for (const ambiente of ["live", "sandbox"]) {
    await sql(
      `INSERT INTO assinaturas (empresa_id, plano_codigo, ambiente, status, provider, periodo_atual_fim, data_inicio)
       VALUES ($1, 'homologacao', $2, 'ativa', 'mercadopago', now() + interval '30 days', now())`,
      [id, ambiente],
    );
  }
}

async function modulo(id: string, empresaId: string) {
  await sql(
    `INSERT INTO empresa_modulos (id, empresa_id, codigo, nome, tipo, icone, ativo, excluido)
     VALUES ($1, $2, 'FROTA', 'Frota Homologação', 'frota', 'truck', true, false)
     ON CONFLICT (id) DO UPDATE SET ativo = true, excluido = false`,
    [id, empresaId],
  );
}

async function lista(id: string, nome: string, empresaId: string, itens: number) {
  await sql(
    "UPDATE conferencias SET status = 'cancelada', hora_fim = now() WHERE unidade_id = $1 AND status IN ('em_andamento','pausada')",
    [id],
  );
  await sql(
    `INSERT INTO unidades (id, tipo, nome, empresa_id, modulo_id, gestor, ativo)
     VALUES ($1, 'frota', $2, $3, $4, 'Gestor Homolog', true)
     ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, ativo = true, tipo = 'frota', modulo_id = excluded.modulo_id`,
    [id, nome, empresaId, empresaId === EMPRESA_H ? MODULO_H : MODULO_X],
  );
  const existentes = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM materiais WHERE unidade_id = $1",
    [id],
  );
  if (existentes[0].n === itens) return;
  await sql(
    "DELETE FROM materiais WHERE unidade_id = $1 AND NOT EXISTS (SELECT 1 FROM conferencia_itens ci WHERE ci.material_id = materiais.id)",
    [id],
  );
  await sql(
    `INSERT INTO materiais (unidade_id, codigo, descricao, quantidade_esperada, locacao)
     SELECT $1, 'H' || lpad(g::text, 4, '0'), 'Material homologação ' || g, (g % 7) + 1,
            'C' || lpad((1 + g / 50)::text, 2, '0') || '-P' || chr(65 + (g / 10) % 5) || '-' || lpad((g % 10)::text, 2, '0')
       FROM generate_series(1, $2::int) g
      WHERE NOT EXISTS (SELECT 1 FROM materiais m WHERE m.unidade_id = $1 AND m.codigo = 'H' || lpad(g::text, 4, '0'))`,
    [id, itens],
  );
}

export async function semear(): Promise<Usuarios> {
  const usuarios: Usuarios = {
    admin: await criarUsuario("admin.homolog@teste.local", "Admin Homolog"),
    conferenteA: await criarUsuario("conferente.a@teste.local", "Conferente A"),
    conferenteB: await criarUsuario("conferente.b@teste.local", "Conferente B"),
    outraEmpresa: await criarUsuario("conferente.x@teste.local", "Conferente X"),
  };
  await empresa(EMPRESA_H, "Empresa Homologação");
  await empresa(EMPRESA_X, "Empresa X");
  await modulo(MODULO_H, EMPRESA_H);
  await modulo(MODULO_X, EMPRESA_X);
  await vincular(usuarios.admin, EMPRESA_H, "administrador", "administrador");
  await vincular(usuarios.conferenteA, EMPRESA_H, "membro", "agricola");
  await vincular(usuarios.conferenteB, EMPRESA_H, "membro", "agricola");
  await vincular(usuarios.outraEmpresa, EMPRESA_X, "membro", "agricola");
  for (const l of [LISTAS.pequena, LISTAS.media, LISTAS.grande]) {
    await lista(l.id, l.nome, EMPRESA_H, l.itens);
  }
  await lista(LISTAS.outra.id, LISTAS.outra.nome, EMPRESA_X, LISTAS.outra.itens);
  return usuarios;
}
