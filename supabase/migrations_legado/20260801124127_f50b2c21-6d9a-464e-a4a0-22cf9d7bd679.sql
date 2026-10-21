CREATE INDEX IF NOT EXISTS idx_hist_lista ON public.historico_conferencias (lista);
CREATE INDEX IF NOT EXISTS idx_hist_perfil ON public.historico_conferencias (perfil);
CREATE INDEX IF NOT EXISTS idx_hist_duracao ON public.historico_conferencias (duracao_segundos);
CREATE INDEX IF NOT EXISTS idx_hist_divergencias ON public.historico_conferencias (divergencias);
CREATE INDEX IF NOT EXISTS idx_aud_lista ON public.auditoria (lista);
CREATE INDEX IF NOT EXISTS idx_aud_perfil ON public.auditoria (perfil);
CREATE INDEX IF NOT EXISTS idx_aud_resultado ON public.auditoria (resultado);