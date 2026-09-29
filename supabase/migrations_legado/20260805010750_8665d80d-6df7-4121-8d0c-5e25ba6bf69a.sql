GRANT EXECUTE ON FUNCTION app_private.eh_gestor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.eh_proprietario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.nivel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.nivel_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.nivel_perfil(text) TO authenticated;