CREATE INDEX IF NOT EXISTS materiais_created_at_idx ON public.materiais (created_at);
CREATE INDEX IF NOT EXISTS material_imagens_created_at_idx ON public.material_imagens (created_at);
CREATE INDEX IF NOT EXISTS conferencias_created_at_idx ON public.conferencias (created_at);
CREATE INDEX IF NOT EXISTS conferencia_itens_updated_at_idx ON public.conferencia_itens (updated_at);
CREATE INDEX IF NOT EXISTS historico_conferencias_updated_at_idx ON public.historico_conferencias (updated_at);
CREATE INDEX IF NOT EXISTS unidades_created_at_idx ON public.unidades (created_at);
CREATE INDEX IF NOT EXISTS user_profiles_updated_at_idx ON public.user_profiles (updated_at);