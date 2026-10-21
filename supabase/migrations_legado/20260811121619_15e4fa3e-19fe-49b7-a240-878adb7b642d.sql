-- Papel global (suporte): apenas proprietario/super_admin
CREATE OR REPLACE FUNCTION app_private.eh_global(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT app_private.nivel(_user_id) >= 5
$$;

REVOKE ALL ON FUNCTION app_private.eh_global(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.eh_global(uuid) TO authenticated, service_role;

-- Compartilham empresa ativa?
CREATE OR REPLACE FUNCTION app_private.mesma_empresa(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.empresa_usuarios a
      JOIN public.empresa_usuarios b ON b.empresa_id = a.empresa_id
     WHERE a.user_id = _a AND a.ativo = true
       AND b.user_id = _b AND b.ativo = true
  )
$$;

REVOKE ALL ON FUNCTION app_private.mesma_empresa(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa(uuid, uuid) TO authenticated, service_role;

-- Isolamento por empresa: administrador comum não é mais global
CREATE OR REPLACE FUNCTION app_private.pertence_empresa(_empresa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_global(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
    )
  )
$$;

CREATE OR REPLACE FUNCTION app_private.eh_admin_empresa(_empresa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_global(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
         AND eu.papel IN ('proprietario', 'administrador')
    )
  )
$$;

-- Leitura de papéis de outros usuários exige mesma empresa ou papel global
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_global(auth.uid())
         AND NOT (app_private.eh_administrador(auth.uid())
                  AND app_private.mesma_empresa(auth.uid(), _user_id))
      THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  END
$$;

CREATE OR REPLACE FUNCTION public.diagnostico_permissoes(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_global(auth.uid())
         AND NOT (app_private.eh_administrador(auth.uid())
                  AND app_private.mesma_empresa(auth.uid(), _user_id))
      THEN NULL::jsonb
    ELSE jsonb_build_object(
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
  END
$$;

CREATE OR REPLACE FUNCTION public.empresa_do_usuario(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR app_private.eh_global(auth.uid())
          OR (app_private.eh_administrador(auth.uid())
              AND app_private.mesma_empresa(auth.uid(), _user_id)))
   ORDER BY CASE papel WHEN 'proprietario' THEN 0 WHEN 'administrador' THEN 1 ELSE 2 END, created_at
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR app_private.eh_global(auth.uid())
          OR (app_private.eh_administrador(auth.uid())
              AND app_private.mesma_empresa(auth.uid(), _user_id)))
$$;

CREATE OR REPLACE FUNCTION public.assinatura_ativa_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.assinaturas
       WHERE empresa_id = _empresa_id
         AND ambiente = _ambiente
         AND (
           (status IN ('ativa','trial','pagamento_pendente')
              AND (periodo_atual_fim IS NULL OR periodo_atual_fim > now()))
           OR (status = 'cancelada' AND periodo_atual_fim > now())
         )
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.plano_da_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::jsonb
    ELSE (
      SELECT jsonb_build_object(
               'assinatura_id', a.id,
               'status', a.status,
               'plano_codigo', a.plano_codigo,
               'periodicidade', a.periodicidade,
               'valor_centavos', a.valor_centavos,
               'moeda', a.moeda,
               'periodo_atual_fim', a.periodo_atual_fim,
               'proxima_cobranca', a.proxima_cobranca,
               'trial_fim', a.trial_fim,
               'modulos', COALESCE(p.modulos, '{}'::text[]),
               'max_usuarios', p.max_usuarios,
               'recursos', COALESCE(p.recursos, '{}'::jsonb),
               'limites', COALESCE(p.limites, '{}'::jsonb)
             )
        FROM public.assinaturas a
        LEFT JOIN public.planos p ON p.id = a.plano_id
       WHERE a.empresa_id = _empresa_id AND a.ambiente = _ambiente
       ORDER BY CASE a.status WHEN 'ativa' THEN 0 WHEN 'trial' THEN 1 WHEN 'pagamento_pendente' THEN 2 ELSE 3 END,
                a.created_at DESC
       LIMIT 1
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.usuarios_ativos_empresa(_empresa_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
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