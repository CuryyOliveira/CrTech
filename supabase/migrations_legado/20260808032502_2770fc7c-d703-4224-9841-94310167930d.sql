-- 1) Revoke EXECUTE from anon (and PUBLIC) on SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validar_hook(text, text) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validar_hook(text, text) TO service_role;

-- 2) Admin-scoped write policies for empresa_usuarios
GRANT INSERT, UPDATE, DELETE ON public.empresa_usuarios TO authenticated;

DROP POLICY IF EXISTS "empresa_usuarios_admin_insert" ON public.empresa_usuarios;
CREATE POLICY "empresa_usuarios_admin_insert" ON public.empresa_usuarios
  FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

DROP POLICY IF EXISTS "empresa_usuarios_admin_update" ON public.empresa_usuarios;
CREATE POLICY "empresa_usuarios_admin_update" ON public.empresa_usuarios
  FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

DROP POLICY IF EXISTS "empresa_usuarios_admin_delete" ON public.empresa_usuarios;
CREATE POLICY "empresa_usuarios_admin_delete" ON public.empresa_usuarios
  FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()));