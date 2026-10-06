CREATE TABLE public.empresa_whatsapp_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  telefone text NOT NULL,
  telefone_normalizado text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  receber_inicio_conferencia boolean NOT NULL DEFAULT true,
  receber_conclusao_conferencia boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresa_whatsapp_destinatarios TO authenticated;
GRANT ALL ON public.empresa_whatsapp_destinatarios TO service_role;

ALTER TABLE public.empresa_whatsapp_destinatarios ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_wa_dest_empresa ON public.empresa_whatsapp_destinatarios (empresa_id);
CREATE UNIQUE INDEX uq_wa_dest_empresa_telefone
  ON public.empresa_whatsapp_destinatarios (empresa_id, telefone_normalizado);

CREATE POLICY "wa_dest_select_empresa" ON public.empresa_whatsapp_destinatarios
  FOR SELECT TO authenticated
  USING (
    app_private.eh_global(auth.uid())
    OR (
      app_private.eh_administrador(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.empresa_usuarios eu
         WHERE eu.user_id = auth.uid() AND eu.ativo = true
           AND eu.empresa_id = empresa_whatsapp_destinatarios.empresa_id
      )
    )
  );

CREATE POLICY "wa_dest_insert_admin" ON public.empresa_whatsapp_destinatarios
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.eh_global(auth.uid())
    OR app_private.eh_admin_empresa(empresa_id, auth.uid())
  );

CREATE POLICY "wa_dest_update_admin" ON public.empresa_whatsapp_destinatarios
  FOR UPDATE TO authenticated
  USING (
    app_private.eh_global(auth.uid())
    OR app_private.eh_admin_empresa(empresa_id, auth.uid())
  )
  WITH CHECK (
    app_private.eh_global(auth.uid())
    OR app_private.eh_admin_empresa(empresa_id, auth.uid())
  );

CREATE POLICY "wa_dest_delete_admin" ON public.empresa_whatsapp_destinatarios
  FOR DELETE TO authenticated
  USING (
    app_private.eh_global(auth.uid())
    OR app_private.eh_admin_empresa(empresa_id, auth.uid())
  );

CREATE TRIGGER empresa_whatsapp_destinatarios_updated_at
  BEFORE UPDATE ON public.empresa_whatsapp_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.whatsapp_destinatarios_limite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ativos int;
BEGIN
  IF NEW.ativo = false THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ativo = true AND OLD.empresa_id = NEW.empresa_id THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _ativos
    FROM public.empresa_whatsapp_destinatarios d
   WHERE d.empresa_id = NEW.empresa_id AND d.ativo = true AND d.id <> NEW.id;

  IF _ativos >= 5 THEN
    RAISE EXCEPTION 'Limite de 5 números de WhatsApp atingido para esta empresa.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_destinatarios_limite() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER whatsapp_destinatarios_limite
  BEFORE INSERT OR UPDATE ON public.empresa_whatsapp_destinatarios
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_destinatarios_limite();

CREATE TABLE public.whatsapp_notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conferencia_id uuid REFERENCES public.conferencias(id) ON DELETE SET NULL,
  destinatario_id uuid REFERENCES public.empresa_whatsapp_destinatarios(id) ON DELETE SET NULL,
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('CONFERENCIA_INICIADA','CONFERENCIA_CONCLUIDA')),
  telefone_mascarado text,
  status text NOT NULL DEFAULT 'preparado'
    CHECK (status IN ('preparado','pendente','enviado','falha','ignorado')),
  provider_message_id text,
  erro text,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_notificacoes TO authenticated;
GRANT ALL ON public.whatsapp_notificacoes TO service_role;

ALTER TABLE public.whatsapp_notificacoes ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX uq_wa_notif_idempotency ON public.whatsapp_notificacoes (idempotency_key);
CREATE INDEX idx_wa_notif_empresa ON public.whatsapp_notificacoes (empresa_id, created_at DESC);

CREATE POLICY "wa_notif_select_admin_empresa" ON public.whatsapp_notificacoes
  FOR SELECT TO authenticated
  USING (
    app_private.eh_global(auth.uid())
    OR (
      app_private.eh_administrador(auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.empresa_usuarios eu
         WHERE eu.user_id = auth.uid() AND eu.ativo = true
           AND eu.empresa_id = whatsapp_notificacoes.empresa_id
      )
    )
  );

CREATE TRIGGER whatsapp_notificacoes_updated_at
  BEFORE UPDATE ON public.whatsapp_notificacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();