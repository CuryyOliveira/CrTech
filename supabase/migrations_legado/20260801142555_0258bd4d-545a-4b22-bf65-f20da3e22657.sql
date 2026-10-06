ALTER TABLE public.notificacoes_conferencia
  ADD COLUMN IF NOT EXISTS assunto text,
  ADD COLUMN IF NOT EXISTS mensagem text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tipo_conferencia text,
  ADD COLUMN IF NOT EXISTS gravidade text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_tentativa timestamp with time zone;

ALTER TABLE public.notificacao_emails
  ADD COLUMN IF NOT EXISTS tentativa integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_notif_conf_tipo ON public.notificacoes_conferencia (tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_conf_email_status ON public.notificacoes_conferencia (email_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_conf_unico_evento
  ON public.notificacoes_conferencia (conferencia_id, tipo)
  WHERE tipo IN ('conferencia_concluida', 'conferencia_atrasada');
CREATE INDEX IF NOT EXISTS idx_conferencias_abertas
  ON public.conferencias (status, hora_inicio)
  WHERE status IN ('em_andamento', 'pausada');