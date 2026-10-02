-- O diagnóstico passa a informar o perfil real (Proprietário nível 6, Super Admin nível 5),
-- em vez de agrupá-los como "administrador".
CREATE OR REPLACE FUNCTION public.diagnostico_permissoes(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_global(auth.uid())
         AND NOT (app_private.eh_administrador(auth.uid())
                  AND app_private.mesma_empresa(auth.uid(), _user_id))
      THEN NULL::jsonb
    ELSE jsonb_build_object(
      'perfil_atual', (SELECT perfil FROM public.user_profiles WHERE user_id = _user_id LIMIT 1),
      'nivel', app_private.nivel(_user_id),
      'eh_administrador', app_private.eh_administrador(_user_id),
      'eh_gestor', app_private.eh_gestor(_user_id)
    )
  END
$function$;
