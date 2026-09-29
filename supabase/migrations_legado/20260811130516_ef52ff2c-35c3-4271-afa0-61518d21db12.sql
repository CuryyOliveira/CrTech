-- Visitantes não autenticados não devem alcançar a rotina de criação de módulos.
-- Ela já exige auth.uid() + administrador da empresa internamente, mas o acesso
-- passa a ser negado antes da execução (defesa em profundidade).
REVOKE EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) TO service_role;