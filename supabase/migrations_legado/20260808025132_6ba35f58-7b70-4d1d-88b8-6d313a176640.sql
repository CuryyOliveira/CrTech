-- =========================================================
-- ASSINATURAS / FATURAMENTO (estrutura nova, nada é alterado)
-- =========================================================

-- EMPRESAS (clientes / tenants)
CREATE TABLE public.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text,
  email_contato text,
  telefone text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX empresas_cnpj_uidx ON public.empresas (cnpj) WHERE cnpj IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- EMPRESA <-> USUARIOS
CREATE TABLE public.empresa_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  papel text NOT NULL DEFAULT 'membro' CHECK (papel IN ('proprietario','administrador','membro')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id)
);
CREATE INDEX empresa_usuarios_user_idx ON public.empresa_usuarios (user_id);

GRANT SELECT ON public.empresa_usuarios TO authenticated;
GRANT ALL ON public.empresa_usuarios TO service_role;
ALTER TABLE public.empresa_usuarios ENABLE ROW LEVEL SECURITY;

-- Helper: empresas do usuario (security definer, evita recursao de RLS)
CREATE OR REPLACE FUNCTION public.empresas_do_usuario(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
$$;
REVOKE ALL ON FUNCTION public.empresas_do_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.empresa_do_usuario(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
   ORDER BY CASE papel WHEN 'proprietario' THEN 0 WHEN 'administrador' THEN 1 ELSE 2 END, created_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.empresa_do_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) TO authenticated, service_role;

-- Politicas: empresas
CREATE POLICY "empresas_select_membro_ou_admin" ON public.empresas
  FOR SELECT TO authenticated
  USING (
    app_private.eh_administrador(auth.uid())
    OR id IN (SELECT public.empresas_do_usuario(auth.uid()))
  );

CREATE POLICY "empresas_insert_admin" ON public.empresas
  FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY "empresas_update_admin" ON public.empresas
  FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

-- Politicas: empresa_usuarios (leitura apenas; escrita via servidor)
CREATE POLICY "empresa_usuarios_select" ON public.empresa_usuarios
  FOR SELECT TO authenticated
  USING (
    app_private.eh_administrador(auth.uid())
    OR user_id = auth.uid()
    OR empresa_id IN (SELECT public.empresas_do_usuario(auth.uid()))
  );

-- PLANOS (catalogo interno; espelha o catalogo do provedor)
CREATE TABLE public.planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ambiente text NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox','live')),
  periodicidade text CHECK (periodicidade IN ('mensal','anual','trimestral','semestral','unico')),
  valor_centavos integer,
  moeda text NOT NULL DEFAULT 'BRL',
  dias_trial integer NOT NULL DEFAULT 0,
  modulos text[] NOT NULL DEFAULT '{}',
  max_usuarios integer,
  recursos jsonb NOT NULL DEFAULT '{}'::jsonb,
  limites jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_product_id text,
  provider_price_id text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo, ambiente)
);

GRANT SELECT, INSERT, UPDATE ON public.planos TO authenticated;
GRANT ALL ON public.planos TO service_role;
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planos_select_autenticado" ON public.planos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "planos_insert_admin" ON public.planos
  FOR INSERT TO authenticated WITH CHECK (app_private.eh_administrador(auth.uid()));
CREATE POLICY "planos_update_admin" ON public.planos
  FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

