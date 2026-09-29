DROP FUNCTION IF EXISTS public.diagnostico_permissoes();

CREATE OR REPLACE FUNCTION public.diagnostico_permissoes(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'perfil_atual', (
      SELECT CASE
               WHEN perfil IN ('proprietario','super_admin') THEN 'administrador'
               ELSE perfil
             END
        FROM public.user_profiles WHERE user_id = _user_id LIMIT 1
    ),
    'nivel', app_private.nivel(_user_id),
    'eh_administrador', app_private.eh_administrador(_user_id),
    'eh_gestor', app_private.eh_gestor(_user_id)
  )
$$;

REVOKE ALL ON FUNCTION public.diagnostico_permissoes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diagnostico_permissoes(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.diagnostico_permissoes(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) TO service_role;