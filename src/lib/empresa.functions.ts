/**
 * FASE 3 — Criação da empresa pelo novo usuário.
 * A validação e o vínculo de proprietário acontecem no banco
 * (`criar_empresa_onboarding`), garantindo que nenhuma empresa exista sem
 * proprietário e que o frontend não escolha o dono.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DadosEmpresa = {
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  observacoes?: string | null;
  /** FASE 13 — segmento da empresa e módulos iniciais sugeridos. */
  segmento?: string | null;
  modulos?: { nome: string; descricao?: string | null; tipo?: string; icone?: string }[];
  /** Setores organizacionais criados no onboarding (pertencem à empresa). */
  setores?: { nome: string; descricao?: string | null }[];
};

const soDigitos = (v?: string | null) => (v ?? "").replace(/\D+/g, "");

/** Cria a empresa do novo usuário e o vincula como proprietário/administrador. */
export const criarMinhaEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: DadosEmpresa) => {
    const nome = (data.nome ?? "").trim();
    if (nome.length < 2) throw new Error("Informe o nome da empresa.");
    if (nome.length > 120) throw new Error("O nome da empresa é muito longo.");

    const cnpj = soDigitos(data.cnpj);
    if (cnpj && cnpj.length !== 14) throw new Error("O CNPJ deve ter 14 dígitos.");

    const email = (data.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
      throw new Error("Informe um e-mail empresarial válido.");
    if (email.length > 255) throw new Error("O e-mail é muito longo.");

    const telefone = soDigitos(data.telefone);
    if (telefone && (telefone.length < 10 || telefone.length > 13))
      throw new Error("Informe um telefone válido com DDD.");

    const observacoes = (data.observacoes ?? "").trim().slice(0, 500);

    const segmento = (data.segmento ?? "").trim().slice(0, 40) || null;
    const modulos = (Array.isArray(data.modulos) ? data.modulos : [])
      .slice(0, 20)
      .map((m) => ({
        nome: String(m?.nome ?? "").trim().slice(0, 60),
        descricao: (m?.descricao ?? "") ? String(m.descricao).trim().slice(0, 200) : null,
        tipo: ["lista", "caixa", "frota"].includes(String(m?.tipo)) ? String(m.tipo) : "lista",
        icone: String(m?.icone ?? "package").slice(0, 30),
      }))
      .filter((m) => m.nome.length >= 2);

    const setores = (Array.isArray(data.setores) ? data.setores : [])
      .slice(0, 40)
      .map((s) => ({
        nome: String(s?.nome ?? "").trim().slice(0, 60),
        descricao: (s?.descricao ?? "") ? String(s.descricao).trim().slice(0, 200) : null,
      }))
      .filter((s) => s.nome.length >= 2);

    return {
      nome,
      cnpj: cnpj || null,
      email: email || null,
      telefone: telefone || null,
      observacoes: observacoes || null,
      segmento,
      modulos,
      setores,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context as unknown as { supabase: any };

    const { data: empresaId, error } = await supabase.rpc("criar_empresa_onboarding", {
      _nome: data.nome,
      _cnpj: data.cnpj,
      _email: data.email,
      _telefone: data.telefone,
      _observacoes: data.observacoes,
    });
    if (error || !empresaId) {
      throw new Error(
        error?.message ?? "Não foi possível cadastrar a empresa agora. Tente novamente.",
      );
    }

    // FASE 13 — segmento e módulos iniciais da empresa.
    if (data.segmento) {
      await supabase
        .from("empresas")
        .update({ segmento: data.segmento, onboarding_etapa: "modulos" })
        .eq("id", empresaId);
    }
    if (data.setores.length) {
      await supabase.rpc("criar_setores_iniciais", {
        _empresa_id: empresaId,
        _setores: data.setores,
      });
    }
    if (data.modulos.length) {
      await supabase.rpc("criar_modulos_iniciais", {
        _empresa_id: empresaId,
        _modulos: data.modulos,
      });
    }

    // FASE 12 — trilha de auditoria do onboarding.
    await supabase.from("auditoria").insert({
      user_id: (context as unknown as { userId: string }).userId,
      tipo_acao: "onboarding",
      acao: "empresa_criada",
      modulo: "ONBOARDING",
      resultado: "sucesso",
      detalhe: `Empresa cadastrada no onboarding: ${data.nome}`,
    });

    return { empresaId: empresaId as string };
  });


/** Atualiza os dados cadastrais da empresa (somente administradores da empresa). */
export const atualizarMinhaEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: DadosEmpresa) => {
    const nome = (data.nome ?? "").trim();
    if (nome.length < 2) throw new Error("Informe o nome da empresa.");
    return {
      nome,
      cnpj: soDigitos(data.cnpj) || null,
      email: (data.email ?? "").trim().toLowerCase() || null,
      telefone: soDigitos(data.telefone) || null,
      observacoes: (data.observacoes ?? "").trim().slice(0, 500) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const { data: empresaId } = await supabase.rpc("empresa_do_usuario", { _user_id: userId });
    if (!empresaId) throw new Error("Seu usuário não está vinculado a nenhuma empresa.");

    const { error } = await supabase
      .from("empresas")
      .update({
        nome: data.nome,
        cnpj: data.cnpj,
        email_contato: data.email,
        telefone: data.telefone,
        observacoes: data.observacoes,
      })
      .eq("id", empresaId);
    if (error) throw new Error("Apenas administradores podem alterar os dados da empresa.");

    await supabase.from("auditoria").insert({
      user_id: userId,
      tipo_acao: "cadastro",
      acao: "empresa_atualizada",
      modulo: "ADMIN",
      resultado: "sucesso",
      detalhe: `Dados da empresa atualizados: ${data.nome}`,
    });

    return { ok: true };
  });

