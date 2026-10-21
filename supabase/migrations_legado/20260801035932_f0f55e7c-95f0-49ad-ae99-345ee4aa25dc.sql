-- ============ Histórico Operacional ============
CREATE TABLE public.historico_conferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conferencia_id uuid UNIQUE REFERENCES public.conferencias(id) ON DELETE SET NULL,
  unidade_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  usuario_email text,
  nome text,
  perfil text,
  setor text,
  modulo text NOT NULL DEFAULT '',
  modulo_titulo text,
  lista text,
  data date NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio timestamptz NOT NULL DEFAULT now(),
  hora_fim timestamptz,
  duracao_segundos integer,
  quantidade_prevista numeric NOT NULL DEFAULT 0,
  quantidade_conferida numeric NOT NULL DEFAULT 0,
  divergencias numeric NOT NULL DEFAULT 0,
  percentual numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'em_andamento',
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.historico_conferencias TO authenticated;
GRANT ALL ON public.historico_conferencias TO service_role;

ALTER TABLE public.historico_conferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historico_select_admin" ON public.historico_conferencias
  FOR SELECT TO authenticated
  USING (app_private.perfil_atual() = 'administrador');

CREATE POLICY "historico_insert_own" ON public.historico_conferencias
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "historico_update_own" ON public.historico_conferencias
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER historico_conferencias_updated_at
  BEFORE UPDATE ON public.historico_conferencias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_hist_user ON public.historico_conferencias (user_id);
CREATE INDEX idx_hist_modulo ON public.historico_conferencias (modulo);
CREATE INDEX idx_hist_status ON public.historico_conferencias (status);
CREATE INDEX idx_hist_data ON public.historico_conferencias (data DESC);
CREATE INDEX idx_hist_setor ON public.historico_conferencias (setor);
CREATE INDEX idx_hist_created ON public.historico_conferencias (created_at DESC);

-- ============ Log de Auditoria ============
ALTER TABLE public.auditoria
  ADD COLUMN IF NOT EXISTS perfil text,
  ADD COLUMN IF NOT EXISTS setor text,
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS tipo_acao text NOT NULL DEFAULT 'operacao',
  ADD COLUMN IF NOT EXISTS modulo text,
  ADD COLUMN IF NOT EXISTS lista text,
  ADD COLUMN IF NOT EXISTS resultado text NOT NULL DEFAULT 'sucesso';

DROP POLICY IF EXISTS auditoria_read ON public.auditoria;
CREATE POLICY "auditoria_read" ON public.auditoria
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR app_private.perfil_atual() = 'administrador');

CREATE INDEX IF NOT EXISTS idx_aud_user ON public.auditoria (user_id);
CREATE INDEX IF NOT EXISTS idx_aud_tipo ON public.auditoria (tipo_acao);
CREATE INDEX IF NOT EXISTS idx_aud_modulo ON public.auditoria (modulo);
CREATE INDEX IF NOT EXISTS idx_aud_setor ON public.auditoria (setor);
CREATE INDEX IF NOT EXISTS idx_aud_created ON public.auditoria (created_at DESC);