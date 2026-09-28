CREATE OR REPLACE FUNCTION app_private.eh_administrador(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = _user_id AND perfil = 'administrador' AND bloqueado = false
  )
$$;
REVOKE ALL ON FUNCTION app_private.eh_administrador(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.eh_administrador(uuid) TO authenticated, service_role;

ALTER POLICY "cadastros_insert" ON public.cadastros_mestres WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "cadastros_update" ON public.cadastros_mestres USING (app_private.eh_administrador(auth.uid())) WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_perfil_insert" ON public.permissoes_perfil WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_perfil_update" ON public.permissoes_perfil USING (app_private.eh_administrador(auth.uid())) WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_perfil_delete" ON public.permissoes_perfil USING (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_usuario_select" ON public.permissoes_usuario USING (user_id = auth.uid() OR app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_usuario_insert" ON public.permissoes_usuario WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_usuario_update" ON public.permissoes_usuario USING (app_private.eh_administrador(auth.uid())) WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "perm_usuario_delete" ON public.permissoes_usuario USING (app_private.eh_administrador(auth.uid()));
ALTER POLICY "avisos_insert" ON public.avisos_sistema WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "avisos_update" ON public.avisos_sistema USING (app_private.eh_administrador(auth.uid())) WITH CHECK (app_private.eh_administrador(auth.uid()));
ALTER POLICY "avisos_delete" ON public.avisos_sistema USING (app_private.eh_administrador(auth.uid()));
ALTER POLICY "aviso_leituras_select" ON public.aviso_leituras USING (user_id = auth.uid() OR app_private.eh_administrador(auth.uid()));
ALTER POLICY "sessoes_select" ON public.sessoes_usuario USING (user_id = auth.uid() OR app_private.eh_administrador(auth.uid()));
ALTER POLICY "sessoes_update" ON public.sessoes_usuario USING (user_id = auth.uid() OR app_private.eh_administrador(auth.uid())) WITH CHECK (user_id = auth.uid() OR app_private.eh_administrador(auth.uid()));

DROP FUNCTION IF EXISTS public.eh_administrador(uuid);
