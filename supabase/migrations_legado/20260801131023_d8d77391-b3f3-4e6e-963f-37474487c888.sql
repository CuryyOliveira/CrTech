-- 1. Leituras de notificações (notificações são derivadas do histórico/auditoria)
CREATE TABLE public.notificacao_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  chave text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chave)
);
GRANT SELECT, INSERT, DELETE ON public.notificacao_leituras TO authenticated;
GRANT ALL ON public.notificacao_leituras TO service_role;
ALTER TABLE public.notificacao_leituras ENABLE ROW LEVEL SECURITY;
CREATE POLICY notificacao_leituras_select ON public.notificacao_leituras FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notificacao_leituras_insert ON public.notificacao_leituras FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY notificacao_leituras_delete ON public.notificacao_leituras FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX idx_notificacao_leituras_user ON public.notificacao_leituras (user_id, chave);

-- 2. Relatórios agendados (reutilizam o módulo de Relatórios)
CREATE TABLE public.relatorios_agendados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  fonte text NOT NULL DEFAULT 'historico',
  frequencia text NOT NULL DEFAULT 'diario',
  hora text NOT NULL DEFAULT '08:00',
  formato text NOT NULL DEFAULT 'pdf',
  filtros jsonb NOT NULL DEFAULT '{}'::jsonb,
  destinatarios text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  ultima_execucao timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorios_agendados TO authenticated;
GRANT ALL ON public.relatorios_agendados TO service_role;
ALTER TABLE public.relatorios_agendados ENABLE ROW LEVEL SECURITY;
CREATE POLICY relatorios_agendados_select ON public.relatorios_agendados FOR SELECT TO authenticated USING (app_private.perfil_atual() = 'administrador');
CREATE POLICY relatorios_agendados_insert ON public.relatorios_agendados FOR INSERT TO authenticated WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY relatorios_agendados_update ON public.relatorios_agendados FOR UPDATE TO authenticated USING (app_private.perfil_atual() = 'administrador') WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY relatorios_agendados_delete ON public.relatorios_agendados FOR DELETE TO authenticated USING (app_private.perfil_atual() = 'administrador');
CREATE TRIGGER trg_relatorios_agendados_updated BEFORE UPDATE ON public.relatorios_agendados FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Configurações do sistema (limites usados pelos alertas)
CREATE TABLE public.configuracoes_sistema (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.configuracoes_sistema TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.configuracoes_sistema TO authenticated;
GRANT ALL ON public.configuracoes_sistema TO service_role;
ALTER TABLE public.configuracoes_sistema ENABLE ROW LEVEL SECURITY;
CREATE POLICY configuracoes_select ON public.configuracoes_sistema FOR SELECT TO authenticated USING (true);
CREATE POLICY configuracoes_insert ON public.configuracoes_sistema FOR INSERT TO authenticated WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY configuracoes_update ON public.configuracoes_sistema FOR UPDATE TO authenticated USING (app_private.perfil_atual() = 'administrador') WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY configuracoes_delete ON public.configuracoes_sistema FOR DELETE TO authenticated USING (app_private.perfil_atual() = 'administrador');
CREATE TRIGGER trg_configuracoes_updated BEFORE UPDATE ON public.configuracoes_sistema FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.configuracoes_sistema (chave, valor) VALUES
  ('alertas', '{"minutos_sem_movimentacao": 30, "tempo_maximo_minutos": 120, "limite_divergencias": 5}'::jsonb);

-- 4. Estrutura para integrações futuras (nada ativado nesta fase)
CREATE TABLE public.integracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL UNIQUE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integracoes TO authenticated;
GRANT ALL ON public.integracoes TO service_role;
ALTER TABLE public.integracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY integracoes_select ON public.integracoes FOR SELECT TO authenticated USING (app_private.perfil_atual() = 'administrador');
CREATE POLICY integracoes_insert ON public.integracoes FOR INSERT TO authenticated WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY integracoes_update ON public.integracoes FOR UPDATE TO authenticated USING (app_private.perfil_atual() = 'administrador') WITH CHECK (app_private.perfil_atual() = 'administrador');
CREATE POLICY integracoes_delete ON public.integracoes FOR DELETE TO authenticated USING (app_private.perfil_atual() = 'administrador');
CREATE TRIGGER trg_integracoes_updated BEFORE UPDATE ON public.integracoes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.integracoes (tipo, nome) VALUES
  ('power_bi', 'Power BI'),
  ('teams', 'Microsoft Teams'),
  ('whatsapp', 'WhatsApp'),
  ('slack', 'Slack'),
  ('api_rest', 'API REST'),
  ('backup', 'Backup automático');