ALTER TABLE public.conferencia_itens
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'lista',
  ADD COLUMN IF NOT EXISTS motivo_inclusao text,
  ADD COLUMN IF NOT EXISTS incluido_por uuid,
  ADD COLUMN IF NOT EXISTS incluido_por_nome text,
  ADD COLUMN IF NOT EXISTS incluido_em timestamptz;

CREATE INDEX IF NOT EXISTS conferencia_itens_origem_idx
  ON public.conferencia_itens (conferencia_id, origem);