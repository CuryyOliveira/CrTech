-- FASE 0 — Autorização com fonte única e isolamento por empresa.
--
-- Fonte única de verdade: o NÍVEL do perfil (user_profiles.perfil → app_private.nivel),
-- que já considera o bloqueio (usuário bloqueado = nível 0).
-- A estrutura antiga (tabela user_roles / enum app_role) NÃO é removida: continua sendo
-- preenchida no cadastro, mas deixa de decidir acesso nas policies.
-- Equivalência verificada com os dados atuais de produção (docs/AUTHORIZATION_MODEL.md).
--
-- Migration aditiva: somente CREATE OR REPLACE de funções, novas funções/trigger e
-- troca de policies. Nenhuma tabela ou dado é removido.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Funções de autorização
-- ---------------------------------------------------------------------------

-- Pode operar listas, materiais e conferências (Conferente/Estoquista e acima).
CREATE OR REPLACE FUNCTION app_private.pode_operar(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT app_private.nivel(_user_id) >= 2
$$;

-- Usuário possui vínculo ativo com alguma empresa.
CREATE OR REPLACE FUNCTION app_private.tem_empresa(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.empresa_usuarios eu WHERE eu.user_id = _user_id AND eu.ativo = true
  )
$$;

-- Acesso por tipo de lista (listas legadas, sem módulo). Mesmo resultado de antes, mas
-- pelo nível (sem colapsar perfis) e respeitando o bloqueio do usuário.
CREATE OR REPLACE FUNCTION app_private.pode_tipo(_tipo text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN app_private.nivel(auth.uid()) >= 3 THEN true
    WHEN app_private.nivel(auth.uid()) = 2 THEN
      CASE (SELECT perfil FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1)
        WHEN 'agricola' THEN _tipo IN ('caminhao', 'caixa', 'prateleira')
        WHEN 'industria' THEN _tipo IN ('caixa_industria', 'prateleira_industria')
        ELSE false
      END
    ELSE false
  END
$$;

-- Acesso a uma lista (unidade):
--   * lista sem empresa: somente acesso global (nível ≥ 5) — antes era aberta a todos;
--   * lista de módulo da empresa: membro da empresa com nível ≥ 2;
--   * lista legada: membro da empresa, ou usuário legado SEM empresa vinculado a uma
--     empresa legada (antes qualquer usuário legado, mesmo de outra empresa).
CREATE OR REPLACE FUNCTION app_private.acesso_unidade(_tipo text, _empresa_id uuid, _modulo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT CASE
    WHEN _empresa_id IS NULL THEN app_private.eh_global(auth.uid())
    WHEN _modulo_id IS NOT NULL THEN
      app_private.pertence_empresa(_empresa_id, auth.uid())
      AND app_private.nivel(auth.uid()) >= 2
    ELSE
      (
        app_private.pertence_empresa(_empresa_id, auth.uid())
        OR (
          app_private.eh_legado(auth.uid())
          AND NOT app_private.tem_empresa(auth.uid())
          AND app_private.empresa_legada(_empresa_id)
        )
      )
      AND app_private.pode_tipo(_tipo)
  END
$$;

-- Usuários visíveis/administráveis por um administrador: ele mesmo, acesso global,
-- mesma empresa, ou (legado) outro usuário legado. Removida a "visão global" de quem
-- foi criado antes de 10/08/2026, que permitia ver e alterar usuários de outras empresas.
CREATE OR REPLACE FUNCTION app_private.mesma_empresa_ou_legado(_alvo uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  SELECT
    _alvo = auth.uid()
    OR app_private.eh_global(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios a
        JOIN public.empresa_usuarios b ON b.empresa_id = a.empresa_id
       WHERE a.user_id = auth.uid() AND b.user_id = _alvo
    )
    OR (app_private.eh_legado(auth.uid()) AND app_private.eh_legado(_alvo))
$$;

REVOKE ALL ON FUNCTION app_private.pode_operar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.tem_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.pode_operar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.tem_empresa(uuid) TO authenticated, service_role;

-- has_role (público) não é usada pelo sistema e revela papéis via /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated, anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Hierarquia de perfis protegida no banco
--    Antes, pela API direta, um Administrador (nível 4) podia alterar o PRÓPRIO perfil
--    para super_admin (nível 5 = acesso global a todas as empresas). As funções do
--    servidor já aplicam a regra; agora o banco também aplica para chamadas feitas com
--    o token do usuário (current_user = authenticated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.proteger_hierarquia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  quem uuid := auth.uid();
  meu_nivel int;
BEGIN
  -- Servidor (service_role) e funções internas do banco são confiáveis e têm regras próprias.
  IF quem IS NULL OR current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Autocadastro inicial (perfil operacional do próprio usuário, já limitado pela policy).
  IF TG_OP = 'INSERT' AND NEW.user_id = quem AND NEW.perfil IN ('agricola', 'industria')
     AND NOT NEW.bloqueado THEN
    RETURN NEW;
  END IF;

  meu_nivel := app_private.nivel(quem);

  IF TG_OP = 'UPDATE' AND NEW.user_id = quem
     AND (NEW.perfil IS DISTINCT FROM OLD.perfil OR NEW.bloqueado IS DISTINCT FROM OLD.bloqueado) THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio perfil de acesso ou bloqueio'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND app_private.nivel_perfil(OLD.perfil) > meu_nivel THEN
    RAISE EXCEPTION 'Não é permitido alterar um usuário de nível superior ao seu'
      USING ERRCODE = '42501';
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.perfil IS DISTINCT FROM OLD.perfil)
     AND app_private.nivel_perfil(NEW.perfil) > meu_nivel THEN
    RAISE EXCEPTION 'Não é permitido atribuir um perfil de nível superior ao seu'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_hierarquia ON public.user_profiles;
CREATE TRIGGER trg_proteger_hierarquia
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_hierarquia();

-- ---------------------------------------------------------------------------
-- 3. Policies: conferências, itens, materiais e listas — sem user_roles
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS conferencias_insert ON public.conferencias;
DROP POLICY IF EXISTS conferencias_update ON public.conferencias;
DROP POLICY IF EXISTS conferencias_delete ON public.conferencias;
CREATE POLICY conferencias_insert ON public.conferencias AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY conferencias_update ON public.conferencias AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()))
  WITH CHECK (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY conferencias_delete ON public.conferencias AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));

DROP POLICY IF EXISTS conferencia_itens_insert ON public.conferencia_itens;
DROP POLICY IF EXISTS conferencia_itens_update ON public.conferencia_itens;
DROP POLICY IF EXISTS conferencia_itens_delete ON public.conferencia_itens;
CREATE POLICY conferencia_itens_insert ON public.conferencia_itens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.conferencias c
             WHERE c.id = conferencia_itens.conferencia_id AND app_private.pode_unidade(c.unidade_id))
    AND app_private.pode_operar(auth.uid()));
