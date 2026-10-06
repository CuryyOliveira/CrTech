CREATE OR REPLACE FUNCTION public.validar_hook(_nome text, _valor text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = app_private, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.hook_secrets
    WHERE nome = _nome AND valor = _valor
  )
$$;

REVOKE ALL ON FUNCTION public.validar_hook(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_hook(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.validar_hook(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validar_hook(text, text) TO service_role;