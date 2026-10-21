-- =====================================================================
-- Correção de regressão da Fase 13 para usuários legados preservados.
--
-- Antes da Fase 13, `unidades.empresa_id` era NULO e o acesso era decidido
-- apenas pelo perfil (app_private.pode_tipo). A Fase 13 preencheu
-- `empresa_id` e passou a exigir vínculo em `empresa_usuarios`, o que
-- removeu a visibilidade dos usuários legados que não possuem vínculo.
--
-- A correção restaura a visibilidade legada SEM afetar o isolamento
-- multiempresa dos módulos dinâmicos da Fase 13.
-- =====================================================================

-- Usuário explicitamente preservado como legado (lista curada).
CREATE OR REPLACE FUNCTION app_private.eh_legado(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios_legados WHERE user_id = _user_id
  )
$function$;

-- Empresa de origem legada: possui ao menos um membro ativo que é legado.
-- Impede que um usuário legado alcance empresas criadas já no modelo SaaS.
CREATE OR REPLACE FUNCTION app_private.empresa_legada(_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _empresa_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.empresa_usuarios eu
      JOIN public.usuarios_legados l ON l.user_id = eu.user_id
     WHERE eu.empresa_id = _empresa_id
       AND eu.ativo = true
  )
$function$;

-- Helpers internos: chamados apenas de dentro de funções SECURITY DEFINER.
REVOKE ALL ON FUNCTION app_private.eh_legado(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.empresa_legada(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.eh_legado(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION app_private.empresa_legada(uuid) FROM anon, authenticated;

-- Regra de acesso à unidade.
--   * Módulo dinâmico (modulo_id NÃO nulo)  -> Fase 13 intacta: exige vínculo
--     com a empresa dona do módulo e nível operacional.
--   * Módulo legado (modulo_id nulo)        -> vínculo com a empresa OU
--     preservação legada (usuário legado + empresa legada), sempre limitado
--     pelo perfil via app_private.pode_tipo.
CREATE OR REPLACE FUNCTION app_private.acesso_unidade(_tipo text, _empresa_id uuid, _modulo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $function$
  SELECT CASE
    WHEN _modulo_id IS NOT NULL THEN
      (_empresa_id IS NULL OR app_private.pertence_empresa(_empresa_id, auth.uid()))
      AND app_private.nivel(auth.uid()) >= 2
    ELSE
      (
        _empresa_id IS NULL
        OR app_private.pertence_empresa(_empresa_id, auth.uid())
        OR (
          app_private.eh_legado(auth.uid())
          AND app_private.empresa_legada(_empresa_id)
        )
      )
      AND app_private.pode_tipo(_tipo)
  END
$function$;