CREATE POLICY conferencia_itens_update ON public.conferencia_itens AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.conferencias c
             WHERE c.id = conferencia_itens.conferencia_id AND app_private.pode_unidade(c.unidade_id))
    AND app_private.pode_operar(auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.conferencias c
             WHERE c.id = conferencia_itens.conferencia_id AND app_private.pode_unidade(c.unidade_id))
    AND app_private.pode_operar(auth.uid()));
CREATE POLICY conferencia_itens_delete ON public.conferencia_itens AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.conferencias c
             WHERE c.id = conferencia_itens.conferencia_id AND app_private.pode_unidade(c.unidade_id))
    AND app_private.pode_operar(auth.uid()));

DROP POLICY IF EXISTS materiais_insert ON public.materiais;
DROP POLICY IF EXISTS materiais_update ON public.materiais;
DROP POLICY IF EXISTS materiais_delete ON public.materiais;
CREATE POLICY materiais_insert ON public.materiais AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY materiais_update ON public.materiais AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()))
  WITH CHECK (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY materiais_delete ON public.materiais AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.pode_unidade(unidade_id) AND app_private.pode_operar(auth.uid()));

DROP POLICY IF EXISTS unidades_insert ON public.unidades;
DROP POLICY IF EXISTS unidades_update ON public.unidades;
DROP POLICY IF EXISTS unidades_delete ON public.unidades;
CREATE POLICY unidades_insert ON public.unidades AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY unidades_update ON public.unidades AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND app_private.pode_operar(auth.uid()))
  WITH CHECK (app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND app_private.pode_operar(auth.uid()));
