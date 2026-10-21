CREATE TABLE public.notificacoes_conferencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conferencia_id uuid REFERENCES public.conferencias(id) ON DELETE SET NULL,
  unidade_id uuid REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo text NOT NULL DEFAULT 'conferencia_iniciada',
  user_id uuid NOT NULL,
  usuario_nome text,
  usuario_email text,
  matricula text,
  frota text,
  local text,
  modulo text,
  data date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  hora text,
  status text NOT NULL DEFAULT 'em_andamento',
  email_status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notificacoes_conferencia TO authenticated;
GRANT ALL ON public.notificacoes_conferencia TO service_role;
ALTER TABLE public.notificacoes_conferencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem todas as notificacoes de conferencia"
ON public.notificacoes_conferencia FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Usuario registra o proprio inicio de conferencia"
ON public.notificacoes_conferencia FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins atualizam status da notificacao"
ON public.notificacoes_conferencia FOR UPDATE TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR user_id = auth.uid())
WITH CHECK (app_private.eh_administrador(auth.uid()) OR user_id = auth.uid());

CREATE TRIGGER trg_notificacoes_conferencia_updated
BEFORE UPDATE ON public.notificacoes_conferencia
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_notif_conf_created ON public.notificacoes_conferencia (created_at DESC);
CREATE INDEX idx_notif_conf_data ON public.notificacoes_conferencia (data);
CREATE INDEX idx_notif_conf_user ON public.notificacoes_conferencia (user_id);

CREATE TABLE public.notificacao_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid REFERENCES public.notificacoes_conferencia(id) ON DELETE CASCADE,
  destinatario text NOT NULL,
  assunto text,
  status text NOT NULL DEFAULT 'enviado',
  confirmado boolean NOT NULL DEFAULT false,
  erro text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notificacao_emails TO authenticated;
GRANT ALL ON public.notificacao_emails TO service_role;
ALTER TABLE public.notificacao_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem historico de envios"
ON public.notificacao_emails FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()));

CREATE INDEX idx_notif_email_enviado ON public.notificacao_emails (enviado_em DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes_conferencia;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacao_emails;