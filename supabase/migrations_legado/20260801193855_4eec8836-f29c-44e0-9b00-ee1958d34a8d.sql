DROP POLICY IF EXISTS "perm_perfil_select" ON public.permissoes_perfil;
CREATE POLICY "perm_perfil_select" ON public.permissoes_perfil
FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR perfil = app_private.perfil_atual());

REVOKE INSERT, UPDATE, DELETE ON public.notificacao_emails FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notificacao_emails FROM anon;
GRANT ALL ON public.notificacao_emails TO service_role;