CREATE POLICY unidades_delete ON public.unidades AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND app_private.pode_operar(auth.uid()));

-- Imagens de materiais: antes a escrita não verificava a lista/empresa do material.
DROP POLICY IF EXISTS material_imagens_insert ON public.material_imagens;
DROP POLICY IF EXISTS material_imagens_update ON public.material_imagens;
DROP POLICY IF EXISTS material_imagens_delete ON public.material_imagens;
CREATE POLICY material_imagens_insert ON public.material_imagens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.pode_operar(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.materiais m WHERE m.id = material_imagens.material_id AND app_private.pode_unidade(m.unidade_id)));
CREATE POLICY material_imagens_update ON public.material_imagens AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.pode_operar(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.materiais m WHERE m.id = material_imagens.material_id AND app_private.pode_unidade(m.unidade_id)))
  WITH CHECK (app_private.pode_operar(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.materiais m WHERE m.id = material_imagens.material_id AND app_private.pode_unidade(m.unidade_id)));
CREATE POLICY material_imagens_delete ON public.material_imagens AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.pode_operar(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.materiais m WHERE m.id = material_imagens.material_id AND app_private.pode_unidade(m.unidade_id)));

-- Pausas: administrador só vê pausas das listas a que tem acesso (antes: de todas as empresas).
DROP POLICY IF EXISTS "Pausas visiveis para admin ou dono da conferencia" ON public.conferencia_pausas;
CREATE POLICY "Pausas visiveis para admin ou dono da conferencia" ON public.conferencia_pausas
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conferencias c
     WHERE c.id = conferencia_pausas.conferencia_id
       AND (c.created_by = auth.uid()
            OR (app_private.eh_administrador(auth.uid()) AND app_private.pode_unidade(c.unidade_id)))));

-- ---------------------------------------------------------------------------
-- 4. Histórico, notificações e metas: registro sem empresa só para acesso global
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS historico_select_admin ON public.historico_conferencias;
DROP POLICY IF EXISTS historico_select_gestor ON public.historico_conferencias;
CREATE POLICY historico_select_admin ON public.historico_conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY historico_select_gestor ON public.historico_conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_gestor(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);

DROP POLICY IF EXISTS "Admins atualizam status da notificacao" ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS "Admins excluem notificacoes de conferencia" ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS "Admins veem todas as notificacoes de conferencia" ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS notificacoes_select_gestor ON public.notificacoes_conferencia;
CREATE POLICY "Admins atualizam status da notificacao" ON public.notificacoes_conferencia
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END))
  WITH CHECK (user_id = auth.uid() OR (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END));
CREATE POLICY "Admins excluem notificacoes de conferencia" ON public.notificacoes_conferencia
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY "Admins veem todas as notificacoes de conferencia" ON public.notificacoes_conferencia
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END));
CREATE POLICY notificacoes_select_gestor ON public.notificacoes_conferencia AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_gestor(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);

DROP POLICY IF EXISTS "Admins veem historico de envios" ON public.notificacao_emails;
CREATE POLICY "Admins veem historico de envios" ON public.notificacao_emails AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_global(auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.notificacoes_conferencia n
     WHERE n.id = notificacao_emails.notificacao_id AND n.empresa_id IS NOT NULL
       AND app_private.pertence_empresa(n.empresa_id, auth.uid()))));

