CREATE OR REPLACE FUNCTION public.criar_empresa_onboarding(
  _nome text,
  _cnpj text DEFAULT NULL,
  _email text DEFAULT NULL,
  _telefone text DEFAULT NULL,
  _observacoes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_nome text := btrim(coalesce(_nome, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome da empresa';
  END IF;

  SELECT empresa_id INTO v_id
    FROM public.empresa_usuarios
   WHERE user_id = v_user AND ativo = true
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.empresas (nome, cnpj, email_contato, telefone, observacoes, created_by)
  VALUES (
    v_nome,
    nullif(btrim(coalesce(_cnpj, '')), ''),
    nullif(btrim(coalesce(_email, '')), ''),
    nullif(btrim(coalesce(_telefone, '')), ''),
    nullif(btrim(coalesce(_observacoes, '')), ''),
    v_user
  )
  RETURNING id INTO v_id;

  INSERT INTO public.empresa_usuarios (empresa_id, user_id, papel, ativo)
  VALUES (v_id, v_user, 'proprietario', true);

  UPDATE public.user_profiles
     SET perfil = 'administrador'
   WHERE user_id = v_user
     AND perfil NOT IN ('proprietario', 'super_admin', 'administrador');

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.usuarios_ativos_empresa(_empresa_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_administrador(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::integer
    ELSE (
      SELECT count(*)::integer
        FROM public.empresa_usuarios eu
        LEFT JOIN public.user_profiles up ON up.user_id = eu.user_id
       WHERE eu.empresa_id = _empresa_id
         AND eu.ativo = true
         AND coalesce(up.bloqueado, false) = false
    )
  END
$$;

REVOKE ALL ON FUNCTION public.usuarios_ativos_empresa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.usuarios_ativos_empresa(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.usuarios_ativos_empresa(uuid) TO authenticated;