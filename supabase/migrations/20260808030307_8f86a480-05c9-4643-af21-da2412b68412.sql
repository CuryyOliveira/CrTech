GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) TO authenticated;