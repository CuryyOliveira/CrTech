-- FASE 13B — Isolamento multiempresa dos dados operacionais

ALTER TABLE public.unidades
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modulo_id uuid REFERENCES public.empresa_modulos(id) ON DELETE SET NULL;

ALTER TABLE public.historico_conferencias
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modulo_id uuid REFERENCES public.empresa_modulos(id) ON DELETE SET NULL;

ALTER TABLE public.notificacoes_conferencia
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modulo_id uuid REFERENCES public.empresa_modulos(id) ON DELETE SET NULL;

ALTER TABLE public.metas
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modulo_id uuid REFERENCES public.empresa_modulos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS unidades_empresa_idx ON public.unidades (empresa_id);
CREATE INDEX IF NOT EXISTS unidades_modulo_idx ON public.unidades (modulo_id);
CREATE INDEX IF NOT EXISTS historico_empresa_idx ON public.historico_conferencias (empresa_id);
CREATE INDEX IF NOT EXISTS notificacoes_empresa_idx ON public.notificacoes_conferencia (empresa_id);
CREATE INDEX IF NOT EXISTS metas_empresa_idx ON public.metas (empresa_id);

-- Backfill: dados legados pertencem à empresa do proprietário do sistema
DO $$
DECLARE v_empresa uuid;
BEGIN
  SELECT eu.empresa_id INTO v_empresa
    FROM public.empresa_usuarios eu
    JOIN auth.users u ON u.id = eu.user_id
   WHERE lower(u.email) = 'lucassamuel2003@hotmail.com'
     AND eu.ativo = true
   ORDER BY CASE eu.papel WHEN 'proprietario' THEN 0 WHEN 'administrador' THEN 1 ELSE 2 END, eu.created_at
   LIMIT 1;

  IF v_empresa IS NULL THEN
    SELECT id INTO v_empresa FROM public.empresas WHERE ativo = true ORDER BY created_at LIMIT 1;
  END IF;

  IF v_empresa IS NOT NULL THEN
    UPDATE public.unidades SET empresa_id = v_empresa WHERE empresa_id IS NULL;
    UPDATE public.metas SET empresa_id = v_empresa WHERE empresa_id IS NULL;
  END IF;
END $$;

UPDATE public.historico_conferencias h
   SET empresa_id = u.empresa_id
  FROM public.unidades u
 WHERE h.unidade_id = u.id AND h.empresa_id IS NULL AND u.empresa_id IS NOT NULL;

UPDATE public.notificacoes_conferencia n
   SET empresa_id = u.empresa_id
  FROM public.unidades u
 WHERE n.unidade_id = u.id AND n.empresa_id IS NULL AND u.empresa_id IS NOT NULL;

-- Regra única de acesso a uma lista/unidade (legado por tipo, novo por módulo da empresa)
CREATE OR REPLACE FUNCTION app_private.acesso_unidade(_tipo text, _empresa_id uuid, _modulo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, app_private
AS $$
  SELECT (_empresa_id IS NULL OR app_private.pertence_empresa(_empresa_id, auth.uid()))
     AND CASE
           WHEN _modulo_id IS NOT NULL THEN app_private.nivel(auth.uid()) >= 2
           ELSE app_private.pode_tipo(_tipo)
         END
$$;

REVOKE ALL ON FUNCTION app_private.acesso_unidade(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.acesso_unidade(text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.pode_unidade(_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.unidades u
     WHERE u.id = _unidade_id
       AND app_private.acesso_unidade(u.tipo, u.empresa_id, u.modulo_id)
  )
$$;

-- Unidades: políticas passam a considerar empresa e módulo
DROP POLICY IF EXISTS unidades_select ON public.unidades;
DROP POLICY IF EXISTS unidades_insert ON public.unidades;
DROP POLICY IF EXISTS unidades_update ON public.unidades;
DROP POLICY IF EXISTS unidades_delete ON public.unidades;

CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated
  USING (app_private.acesso_unidade(tipo, empresa_id, modulo_id));

CREATE POLICY unidades_insert ON public.unidades FOR INSERT TO authenticated
  WITH CHECK (
    app_private.acesso_unidade(tipo, empresa_id, modulo_id)
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'conferente'))
  );

CREATE POLICY unidades_update ON public.unidades FOR UPDATE TO authenticated
  USING (
    app_private.acesso_unidade(tipo, empresa_id, modulo_id)
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'conferente'))
  )
  WITH CHECK (
    app_private.acesso_unidade(tipo, empresa_id, modulo_id)
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'conferente'))
  );

CREATE POLICY unidades_delete ON public.unidades FOR DELETE TO authenticated
  USING (
    app_private.acesso_unidade(tipo, empresa_id, modulo_id)
    AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'conferente'))
  );