DROP POLICY IF EXISTS metas_delete_admin ON public.metas;
DROP POLICY IF EXISTS metas_insert_admin ON public.metas;
DROP POLICY IF EXISTS metas_select_admin ON public.metas;
DROP POLICY IF EXISTS metas_select_gestor ON public.metas;
DROP POLICY IF EXISTS metas_update_admin ON public.metas;
CREATE POLICY metas_delete_admin ON public.metas AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY metas_insert_admin ON public.metas AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY metas_select_admin ON public.metas AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY metas_select_gestor ON public.metas AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_gestor(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);
CREATE POLICY metas_update_admin ON public.metas AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END)
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND CASE WHEN empresa_id IS NULL
    THEN app_private.eh_global(auth.uid()) ELSE app_private.pertence_empresa(empresa_id, auth.uid()) END);

-- ---------------------------------------------------------------------------
-- 5. Usuários, sessões, permissões e auditoria: administrador só da própria empresa
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_profiles_delete_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert_admin ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_update_admin ON public.user_profiles;
CREATE POLICY user_profiles_delete_admin ON public.user_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa_ou_legado(user_id));
CREATE POLICY user_profiles_insert_admin ON public.user_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa_ou_legado(user_id));
CREATE POLICY user_profiles_select_own ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa_ou_legado(user_id)));
CREATE POLICY user_profiles_update_admin ON public.user_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa_ou_legado(user_id))
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa_ou_legado(user_id));

DROP POLICY IF EXISTS sessoes_select ON public.sessoes_usuario;
DROP POLICY IF EXISTS sessoes_update ON public.sessoes_usuario;
CREATE POLICY sessoes_select ON public.sessoes_usuario AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));
CREATE POLICY sessoes_update ON public.sessoes_usuario AS PERMISSIVE FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)))
  WITH CHECK (user_id = auth.uid() OR app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));

DROP POLICY IF EXISTS perm_usuario_delete ON public.permissoes_usuario;
DROP POLICY IF EXISTS perm_usuario_insert ON public.permissoes_usuario;
DROP POLICY IF EXISTS perm_usuario_select ON public.permissoes_usuario;
DROP POLICY IF EXISTS perm_usuario_update ON public.permissoes_usuario;
CREATE POLICY perm_usuario_delete ON public.permissoes_usuario AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));
CREATE POLICY perm_usuario_insert ON public.permissoes_usuario AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));
CREATE POLICY perm_usuario_select ON public.permissoes_usuario AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));
CREATE POLICY perm_usuario_update ON public.permissoes_usuario AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)))
  WITH CHECK (app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));

DROP POLICY IF EXISTS auditoria_read ON public.auditoria;
CREATE POLICY auditoria_read ON public.auditoria AS PERMISSIVE FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR app_private.eh_global(auth.uid())
         OR (app_private.eh_administrador(auth.uid()) AND app_private.mesma_empresa(auth.uid(), user_id)));

DROP POLICY IF EXISTS "Usuário vê seu próprio registro legado" ON public.usuarios_legados;
CREATE POLICY "Usuário vê seu próprio registro legado" ON public.usuarios_legados
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS aviso_leituras_select ON public.aviso_leituras;
CREATE POLICY aviso_leituras_select ON public.aviso_leituras AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS empresa_setores_select_membros ON public.empresa_setores;
CREATE POLICY empresa_setores_select_membros ON public.empresa_setores AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.pertence_empresa(empresa_id, auth.uid())
         OR (app_private.eh_legado(auth.uid()) AND NOT app_private.tem_empresa(auth.uid())
             AND app_private.empresa_legada(empresa_id)));

