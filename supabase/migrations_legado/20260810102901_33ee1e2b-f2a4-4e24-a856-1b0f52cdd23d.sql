ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS provider_plan_id text,
  ADD COLUMN IF NOT EXISTS provider_plan_atualizado_em timestamptz;

COMMENT ON COLUMN public.planos.provider_plan_id IS 'Identificador do plano de assinatura no provedor atual (Mercado Pago: preapproval_plan_id).';
COMMENT ON COLUMN public.planos.provider_plan_atualizado_em IS 'Momento da última sincronização do plano com o provedor de pagamento.';

CREATE INDEX IF NOT EXISTS planos_provider_plan_id_idx ON public.planos (provider_plan_id) WHERE provider_plan_id IS NOT NULL;