-- Histórico: leitura administrativa/gerencial restrita à própria empresa
DROP POLICY IF EXISTS historico_select_admin ON public.historico_conferencias;
DROP POLICY IF EXISTS historico_select_gestor ON public.historico_conferencias;

CREATE POLICY historico_select_admin ON public.historico_conferencias FOR SELECT TO authenticated
  USING (
    app_private.perfil_atual() = 'administrador'
    AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid()))
  );

CREATE POLICY historico_select_gestor ON public.historico_conferencias FOR SELECT TO authenticated
  USING (
    app_private.eh_gestor(auth.uid())
    AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid()))
  );

-- Notificações de conferência: idem
DROP POLICY IF EXISTS "Admins veem todas as notificacoes de conferencia" ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS notificacoes_select_gestor ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS "Admins atualizam status da notificacao" ON public.notificacoes_conferencia;
DROP POLICY IF EXISTS "Admins excluem notificacoes de conferencia" ON public.notificacoes_conferencia;

CREATE POLICY "Admins veem todas as notificacoes de conferencia"
  ON public.notificacoes_conferencia FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (app_private.eh_administrador(auth.uid())
        AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())))
  );

CREATE POLICY notificacoes_select_gestor
  ON public.notificacoes_conferencia FOR SELECT TO authenticated
  USING (
    app_private.eh_gestor(auth.uid())
    AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid()))
  );

CREATE POLICY "Admins atualizam status da notificacao"
  ON public.notificacoes_conferencia FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (app_private.eh_administrador(auth.uid())
        AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (app_private.eh_administrador(auth.uid())
        AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())))
  );

CREATE POLICY "Admins excluem notificacoes de conferencia"
  ON public.notificacoes_conferencia FOR DELETE TO authenticated
  USING (
    app_private.eh_administrador(auth.uid())
    AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid()))
  );

-- Metas: escopo por empresa
DROP POLICY IF EXISTS metas_select_admin ON public.metas;
DROP POLICY IF EXISTS metas_select_gestor ON public.metas;
DROP POLICY IF EXISTS metas_insert_admin ON public.metas;
DROP POLICY IF EXISTS metas_update_admin ON public.metas;
DROP POLICY IF EXISTS metas_delete_admin ON public.metas;

CREATE POLICY metas_select_admin ON public.metas FOR SELECT TO authenticated
  USING (app_private.perfil_atual() = 'administrador'
         AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())));

CREATE POLICY metas_select_gestor ON public.metas FOR SELECT TO authenticated
  USING (app_private.eh_gestor(auth.uid())
         AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())));

CREATE POLICY metas_insert_admin ON public.metas FOR INSERT TO authenticated
  WITH CHECK (app_private.perfil_atual() = 'administrador'
              AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())));

CREATE POLICY metas_update_admin ON public.metas FOR UPDATE TO authenticated
  USING (app_private.perfil_atual() = 'administrador'
         AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())))
  WITH CHECK (app_private.perfil_atual() = 'administrador'
              AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())));

CREATE POLICY metas_delete_admin ON public.metas FOR DELETE TO authenticated
  USING (app_private.perfil_atual() = 'administrador'
         AND (empresa_id IS NULL OR app_private.pertence_empresa(empresa_id, auth.uid())));

-- Preenchimento automático de empresa/módulo em novos registros
CREATE OR REPLACE FUNCTION public.preencher_escopo_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
BEGIN
  IF NEW.empresa_id IS NULL AND NEW.unidade_id IS NOT NULL THEN
    SELECT u.empresa_id, COALESCE(NEW.modulo_id, u.modulo_id)
      INTO NEW.empresa_id, NEW.modulo_id
      FROM public.unidades u WHERE u.id = NEW.unidade_id;
  END IF;
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := public.empresa_do_usuario(auth.uid());
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS historico_escopo_empresa ON public.historico_conferencias;
CREATE TRIGGER historico_escopo_empresa
  BEFORE INSERT ON public.historico_conferencias
  FOR EACH ROW EXECUTE FUNCTION public.preencher_escopo_empresa();

DROP TRIGGER IF EXISTS notificacoes_escopo_empresa ON public.notificacoes_conferencia;
CREATE TRIGGER notificacoes_escopo_empresa
  BEFORE INSERT ON public.notificacoes_conferencia
  FOR EACH ROW EXECUTE FUNCTION public.preencher_escopo_empresa();

CREATE OR REPLACE FUNCTION public.unidades_escopo_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := public.empresa_do_usuario(auth.uid());
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS unidades_escopo_empresa ON public.unidades;
CREATE TRIGGER unidades_escopo_empresa
  BEFORE INSERT ON public.unidades
  FOR EACH ROW EXECUTE FUNCTION public.unidades_escopo_empresa();