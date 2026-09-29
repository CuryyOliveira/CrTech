CREATE OR REPLACE FUNCTION app_private.mesma_empresa_ou_legado(_alvo uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app_private, public AS $$
  SELECT
    _alvo = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.perfil IN ('proprietario','super_admin'))
    -- Contas anteriores ao SaaS mantêm a visão global que já possuíam.
    OR EXISTS (SELECT 1 FROM public.usuarios_legados l WHERE l.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.created_at < '2026-08-10T00:00:00Z')
    -- Empresas do modelo SaaS: apenas usuários da mesma empresa.
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios a
       JOIN public.empresa_usuarios b ON b.empresa_id = a.empresa_id
       WHERE a.user_id = auth.uid() AND b.user_id = _alvo
    )
$$;
REVOKE ALL ON FUNCTION app_private.mesma_empresa_ou_legado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa_ou_legado(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
CREATE POLICY user_profiles_select_own ON public.user_profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (app_private.perfil_atual() = 'administrador' AND app_private.mesma_empresa_ou_legado(user_id))
);

DROP POLICY IF EXISTS user_profiles_update_admin ON public.user_profiles;
CREATE POLICY user_profiles_update_admin ON public.user_profiles FOR UPDATE TO authenticated
USING (app_private.perfil_atual() = 'administrador' AND app_private.mesma_empresa_ou_legado(user_id))
WITH CHECK (app_private.perfil_atual() = 'administrador' AND app_private.mesma_empresa_ou_legado(user_id));

DROP POLICY IF EXISTS user_profiles_delete_admin ON public.user_profiles;
CREATE POLICY user_profiles_delete_admin ON public.user_profiles FOR DELETE TO authenticated
USING (app_private.perfil_atual() = 'administrador' AND app_private.mesma_empresa_ou_legado(user_id));