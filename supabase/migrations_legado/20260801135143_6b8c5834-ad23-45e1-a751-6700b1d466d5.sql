-- setor do usuário atual (para direcionamento de avisos)
CREATE OR REPLACE FUNCTION app_private.setor_atual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT setor FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

REVOKE ALL ON FUNCTION app_private.setor_atual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.setor_atual() TO authenticated, service_role;

-- Avisos: leitura direcionada
DROP POLICY IF EXISTS avisos_select ON public.avisos_sistema;
CREATE POLICY avisos_select ON public.avisos_sistema
FOR SELECT TO authenticated
USING (
  app_private.eh_administrador(auth.uid())
  OR (
    publicado
    AND NOT arquivado
    AND (agendado_para IS NULL OR agendado_para <= now())
    AND (destino_perfil IS NULL OR destino_perfil = '' OR destino_perfil = app_private.perfil_atual())
    AND (destino_setor IS NULL OR destino_setor = '' OR destino_setor = app_private.setor_atual())
  )
);

-- Cadastros mestres: usuários comuns só veem registros ativos e não excluídos
DROP POLICY IF EXISTS cadastros_select ON public.cadastros_mestres;
CREATE POLICY cadastros_select ON public.cadastros_mestres
FOR SELECT TO authenticated
USING (
  app_private.eh_administrador(auth.uid())
  OR (ativo AND NOT excluido)
);

-- Configurações: somente administradores, exceto identidade visual
DROP POLICY IF EXISTS configuracoes_select ON public.configuracoes_sistema;
CREATE POLICY configuracoes_select ON public.configuracoes_sistema
FOR SELECT TO authenticated
USING (
  app_private.perfil_atual() = 'administrador'
  OR chave = 'geral'
);