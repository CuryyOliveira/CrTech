CREATE OR REPLACE FUNCTION public.diagnostico_permissoes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'perfil_atual', app_private.perfil_atual(),
    'nivel', app_private.nivel(auth.uid()),
    'eh_administrador', app_private.eh_administrador(auth.uid()),
    'eh_gestor', app_private.eh_gestor(auth.uid())
  )
$$;

REVOKE ALL ON FUNCTION public.diagnostico_permissoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes() TO authenticated, service_role;