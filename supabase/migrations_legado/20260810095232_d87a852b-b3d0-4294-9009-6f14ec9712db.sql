-- Self-scoping guards on SECURITY DEFINER helpers callable by authenticated users.
-- auth.uid() IS NULL => service_role / server context => allowed.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_administrador(auth.uid())
      THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  END
$function$;

CREATE OR REPLACE FUNCTION public.diagnostico_permissoes(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_administrador(auth.uid())
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
$function$;

CREATE OR REPLACE FUNCTION public.empresa_do_usuario(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid() OR app_private.eh_administrador(auth.uid()))
   ORDER BY CASE papel WHEN 'proprietario' THEN 0 WHEN 'administrador' THEN 1 ELSE 2 END, created_at
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid() OR app_private.eh_administrador(auth.uid()))
$function$;

CREATE OR REPLACE FUNCTION public.assinatura_ativa_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_administrador(auth.uid())
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
$function$;

CREATE OR REPLACE FUNCTION public.plano_da_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_administrador(auth.uid())
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
$function$;