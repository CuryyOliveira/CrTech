CREATE TABLE public.metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo text NOT NULL DEFAULT 'usuario',
  alvo text NOT NULL,
  alvo_nome text,
  periodo text NOT NULL DEFAULT 'mensal',
  min_conferencias numeric,
  tempo_max_segundos integer,
  percentual_min numeric,
  max_divergencias numeric,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.metas TO authenticated;
GRANT ALL ON public.metas TO service_role;

ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;

CREATE POLICY metas_select_admin ON public.metas FOR SELECT TO authenticated
  USING (app_private.perfil_atual() = 'administrador');
CREATE POLICY metas_insert_admin ON public.metas FOR INSERT TO authenticated
  WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY metas_update_admin ON public.metas FOR UPDATE TO authenticated
  USING (app_private.perfil_atual() = 'administrador')
  WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY metas_delete_admin ON public.metas FOR DELETE TO authenticated
  USING (app_private.perfil_atual() = 'administrador');

CREATE TRIGGER metas_updated_at BEFORE UPDATE ON public.metas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_metas_escopo_alvo ON public.metas (escopo, alvo);

ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_conferencias;