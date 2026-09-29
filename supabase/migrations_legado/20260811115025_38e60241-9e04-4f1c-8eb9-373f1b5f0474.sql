REVOKE ALL ON FUNCTION public.preencher_escopo_empresa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unidades_escopo_empresa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preencher_escopo_empresa() TO service_role;
GRANT EXECUTE ON FUNCTION public.unidades_escopo_empresa() TO service_role;