-- 1) Limite de módulos por plano
UPDATE public.planos SET limites = limites || jsonb_build_object('max_modulos', 2)
 WHERE codigo LIKE 'essencial%';
UPDATE public.planos SET limites = limites || jsonb_build_object('max_modulos', 5)
 WHERE codigo LIKE 'profissional%';
UPDATE public.planos SET limites = limites || jsonb_build_object('max_modulos', NULL)
 WHERE codigo LIKE 'empresarial%';

-- 2) Assinaturas do provedor anterior não valem mais como acesso
UPDATE public.assinaturas
   SET status = 'encerrada',
       encerrada_em = COALESCE(encerrada_em, now()),
       motivo_status = COALESCE(motivo_status, 'provedor descontinuado'),
       updated_at = now()
 WHERE provider <> 'mercadopago'
   AND status NOT IN ('encerrada', 'cancelada');

-- 3) Assinatura ativa considera apenas o provedor vigente e respeita a carência
CREATE OR REPLACE FUNCTION public.assinatura_ativa_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         AND provider = 'mercadopago'
         AND (
           (status IN ('ativa','trial','pagamento_pendente')
              AND (periodo_atual_fim IS NULL OR periodo_atual_fim > now()))
           OR (status = 'cancelada' AND periodo_atual_fim IS NOT NULL AND periodo_atual_fim > now())
         )
    )
  END
$function$;

-- 4) Plano vigente também restrito ao provedor atual
CREATE OR REPLACE FUNCTION public.plano_da_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               'cancelar_no_fim_periodo', a.cancelar_no_fim_periodo,
               'modulos', COALESCE(p.modulos, '{}'::text[]),
               'max_usuarios', p.max_usuarios,
               'max_modulos', (p.limites -> 'max_modulos'),
               'recursos', COALESCE(p.recursos, '{}'::jsonb),
               'limites', COALESCE(p.limites, '{}'::jsonb)
             )
        FROM public.assinaturas a
        LEFT JOIN public.planos p ON p.id = a.plano_id
       WHERE a.empresa_id = _empresa_id AND a.ambiente = _ambiente
         AND a.provider = 'mercadopago'
       ORDER BY CASE a.status WHEN 'ativa' THEN 0 WHEN 'trial' THEN 1 WHEN 'pagamento_pendente' THEN 2 ELSE 3 END,
                a.created_at DESC
       LIMIT 1
    )
  END
$function$;

-- 5) Quantos módulos ativos a empresa possui (com isolamento multiempresa)
CREATE OR REPLACE FUNCTION public.modulos_ativos_empresa(_empresa_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::integer
    ELSE (
      SELECT count(*)::integer FROM public.empresa_modulos m
       WHERE m.empresa_id = _empresa_id AND m.ativo = true AND m.excluido = false
    )
  END
$function$;

REVOKE ALL ON FUNCTION public.modulos_ativos_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modulos_ativos_empresa(uuid) TO authenticated, service_role;

-- 6) Limite de módulos do plano contratado (uso interno, sem checagem de sessão)
CREATE OR REPLACE FUNCTION app_private.limite_modulos_empresa(_empresa_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(p.limites -> 'max_modulos', 'null'::jsonb)::int
    FROM public.assinaturas a
    JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = _empresa_id
     AND a.provider = 'mercadopago'
     AND a.status IN ('ativa','trial','pagamento_pendente')
     AND (a.periodo_atual_fim IS NULL OR a.periodo_atual_fim > now())
   ORDER BY CASE a.status WHEN 'ativa' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END, a.created_at DESC
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION app_private.limite_modulos_empresa(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.empresa_modulos_limite_plano()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _limite int;
  _usados int;
BEGIN
  IF NEW.origem = 'legado' OR NEW.ativo = false OR NEW.excluido = true THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ativo = true AND OLD.excluido = false THEN
    RETURN NEW;
  END IF;

  _limite := app_private.limite_modulos_empresa(NEW.empresa_id);
  IF _limite IS NULL THEN
    RETURN NEW; -- sem plano vigente ou plano sem limite
  END IF;

  SELECT count(*) INTO _usados FROM public.empresa_modulos m
   WHERE m.empresa_id = NEW.empresa_id AND m.ativo = true AND m.excluido = false
     AND m.id <> NEW.id;

  IF _usados >= _limite THEN
    RAISE EXCEPTION 'O plano contratado permite no máximo % módulo(s) ativo(s). Desative um módulo ou faça upgrade do plano.', _limite
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS empresa_modulos_limite_plano ON public.empresa_modulos;
CREATE TRIGGER empresa_modulos_limite_plano
  BEFORE INSERT OR UPDATE ON public.empresa_modulos
  FOR EACH ROW EXECUTE FUNCTION public.empresa_modulos_limite_plano();