-- ---------------------------------------------------------------------------
-- 6. Dados GLOBAIS do sistema (sem empresa): somente acesso global (nível ≥ 5).
--    Antes o administrador de QUALQUER empresa podia alterar planos, avisos para todos,
--    cadastros-mestre, matriz de permissões, integrações e configurações do sistema.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS planos_insert_admin ON public.planos;
DROP POLICY IF EXISTS planos_update_admin ON public.planos;
CREATE POLICY planos_insert_admin ON public.planos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY planos_update_admin ON public.planos AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS avisos_delete ON public.avisos_sistema;
DROP POLICY IF EXISTS avisos_insert ON public.avisos_sistema;
DROP POLICY IF EXISTS avisos_update ON public.avisos_sistema;
CREATE POLICY avisos_delete ON public.avisos_sistema AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_global(auth.uid()));
CREATE POLICY avisos_insert ON public.avisos_sistema AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY avisos_update ON public.avisos_sistema AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS cadastros_insert ON public.cadastros_mestres;
DROP POLICY IF EXISTS cadastros_update ON public.cadastros_mestres;
CREATE POLICY cadastros_insert ON public.cadastros_mestres AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY cadastros_update ON public.cadastros_mestres AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS perm_perfil_delete ON public.permissoes_perfil;
DROP POLICY IF EXISTS perm_perfil_insert ON public.permissoes_perfil;
DROP POLICY IF EXISTS perm_perfil_update ON public.permissoes_perfil;
CREATE POLICY perm_perfil_delete ON public.permissoes_perfil AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_global(auth.uid()));
CREATE POLICY perm_perfil_insert ON public.permissoes_perfil AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY perm_perfil_update ON public.permissoes_perfil AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS configuracoes_delete ON public.configuracoes_sistema;
DROP POLICY IF EXISTS configuracoes_insert ON public.configuracoes_sistema;
DROP POLICY IF EXISTS configuracoes_select ON public.configuracoes_sistema;
DROP POLICY IF EXISTS configuracoes_update ON public.configuracoes_sistema;
CREATE POLICY configuracoes_delete ON public.configuracoes_sistema AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_global(auth.uid()));
CREATE POLICY configuracoes_insert ON public.configuracoes_sistema AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY configuracoes_select ON public.configuracoes_sistema AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_global(auth.uid()) OR chave = 'geral');
CREATE POLICY configuracoes_update ON public.configuracoes_sistema AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS integracoes_delete ON public.integracoes;
DROP POLICY IF EXISTS integracoes_insert ON public.integracoes;
DROP POLICY IF EXISTS integracoes_select ON public.integracoes;
DROP POLICY IF EXISTS integracoes_update ON public.integracoes;
CREATE POLICY integracoes_delete ON public.integracoes AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_global(auth.uid()));
CREATE POLICY integracoes_insert ON public.integracoes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_global(auth.uid()));
CREATE POLICY integracoes_select ON public.integracoes AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_global(auth.uid()));
CREATE POLICY integracoes_update ON public.integracoes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_global(auth.uid())) WITH CHECK (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS relatorios_agendados_delete ON public.relatorios_agendados;
DROP POLICY IF EXISTS relatorios_agendados_insert ON public.relatorios_agendados;
DROP POLICY IF EXISTS relatorios_agendados_select ON public.relatorios_agendados;
DROP POLICY IF EXISTS relatorios_agendados_update ON public.relatorios_agendados;
CREATE POLICY relatorios_agendados_delete ON public.relatorios_agendados AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND (created_by = auth.uid() OR app_private.eh_global(auth.uid())));
CREATE POLICY relatorios_agendados_insert ON public.relatorios_agendados AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND (created_by = auth.uid() OR app_private.eh_global(auth.uid())));
CREATE POLICY relatorios_agendados_select ON public.relatorios_agendados AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND (created_by = auth.uid() OR app_private.eh_global(auth.uid())));
CREATE POLICY relatorios_agendados_update ON public.relatorios_agendados AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()) AND (created_by = auth.uid() OR app_private.eh_global(auth.uid())))
  WITH CHECK (app_private.eh_administrador(auth.uid()) AND (created_by = auth.uid() OR app_private.eh_global(auth.uid())));

DROP POLICY IF EXISTS webhook_eventos_select_admin ON public.webhook_eventos_pagamento;
CREATE POLICY webhook_eventos_select_admin ON public.webhook_eventos_pagamento AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_global(auth.uid()));

DROP POLICY IF EXISTS assinatura_pagamentos_select_membro_ou_admin ON public.assinatura_pagamentos;
CREATE POLICY assinatura_pagamentos_select_membro_ou_admin ON public.assinatura_pagamentos
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_global(auth.uid()) OR empresa_id IN (SELECT app_private.minhas_empresas()));