-- ASSINATURAS
CREATE TABLE public.assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  plano_codigo text,
  plano_id uuid REFERENCES public.planos(id) ON DELETE SET NULL,
  ambiente text NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox','live')),
  status text NOT NULL DEFAULT 'incompleta'
    CHECK (status IN ('incompleta','trial','ativa','pagamento_pendente','suspensa','cancelada','encerrada')),
  provider text NOT NULL DEFAULT 'paddle',
  provider_subscription_id text,
  provider_customer_id text,
  provider_price_id text,
  provider_product_id text,
  quantidade integer NOT NULL DEFAULT 1,
  valor_centavos integer,
  moeda text NOT NULL DEFAULT 'BRL',
  periodicidade text,
  data_inicio timestamptz,
  periodo_atual_inicio timestamptz,
  periodo_atual_fim timestamptz,
  proxima_cobranca timestamptz,
  trial_inicio timestamptz,
  trial_fim timestamptz,
  cancelar_no_fim_periodo boolean NOT NULL DEFAULT false,
  cancelada_em timestamptz,
  encerrada_em timestamptz,
  motivo_status text,
  contratada_por uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX assinaturas_provider_sub_uidx
  ON public.assinaturas (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX assinaturas_empresa_idx ON public.assinaturas (empresa_id, ambiente, status);

GRANT SELECT ON public.assinaturas TO authenticated;
GRANT ALL ON public.assinaturas TO service_role;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assinaturas_select_membro_ou_admin" ON public.assinaturas
  FOR SELECT TO authenticated
  USING (
    app_private.eh_administrador(auth.uid())
    OR empresa_id IN (SELECT public.empresas_do_usuario(auth.uid()))
  );

-- PAGAMENTOS
CREATE TABLE public.assinatura_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id uuid REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ambiente text NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox','live')),
  provider text NOT NULL DEFAULT 'paddle',
  provider_transaction_id text,
  provider_invoice_numero text,
  status text NOT NULL CHECK (status IN ('aprovado','recusado','reembolsado','pendente','estornado')),
  valor_centavos integer,
  moeda text NOT NULL DEFAULT 'BRL',
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  motivo_falha text,
  url_recibo text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX assinatura_pagamentos_tx_uidx
  ON public.assinatura_pagamentos (provider_transaction_id, status)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX assinatura_pagamentos_empresa_idx ON public.assinatura_pagamentos (empresa_id, ocorrido_em DESC);

GRANT SELECT ON public.assinatura_pagamentos TO authenticated;
GRANT ALL ON public.assinatura_pagamentos TO service_role;
ALTER TABLE public.assinatura_pagamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assinatura_pagamentos_select_membro_ou_admin" ON public.assinatura_pagamentos
  FOR SELECT TO authenticated
  USING (
    app_private.eh_administrador(auth.uid())
    OR empresa_id IN (SELECT public.empresas_do_usuario(auth.uid()))
  );

-- LOG DE EVENTOS DO PROVEDOR (idempotencia)
CREATE TABLE public.webhook_eventos_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'paddle',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  ambiente text NOT NULL DEFAULT 'sandbox' CHECK (ambiente IN ('sandbox','live')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processado boolean NOT NULL DEFAULT false,
  processado_em timestamptz,
  erro text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

GRANT SELECT ON public.webhook_eventos_pagamento TO authenticated;
GRANT ALL ON public.webhook_eventos_pagamento TO service_role;
ALTER TABLE public.webhook_eventos_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_eventos_select_admin" ON public.webhook_eventos_pagamento
  FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

-- TRIGGERS updated_at
CREATE TRIGGER empresas_updated_at BEFORE UPDATE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER empresa_usuarios_updated_at BEFORE UPDATE ON public.empresa_usuarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER planos_updated_at BEFORE UPDATE ON public.planos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER assinaturas_updated_at BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FUNCOES DE VALIDACAO (backend)
CREATE OR REPLACE FUNCTION public.assinatura_ativa_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live')
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assinaturas
     WHERE empresa_id = _empresa_id
       AND ambiente = _ambiente
       AND (
         (status IN ('ativa','trial','pagamento_pendente')
            AND (periodo_atual_fim IS NULL OR periodo_atual_fim > now()))
         OR (status = 'cancelada' AND periodo_atual_fim > now())
       )
  )
$$;
REVOKE ALL ON FUNCTION public.assinatura_ativa_empresa(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.plano_da_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live')
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.plano_da_empresa(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) TO authenticated, service_role;
