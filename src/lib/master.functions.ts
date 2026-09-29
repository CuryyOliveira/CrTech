/**
 * PAINEL MASTER DO PROPRIETÁRIO — funções de servidor (RPC tipado).
 *
 * Toda função valida a identidade Master no servidor antes de qualquer leitura
 * ou escrita. Abrir a URL /master direto, chamar o endpoint na mão ou alterar
 * o perfil no banco não concede acesso.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import * as restauracao from "@/lib/restauracao-legado";

export type {
  EmpresaResumoMaster,
  EmpresaDetalheMaster,
  UsuarioEmpresaMaster,
  StatusEmpresa,
} from "@/lib/master.server";

/** Informa ao frontend se o usuário atual é o proprietário Master. */
export const souMaster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ehMaster } = await import("@/lib/master.server");
    return { master: await ehMaster(context as any) };
  });

/** Lista empresas com pesquisa por nome/CNPJ e paginação. */
export const listarEmpresasMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { busca?: string; pagina?: number; porPagina?: number }) => ({
    busca: (data?.busca ?? "").slice(0, 120),
    pagina: Math.max(1, Math.trunc(data?.pagina ?? 1)),
    porPagina: Math.min(50, Math.max(5, Math.trunc(data?.porPagina ?? 20))),
  }))
  .handler(async ({ data, context }) => {
    const { exigirMaster, listarEmpresas } = await import("@/lib/master.server");
    await exigirMaster(context as any);
    return listarEmpresas(data);
  });

/** Detalhes completos de uma empresa (cadastro, assinatura e usuários). */
export const detalheEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    return { empresaId: id };
  })
  .handler(async ({ data, context }) => {
    const { exigirMaster, detalheEmpresa } = await import("@/lib/master.server");
    await exigirMaster(context as any);
    return detalheEmpresa(data.empresaId);
  });

/** Bloqueia o acesso da empresa (com motivo obrigatório) — reversível. */
export const bloquearEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string; motivo: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    const motivo = (data?.motivo ?? "").trim();
    if (motivo.length < 5) throw new Error("Descreva o motivo do bloqueio (mínimo 5 caracteres).");
    return { empresaId: id, motivo: motivo.slice(0, 300) };
  })
  .handler(async ({ data, context }) => {
    const master = await import("@/lib/master.server");
    const { userId } = await master.exigirMaster(context as any);
    const antes = await master.alterarEstadoEmpresa(data.empresaId, {
      bloqueada: true,
      bloqueada_em: new Date().toISOString(),
      motivo_bloqueio: data.motivo,
    });
    await master.auditarMaster(userId, "empresa_bloqueada", antes, { motivo: data.motivo });
    return { ok: true };
  });

/** Remove o bloqueio administrativo da empresa. */
export const desbloquearEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    return { empresaId: id };
  })
  .handler(async ({ data, context }) => {
    const master = await import("@/lib/master.server");
    const { userId } = await master.exigirMaster(context as any);
    const antes = await master.alterarEstadoEmpresa(data.empresaId, {
      bloqueada: false,
      bloqueada_em: null,
      motivo_bloqueio: null,
    });
    await master.auditarMaster(userId, "empresa_desbloqueada", antes);
    return { ok: true };
  });

/**
 * Desativa (ou reativa) a empresa. Ação crítica: exige confirmação pelo nome
 * exato. Nada é apagado — os dados permanecem preservados no banco.
 */
export const desativarEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string; confirmacao: string; motivo?: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    return {
      empresaId: id,
      confirmacao: (data?.confirmacao ?? "").trim(),
      motivo: (data?.motivo ?? "").trim().slice(0, 300) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const master = await import("@/lib/master.server");
    const { userId } = await master.exigirMaster(context as any);
    const { detalheEmpresa } = master;
    const atual = await detalheEmpresa(data.empresaId);
    const nome = atual.empresa.nome.trim();
    if (data.confirmacao !== nome) {
      throw new Error(`Digite exatamente "${nome}" para confirmar a desativação.`);
    }
    const antes = await master.alterarEstadoEmpresa(data.empresaId, {
      ativo: false,
      desativada_em: new Date().toISOString(),
      motivo_bloqueio: data.motivo,
    });
    await master.auditarMaster(userId, "empresa_desativada", antes, { motivo: data.motivo });
    return { ok: true };
  });

/** Reativa uma empresa desativada. */
export const reativarEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    return { empresaId: id };
  })
  .handler(async ({ data, context }) => {
    const master = await import("@/lib/master.server");
    const { userId } = await master.exigirMaster(context as any);
    const antes = await master.alterarEstadoEmpresa(data.empresaId, {
      ativo: true,
      desativada_em: null,
      motivo_bloqueio: null,
    });
    await master.auditarMaster(userId, "empresa_reativada", antes);
    return { ok: true };
  });

/**
 * Exclusão definitiva da empresa (irreversível). Exige confirmação pelo nome
 * exato. Remove cadastro, vínculos de usuários e histórico de assinaturas.
 */
export const excluirEmpresaMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { empresaId: string; confirmacao: string; motivo?: string }) => {
    const id = (data?.empresaId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Empresa inválida.");
    return {
      empresaId: id,
      confirmacao: (data?.confirmacao ?? "").trim(),
      motivo: (data?.motivo ?? "").trim().slice(0, 300) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const master = await import("@/lib/master.server");
    const { userId } = await master.exigirMaster(context as any);
    const atual = await master.detalheEmpresa(data.empresaId);
    const nome = atual.empresa.nome.trim();
    if (data.confirmacao !== nome) {
      throw new Error(`Digite exatamente "${nome}" para confirmar a exclusão.`);
    }
    const antes = await master.excluirEmpresa(data.empresaId);
    await master.auditarMaster(userId, "empresa_excluida", antes, { motivo: data.motivo });
    return { ok: true };
  });

/** Números agregados do SaaS. */
export const visaoGeralMaster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { exigirMaster, visaoGeral } = await import("@/lib/master.server");
    await exigirMaster(context as any);
    return visaoGeral();
  });

/** Auditoria das ações realizadas no Painel Master. */
export const auditoriaMasterLista = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limite?: number }) => ({
    limite: Math.min(200, Math.max(10, Math.trunc(data?.limite ?? 60))),
  }))
  .handler(async ({ data, context }) => {
    const { exigirMaster, auditoriaMaster } = await import("@/lib/master.server");
    await exigirMaster(context as any);
    return auditoriaMaster(data.limite);
  });

/**
 * Restaura um lote de registros exportados da Lovable Cloud (mantém os IDs originais).
 * Só o proprietário Master pode chamar; a gravação é feita pela função do banco
 * `importar_dados_legados`, restrita ao servidor.
 */
export const restaurarDadosMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { tabela: string; registros: Record<string, string>[] }) => {
    const { ORDEM_RESTAURACAO } = restauracao;
    const tabela = String(data?.tabela ?? "");
    if (!(ORDEM_RESTAURACAO as readonly string[]).includes(tabela)) {
      throw new Error("Tabela não permitida na restauração.");
    }
    if (!Array.isArray(data?.registros) || data.registros.length > 1000) {
      throw new Error("Lote inválido.");
    }
    return { tabela, registros: data.registros };
  })
  .handler(async ({ data, context }) => {
    const { exigirMaster } = await import("@/lib/master.server");
    await exigirMaster(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: gravados, error } = await (supabaseAdmin as any).rpc("importar_dados_legados", {
      _tabela: data.tabela,
      _registros: data.registros,
    });
    if (error) throw new Error(error.message);
    return { gravados: Number(gravados ?? 0) };
  });
