-- BASELINE V2 — schema real de produção em 29/09/2026 (Postgres 17.6, Supabase).
-- Gerado por supabase/baseline/gerar_baseline.py a partir do catálogo (somente leitura).
-- NÃO executar em produção: lá este schema já existe. Em produção esta versão é
-- apenas MARCADA como aplicada (ver docs/DATABASE_BASELINE.md).
-- Não contém dados nem segredos (app_private.hook_secrets vai vazia; o agendamento
-- do monitor é recriado com um segredo aleatório gerado no próprio banco).

SET check_function_bodies = false;
SET client_min_messages = warning;
SET search_path = public, extensions;


-- ============================================================================
-- Schemas e extensões
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
-- pg_cron / pg_net só existem na plataforma Supabase: criados apenas se disponíveis.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  END IF;
END $$;


-- ============================================================================
-- Tipos
-- ============================================================================

CREATE TYPE public.app_role AS ENUM ('admin', 'conferente', 'visualizador');


-- ============================================================================
-- Tabelas
-- ============================================================================

CREATE TABLE app_private.hook_secrets (
  nome text NOT NULL,
  valor text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.assinatura_pagamentos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  assinatura_id uuid,
  empresa_id uuid,
  ambiente text DEFAULT 'sandbox'::text NOT NULL,
  provider text DEFAULT 'mercadopago'::text NOT NULL,
  provider_transaction_id text,
  provider_invoice_numero text,
  status text NOT NULL,
  valor_centavos integer,
  moeda text DEFAULT 'BRL'::text NOT NULL,
  ocorrido_em timestamp with time zone DEFAULT now() NOT NULL,
  motivo_falha text,
  url_recibo text,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.assinaturas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  plano_codigo text,
  plano_id uuid,
  ambiente text DEFAULT 'sandbox'::text NOT NULL,
  status text DEFAULT 'incompleta'::text NOT NULL,
  provider text DEFAULT 'mercadopago'::text NOT NULL,
  provider_subscription_id text,
  provider_customer_id text,
  provider_price_id text,
  provider_product_id text,
  quantidade integer DEFAULT 1 NOT NULL,
  valor_centavos integer,
  moeda text DEFAULT 'BRL'::text NOT NULL,
  periodicidade text,
  data_inicio timestamp with time zone,
  periodo_atual_inicio timestamp with time zone,
  periodo_atual_fim timestamp with time zone,
  proxima_cobranca timestamp with time zone,
  trial_inicio timestamp with time zone,
  trial_fim timestamp with time zone,
  cancelar_no_fim_periodo boolean DEFAULT false NOT NULL,
  cancelada_em timestamp with time zone,
  encerrada_em timestamp with time zone,
  motivo_status text,
  contratada_por uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ultimo_evento_em timestamp with time zone
);

CREATE TABLE public.auditoria (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid(),
  usuario text,
  acao text NOT NULL,
  detalhe text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  perfil text,
  setor text,
  nome text,
  tipo_acao text DEFAULT 'operacao'::text NOT NULL,
  modulo text,
  lista text,
  resultado text DEFAULT 'sucesso'::text NOT NULL,
  ip text,
  dispositivo text
);

CREATE TABLE public.aviso_leituras (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  aviso_id uuid NOT NULL,
  user_id uuid NOT NULL,
  confirmado boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.avisos_sistema (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  categoria text DEFAULT 'aviso'::text NOT NULL,
  prioridade text DEFAULT 'info'::text NOT NULL,
  destino_perfil text,
  destino_setor text,
  agendado_para timestamp with time zone,
  publicado boolean DEFAULT true NOT NULL,
  exige_confirmacao boolean DEFAULT false NOT NULL,
  arquivado boolean DEFAULT false NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cadastros_mestres (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tipo text NOT NULL,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ordem integer DEFAULT 0 NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  excluido boolean DEFAULT false NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.conferencia_itens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conferencia_id uuid NOT NULL,
  material_id uuid,
  codigo text,
  descricao text,
  locacao text,
  quantidade_esperada numeric DEFAULT 0 NOT NULL,
  quantidade_contada numeric,
  observacoes text,
  fotos jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'pendente'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  origem text DEFAULT 'lista'::text NOT NULL,
  motivo_inclusao text,
  incluido_por uuid,
  incluido_por_nome text,
  incluido_em timestamp with time zone
);

CREATE TABLE public.conferencia_pausas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conferencia_id uuid NOT NULL,
  pausada_em timestamp with time zone DEFAULT now() NOT NULL,
  retomada_em timestamp with time zone,
  segundos integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.conferencias (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  unidade_id uuid NOT NULL,
  tipo text DEFAULT 'caminhao'::text NOT NULL,
  data date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date NOT NULL,
  hora_inicio timestamp with time zone DEFAULT now() NOT NULL,
  hora_fim timestamp with time zone,
  conferente text,
  responsavel text,
  almoxarife text,
  codigo_almoxarife text,
  assinatura text,
  assinatura_gestor text,
  observacoes text,
  status text DEFAULT 'em_andamento'::text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  total_tempo_pausado integer DEFAULT 0 NOT NULL,
  ultima_pausa timestamp with time zone,
  ultima_retomada timestamp with time zone,
  tempo_trabalhado integer,
  quantidade_pausas integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.configuracoes_sistema (
  chave text NOT NULL,
  valor jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empresa_modulos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  icone text DEFAULT 'package'::text NOT NULL,
  cor text,
  tipo text DEFAULT 'lista'::text NOT NULL,
  recursos jsonb DEFAULT '{}'::jsonb NOT NULL,
  ordem integer DEFAULT 0 NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  excluido boolean DEFAULT false NOT NULL,
  origem text DEFAULT 'personalizado'::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empresa_setores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ordem integer DEFAULT 0 NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  origem text DEFAULT 'personalizado'::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empresa_usuarios (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  user_id uuid NOT NULL,
  papel text DEFAULT 'membro'::text NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empresa_whatsapp_destinatarios (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL,
  telefone_normalizado text NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  receber_inicio_conferencia boolean DEFAULT true NOT NULL,
  receber_conclusao_conferencia boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.empresas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text NOT NULL,
  cnpj text,
  email_contato text,
  telefone text,
  observacoes text,
  ativo boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  bloqueada boolean DEFAULT false NOT NULL,
  bloqueada_em timestamp with time zone,
  motivo_bloqueio text,
  desativada_em timestamp with time zone,
  segmento text,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  onboarding_etapa text
);

CREATE TABLE public.historico_conferencias (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conferencia_id uuid,
  unidade_id uuid,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  usuario_email text,
  nome text,
  perfil text,
  setor text,
  modulo text DEFAULT ''::text NOT NULL,
  modulo_titulo text,
  lista text,
  data date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date NOT NULL,
  hora_inicio timestamp with time zone DEFAULT now() NOT NULL,
  hora_fim timestamp with time zone,
  duracao_segundos integer,
  quantidade_prevista numeric DEFAULT 0 NOT NULL,
  quantidade_conferida numeric DEFAULT 0 NOT NULL,
  divergencias numeric DEFAULT 0 NOT NULL,
  percentual numeric DEFAULT 0 NOT NULL,
  status text DEFAULT 'em_andamento'::text NOT NULL,
  detalhes jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  total_tempo_pausado integer DEFAULT 0 NOT NULL,
  ultima_pausa timestamp with time zone,
  ultima_retomada timestamp with time zone,
  tempo_trabalhado integer,
  quantidade_pausas integer DEFAULT 0 NOT NULL,
  empresa_id uuid,
  modulo_id uuid
);

CREATE TABLE public.integracoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tipo text NOT NULL,
  nome text NOT NULL,
  ativo boolean DEFAULT false NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.materiais (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  unidade_id uuid NOT NULL,
  codigo text NOT NULL,
  descricao text DEFAULT ''::text NOT NULL,
  quantidade_esperada numeric DEFAULT 0 NOT NULL,
  locacao text,
  funcionario_nome text,
  funcionario_codigo text,
  imagem_principal text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.material_imagens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  material_id uuid NOT NULL,
  url_imagem text NOT NULL,
  descricao text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.metas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  escopo text DEFAULT 'usuario'::text NOT NULL,
  alvo text NOT NULL,
  alvo_nome text,
  periodo text DEFAULT 'mensal'::text NOT NULL,
  min_conferencias numeric,
  tempo_max_segundos integer,
  percentual_min numeric,
  max_divergencias numeric,
  ativo boolean DEFAULT true NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  empresa_id uuid,
  modulo_id uuid
);

CREATE TABLE public.notificacao_emails (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  notificacao_id uuid,
  destinatario text NOT NULL,
  assunto text,
  status text DEFAULT 'enviado'::text NOT NULL,
  confirmado boolean DEFAULT false NOT NULL,
  erro text,
  enviado_em timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  tentativa integer DEFAULT 1 NOT NULL
);

CREATE TABLE public.notificacao_leituras (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  chave text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notificacoes_conferencia (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conferencia_id uuid,
  unidade_id uuid,
  tipo text DEFAULT 'conferencia_iniciada'::text NOT NULL,
  user_id uuid NOT NULL,
  usuario_nome text,
  usuario_email text,
  matricula text,
  frota text,
  local text,
  modulo text,
  data date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date NOT NULL,
  hora text,
  status text DEFAULT 'em_andamento'::text NOT NULL,
  email_status text DEFAULT 'pendente'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  assunto text,
  mensagem text,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  tipo_conferencia text,
  gravidade text DEFAULT 'info'::text NOT NULL,
  tentativas integer DEFAULT 0 NOT NULL,
  ultima_tentativa timestamp with time zone,
  empresa_id uuid,
  modulo_id uuid
);

CREATE TABLE public.permissoes_perfil (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  perfil text NOT NULL,
  modulo text NOT NULL,
  acoes text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);

CREATE TABLE public.permissoes_usuario (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  modulo text NOT NULL,
  acoes text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);

CREATE TABLE public.planos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ambiente text DEFAULT 'sandbox'::text NOT NULL,
  periodicidade text,
  valor_centavos integer,
  moeda text DEFAULT 'BRL'::text NOT NULL,
  dias_trial integer DEFAULT 0 NOT NULL,
  modulos text[] DEFAULT '{}'::text[] NOT NULL,
  max_usuarios integer,
  recursos jsonb DEFAULT '{}'::jsonb NOT NULL,
  limites jsonb DEFAULT '{}'::jsonb NOT NULL,
  provider_product_id text,
  provider_price_id text,
  ordem integer DEFAULT 0 NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  provider_plan_id text,
  provider_plan_atualizado_em timestamp with time zone
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  nome text,
  email text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.relatorios_agendados (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text NOT NULL,
  fonte text DEFAULT 'historico'::text NOT NULL,
  frequencia text DEFAULT 'diario'::text NOT NULL,
  hora text DEFAULT '08:00'::text NOT NULL,
  formato text DEFAULT 'pdf'::text NOT NULL,
  filtros jsonb DEFAULT '{}'::jsonb NOT NULL,
  destinatarios text DEFAULT ''::text NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  ultima_execucao timestamp with time zone,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sessoes_usuario (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  dispositivo text,
  navegador text,
  ip text,
  iniciada_em timestamp with time zone DEFAULT now() NOT NULL,
  ultimo_ping timestamp with time zone DEFAULT now() NOT NULL,
  encerrada_em timestamp with time zone,
  encerrada_por uuid,
  motivo_encerramento text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.unidades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tipo text DEFAULT 'caminhao'::text NOT NULL,
  nome text NOT NULL,
  placa text,
  modelo text,
  frota text,
  ano text,
  setor text,
  matricula text,
  gestor text,
  observacoes text,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  empresa_id uuid,
  modulo_id uuid
);

CREATE TABLE public.user_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  nome text,
  perfil text DEFAULT 'agricola'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  setor text,
  bloqueado boolean DEFAULT false NOT NULL,
  foto_url text,
  assinatura text,
  ultimo_acesso timestamp with time zone
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role app_role DEFAULT 'conferente'::app_role NOT NULL
);

CREATE TABLE public.usuarios_legados (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  email text NOT NULL,
  motivo text DEFAULT 'Usuário existente antes do onboarding SaaS'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.webhook_eventos_pagamento (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text DEFAULT 'mercadopago'::text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  ambiente text DEFAULT 'sandbox'::text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  processado boolean DEFAULT false NOT NULL,
  processado_em timestamp with time zone,
  erro text,
  recebido_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.whatsapp_notificacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  empresa_id uuid NOT NULL,
  conferencia_id uuid,
  destinatario_id uuid,
  tipo_evento text NOT NULL,
  telefone_mascarado text,
  status text DEFAULT 'preparado'::text NOT NULL,
  provider_message_id text,
  erro text,
  idempotency_key text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);


-- ============================================================================
-- Chaves primárias, únicas e CHECK
-- ============================================================================

ALTER TABLE ONLY app_private.hook_secrets ADD CONSTRAINT hook_secrets_pkey PRIMARY KEY (nome);
ALTER TABLE ONLY public.assinatura_pagamentos ADD CONSTRAINT assinatura_pagamentos_ambiente_check CHECK ((ambiente = ANY (ARRAY['sandbox'::text, 'live'::text])));
ALTER TABLE ONLY public.assinatura_pagamentos ADD CONSTRAINT assinatura_pagamentos_status_check CHECK ((status = ANY (ARRAY['aprovado'::text, 'recusado'::text, 'reembolsado'::text, 'pendente'::text, 'estornado'::text])));
ALTER TABLE ONLY public.assinatura_pagamentos ADD CONSTRAINT assinatura_pagamentos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assinaturas ADD CONSTRAINT assinaturas_ambiente_check CHECK ((ambiente = ANY (ARRAY['sandbox'::text, 'live'::text])));
ALTER TABLE ONLY public.assinaturas ADD CONSTRAINT assinaturas_status_check CHECK ((status = ANY (ARRAY['incompleta'::text, 'trial'::text, 'ativa'::text, 'pagamento_pendente'::text, 'suspensa'::text, 'cancelada'::text, 'encerrada'::text])));
ALTER TABLE ONLY public.assinaturas ADD CONSTRAINT assinaturas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auditoria ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.aviso_leituras ADD CONSTRAINT aviso_leituras_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.aviso_leituras ADD CONSTRAINT aviso_leituras_aviso_id_user_id_key UNIQUE (aviso_id, user_id);
ALTER TABLE ONLY public.avisos_sistema ADD CONSTRAINT avisos_sistema_categoria_check CHECK ((categoria = ANY (ARRAY['aviso'::text, 'atualizacao'::text, 'alerta'::text, 'notificacao'::text])));
ALTER TABLE ONLY public.avisos_sistema ADD CONSTRAINT avisos_sistema_prioridade_check CHECK ((prioridade = ANY (ARRAY['info'::text, 'aviso'::text, 'atencao'::text, 'critica'::text])));
ALTER TABLE ONLY public.avisos_sistema ADD CONSTRAINT avisos_sistema_titulo_check CHECK ((length(btrim(titulo)) > 0));
ALTER TABLE ONLY public.avisos_sistema ADD CONSTRAINT avisos_sistema_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cadastros_mestres ADD CONSTRAINT cadastros_mestres_nome_check CHECK ((length(btrim(nome)) > 0));
ALTER TABLE ONLY public.cadastros_mestres ADD CONSTRAINT cadastros_mestres_tipo_check CHECK ((tipo = ANY (ARRAY['setor'::text, 'perfil'::text, 'modulo'::text, 'categoria'::text, 'tipo_conferencia'::text])));
ALTER TABLE ONLY public.cadastros_mestres ADD CONSTRAINT cadastros_mestres_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.conferencia_itens ADD CONSTRAINT conferencia_itens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.conferencia_pausas ADD CONSTRAINT conferencia_pausas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.conferencias ADD CONSTRAINT conferencias_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.configuracoes_sistema ADD CONSTRAINT configuracoes_sistema_pkey PRIMARY KEY (chave);
ALTER TABLE ONLY public.empresa_modulos ADD CONSTRAINT empresa_modulos_origem_check CHECK ((origem = ANY (ARRAY['sugerido'::text, 'personalizado'::text, 'legado'::text])));
ALTER TABLE ONLY public.empresa_modulos ADD CONSTRAINT empresa_modulos_tipo_check CHECK ((tipo = ANY (ARRAY['lista'::text, 'caixa'::text, 'frota'::text])));
ALTER TABLE ONLY public.empresa_modulos ADD CONSTRAINT empresa_modulos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.empresa_setores ADD CONSTRAINT empresa_setores_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.empresa_setores ADD CONSTRAINT empresa_setores_empresa_id_codigo_key UNIQUE (empresa_id, codigo);
ALTER TABLE ONLY public.empresa_usuarios ADD CONSTRAINT empresa_usuarios_papel_check CHECK ((papel = ANY (ARRAY['proprietario'::text, 'administrador'::text, 'membro'::text])));
ALTER TABLE ONLY public.empresa_usuarios ADD CONSTRAINT empresa_usuarios_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.empresa_usuarios ADD CONSTRAINT empresa_usuarios_empresa_id_user_id_key UNIQUE (empresa_id, user_id);
ALTER TABLE ONLY public.empresa_whatsapp_destinatarios ADD CONSTRAINT empresa_whatsapp_destinatarios_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.empresas ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.historico_conferencias ADD CONSTRAINT historico_conferencias_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.historico_conferencias ADD CONSTRAINT historico_conferencias_conferencia_id_key UNIQUE (conferencia_id);
ALTER TABLE ONLY public.integracoes ADD CONSTRAINT integracoes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.integracoes ADD CONSTRAINT integracoes_tipo_key UNIQUE (tipo);
ALTER TABLE ONLY public.materiais ADD CONSTRAINT materiais_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.material_imagens ADD CONSTRAINT material_imagens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.metas ADD CONSTRAINT metas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notificacao_emails ADD CONSTRAINT notificacao_emails_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notificacao_leituras ADD CONSTRAINT notificacao_leituras_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notificacao_leituras ADD CONSTRAINT notificacao_leituras_user_id_chave_key UNIQUE (user_id, chave);
ALTER TABLE ONLY public.notificacoes_conferencia ADD CONSTRAINT notificacoes_conferencia_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permissoes_perfil ADD CONSTRAINT permissoes_perfil_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permissoes_perfil ADD CONSTRAINT permissoes_perfil_perfil_modulo_key UNIQUE (perfil, modulo);
ALTER TABLE ONLY public.permissoes_usuario ADD CONSTRAINT permissoes_usuario_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permissoes_usuario ADD CONSTRAINT permissoes_usuario_user_id_modulo_key UNIQUE (user_id, modulo);
ALTER TABLE ONLY public.planos ADD CONSTRAINT planos_ambiente_check CHECK ((ambiente = ANY (ARRAY['sandbox'::text, 'live'::text])));
ALTER TABLE ONLY public.planos ADD CONSTRAINT planos_periodicidade_check CHECK ((periodicidade = ANY (ARRAY['mensal'::text, 'anual'::text, 'trimestral'::text, 'semestral'::text, 'unico'::text])));
ALTER TABLE ONLY public.planos ADD CONSTRAINT planos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.planos ADD CONSTRAINT planos_codigo_ambiente_key UNIQUE (codigo, ambiente);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.relatorios_agendados ADD CONSTRAINT relatorios_agendados_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessoes_usuario ADD CONSTRAINT sessoes_usuario_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.unidades ADD CONSTRAINT unidades_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_perfil_check CHECK ((perfil = ANY (ARRAY['proprietario'::text, 'super_admin'::text, 'administrador'::text, 'gestor'::text, 'agricola'::text, 'industria'::text, 'usuario'::text])));
ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE ONLY public.usuarios_legados ADD CONSTRAINT usuarios_legados_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usuarios_legados ADD CONSTRAINT usuarios_legados_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.webhook_eventos_pagamento ADD CONSTRAINT webhook_eventos_pagamento_ambiente_check CHECK ((ambiente = ANY (ARRAY['sandbox'::text, 'live'::text])));
ALTER TABLE ONLY public.webhook_eventos_pagamento ADD CONSTRAINT webhook_eventos_pagamento_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.webhook_eventos_pagamento ADD CONSTRAINT webhook_eventos_pagamento_provider_provider_event_id_key UNIQUE (provider, provider_event_id);
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_status_check CHECK ((status = ANY (ARRAY['preparado'::text, 'pendente'::text, 'enviado'::text, 'falha'::text, 'ignorado'::text])));
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_tipo_evento_check CHECK ((tipo_evento = ANY (ARRAY['CONFERENCIA_INICIADA'::text, 'CONFERENCIA_CONCLUIDA'::text])));
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_pkey PRIMARY KEY (id);


-- ============================================================================
-- Funções
-- ============================================================================

CREATE OR REPLACE FUNCTION app_private.acesso_unidade(_tipo text, _empresa_id uuid, _modulo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT CASE
    WHEN _modulo_id IS NOT NULL THEN
      (_empresa_id IS NULL OR app_private.pertence_empresa(_empresa_id, auth.uid()))
      AND app_private.nivel(auth.uid()) >= 2
    ELSE
      (
        _empresa_id IS NULL
        OR app_private.pertence_empresa(_empresa_id, auth.uid())
        OR (
          app_private.eh_legado(auth.uid())
          AND app_private.empresa_legada(_empresa_id)
        )
      )
      AND app_private.pode_tipo(_tipo)
  END
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_admin_empresa(_empresa_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_global(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
         AND eu.papel IN ('proprietario', 'administrador')
    )
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_administrador(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT app_private.nivel(_user_id) >= 4
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_gestor(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT app_private.nivel(_user_id) >= 3
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_global(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT app_private.nivel(_user_id) >= 5
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_legado(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios_legados WHERE user_id = _user_id
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_master()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = auth.uid()
       AND lower(u.email) = 'lucassamuel2003@hotmail.com'
       AND u.deleted_at IS NULL
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.eh_proprietario(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = _user_id AND perfil = 'proprietario'
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.empresa_legada(_empresa_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _empresa_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.empresa_usuarios eu
      JOIN public.usuarios_legados l ON l.user_id = eu.user_id
     WHERE eu.empresa_id = _empresa_id
       AND eu.ativo = true
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$function$;

CREATE OR REPLACE FUNCTION app_private.limite_modulos_empresa(_empresa_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(p.limites -> 'max_modulos', 'null'::jsonb)::int
    FROM public.assinaturas a
    JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = _empresa_id
     AND a.provider = 'mercadopago'
     AND a.status IN ('ativa','trial','pagamento_pendente')
     AND (a.periodo_atual_fim IS NULL OR a.periodo_atual_fim > now())
   ORDER BY CASE a.status WHEN 'ativa' THEN 0 WHEN 'trial' THEN 1 ELSE 2 END, a.created_at DESC
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION app_private.mesma_empresa(_a uuid, _b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.empresa_usuarios a
      JOIN public.empresa_usuarios b ON b.empresa_id = a.empresa_id
     WHERE a.user_id = _a AND a.ativo = true
       AND b.user_id = _b AND b.ativo = true
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.mesma_empresa_ou_legado(_alvo uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
  SELECT
    _alvo = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.perfil IN ('proprietario','super_admin'))
    -- Contas anteriores ao SaaS mantêm a visão global que já possuíam.
    OR EXISTS (SELECT 1 FROM public.usuarios_legados l WHERE l.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid() AND p.created_at < '2026-08-10T00:00:00Z')
    -- Empresas do modelo SaaS: apenas usuários da mesma empresa.
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios a
       JOIN public.empresa_usuarios b ON b.empresa_id = a.empresa_id
       WHERE a.user_id = auth.uid() AND b.user_id = _alvo
    )
$function$;

CREATE OR REPLACE FUNCTION app_private.minhas_empresas()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT empresa_id
    FROM public.empresa_usuarios
   WHERE user_id = auth.uid()
     AND ativo = true
$function$;

CREATE OR REPLACE FUNCTION app_private.nivel(_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT CASE WHEN bloqueado THEN 0 ELSE app_private.nivel_perfil(perfil) END
       FROM public.user_profiles WHERE user_id = _user_id LIMIT 1), 0)
$function$;

CREATE OR REPLACE FUNCTION app_private.nivel_atual()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT app_private.nivel(auth.uid())
$function$;

CREATE OR REPLACE FUNCTION app_private.nivel_perfil(_perfil text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _perfil
    WHEN 'proprietario' THEN 6
    WHEN 'super_admin' THEN 5
    WHEN 'administrador' THEN 4
    WHEN 'gestor' THEN 3
    WHEN 'agricola' THEN 2
    WHEN 'industria' THEN 2
    WHEN 'usuario' THEN 1
    ELSE 0 END
$function$;

CREATE OR REPLACE FUNCTION app_private.perfil_atual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN perfil IN ('proprietario','super_admin') THEN 'administrador'
           ELSE perfil
         END
    FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION app_private.pertence_empresa(_empresa_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_global(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
    )
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.pode_tipo(_tipo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE app_private.perfil_atual()
    WHEN 'administrador' THEN true
    WHEN 'gestor' THEN true
    WHEN 'agricola' THEN _tipo IN ('caminhao','caixa','prateleira')
    WHEN 'industria' THEN _tipo IN ('caixa_industria','prateleira_industria')
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION app_private.pode_unidade(_unidade_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.unidades u
     WHERE u.id = _unidade_id
       AND app_private.acesso_unidade(u.tipo, u.empresa_id, u.modulo_id)
  )
$function$;

CREATE OR REPLACE FUNCTION app_private.proteger_proprietario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  atual uuid := auth.uid();
BEGIN
  IF atual IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; -- servidor confiável
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.perfil = 'proprietario' AND OLD.user_id <> atual THEN
      RAISE EXCEPTION 'Somente o Proprietário do Sistema pode alterar a própria conta';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.perfil = 'proprietario' AND OLD.user_id <> atual THEN
    RAISE EXCEPTION 'Somente o Proprietário do Sistema pode alterar a própria conta';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.perfil = 'proprietario' AND NOT app_private.eh_proprietario(atual) THEN
    RAISE EXCEPTION 'Somente o Proprietário do Sistema pode definir um novo Proprietário';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.perfil = 'proprietario' AND OLD.perfil <> 'proprietario'
     AND NOT app_private.eh_proprietario(atual) THEN
    RAISE EXCEPTION 'Somente o Proprietário do Sistema pode definir um novo Proprietário';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.setor_atual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT setor FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION app_private.validar_hook(_nome text, _valor text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_private.hook_secrets
    WHERE nome = _nome AND valor = _valor
  )
$function$;

CREATE OR REPLACE FUNCTION public.assinatura_ativa_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.assinaturas
       WHERE empresa_id = _empresa_id
         AND ambiente = _ambiente
         AND provider = 'mercadopago'
         AND (
           (status IN ('ativa','trial','pagamento_pendente')
              AND (periodo_atual_fim IS NULL OR periodo_atual_fim > now()))
           OR (status = 'cancelada' AND periodo_atual_fim IS NOT NULL AND periodo_atual_fim > now())
         )
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.conferencias_tempo_pausa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  agora timestamptz := now();
  fim_pausa timestamptz;
BEGIN
  NEW.total_tempo_pausado := COALESCE(NEW.total_tempo_pausado, COALESCE(OLD.total_tempo_pausado, 0));
  NEW.quantidade_pausas := COALESCE(NEW.quantidade_pausas, COALESCE(OLD.quantidade_pausas, 0));

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Entrando em pausa: congela o cronômetro e abre um período de pausa.
    IF NEW.status = 'pausada' AND OLD.status <> 'pausada' THEN
      NEW.ultima_pausa := agora;
      NEW.quantidade_pausas := COALESCE(OLD.quantidade_pausas, 0) + 1;
      INSERT INTO public.conferencia_pausas (conferencia_id, pausada_em) VALUES (NEW.id, agora);

    -- Saindo da pausa: fecha o período e acumula o tempo pausado.
    ELSIF OLD.status = 'pausada' AND NEW.status <> 'pausada' THEN
      fim_pausa := COALESCE(OLD.ultima_pausa, agora);
      NEW.total_tempo_pausado := COALESCE(OLD.total_tempo_pausado, 0)
        + GREATEST(0, EXTRACT(EPOCH FROM (agora - fim_pausa))::int);
      UPDATE public.conferencia_pausas
         SET retomada_em = agora,
             segundos = GREATEST(0, EXTRACT(EPOCH FROM (agora - pausada_em))::int)
       WHERE conferencia_id = NEW.id AND retomada_em IS NULL;
      NEW.ultima_pausa := NULL;
      IF NEW.status = 'em_andamento' THEN
        NEW.ultima_retomada := agora;
      END IF;
    END IF;
  ELSIF NEW.status = 'pausada' AND NEW.ultima_pausa IS NULL THEN
    -- Autocorreção: conferência pausada sem marca de pausa registrada.
    NEW.ultima_pausa := agora;
    NEW.quantidade_pausas := GREATEST(1, COALESCE(OLD.quantidade_pausas, 0));
    INSERT INTO public.conferencia_pausas (conferencia_id, pausada_em) VALUES (NEW.id, agora);
  END IF;

  IF NEW.status IN ('finalizada','cancelada') THEN
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(NEW.hora_fim, agora) - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  ELSIF NEW.status = 'pausada' THEN
    -- Congelado no instante da pausa: nada é somado enquanto pausada.
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(NEW.ultima_pausa, agora) - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  ELSE
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (agora - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.criar_empresa_onboarding(_nome text, _cnpj text DEFAULT NULL::text, _email text DEFAULT NULL::text, _telefone text DEFAULT NULL::text, _observacoes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_nome text := btrim(coalesce(_nome, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF length(v_nome) < 2 THEN
    RAISE EXCEPTION 'Informe o nome da empresa';
  END IF;

  SELECT empresa_id INTO v_id
    FROM public.empresa_usuarios
   WHERE user_id = v_user AND ativo = true
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.empresas (nome, cnpj, email_contato, telefone, observacoes, created_by)
  VALUES (
    v_nome,
    nullif(btrim(coalesce(_cnpj, '')), ''),
    nullif(btrim(coalesce(_email, '')), ''),
    nullif(btrim(coalesce(_telefone, '')), ''),
    nullif(btrim(coalesce(_observacoes, '')), ''),
    v_user
  )
  RETURNING id INTO v_id;

  INSERT INTO public.empresa_usuarios (empresa_id, user_id, papel, ativo)
  VALUES (v_id, v_user, 'proprietario', true);

  UPDATE public.user_profiles
     SET perfil = 'administrador'
   WHERE user_id = v_user
     AND perfil NOT IN ('proprietario', 'super_admin', 'administrador');

  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.criar_modulos_iniciais(_empresa_id uuid, _modulos jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_nome text;
  v_codigo text;
  v_criados integer := 0;
  v_ordem integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT app_private.eh_admin_empresa(_empresa_id, v_user) THEN
    RAISE EXCEPTION 'Somente o administrador da empresa pode criar módulos';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_modulos, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    CONTINUE WHEN length(v_nome) < 2;

    v_codigo := coalesce(nullif(btrim(coalesce(v_item->>'codigo', '')), ''),
                         upper(regexp_replace(v_nome, '[^a-zA-Z0-9]+', '_', 'g')));
    v_ordem := v_ordem + 1;

    INSERT INTO public.empresa_modulos
      (empresa_id, codigo, nome, descricao, icone, cor, tipo, recursos, ordem, origem, created_by)
    VALUES (
      _empresa_id,
      v_codigo,
      v_nome,
      nullif(btrim(coalesce(v_item->>'descricao', '')), ''),
      coalesce(nullif(btrim(coalesce(v_item->>'icone', '')), ''), 'package'),
      nullif(btrim(coalesce(v_item->>'cor', '')), ''),
      CASE WHEN v_item->>'tipo' IN ('lista', 'caixa', 'frota') THEN v_item->>'tipo' ELSE 'lista' END,
      coalesce(v_item->'recursos', '{}'::jsonb),
      coalesce((v_item->>'ordem')::int, v_ordem),
      CASE WHEN v_item->>'origem' = 'sugerido' THEN 'sugerido' ELSE 'personalizado' END,
      v_user
    )
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END
$function$;

CREATE OR REPLACE FUNCTION public.criar_setores_iniciais(_empresa_id uuid, _setores jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_nome text;
  v_codigo text;
  v_ordem integer := 0;
  v_criados integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT app_private.eh_admin_empresa(_empresa_id, v_user) THEN
    RAISE EXCEPTION 'Somente o administrador da empresa pode criar setores';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_setores, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    CONTINUE WHEN length(v_nome) < 2;

    v_codigo := coalesce(nullif(btrim(coalesce(v_item->>'codigo', '')), ''),
                         lower(regexp_replace(v_nome, '[^a-zA-Z0-9]+', '_', 'g')));
    v_ordem := v_ordem + 1;

    INSERT INTO public.empresa_setores (empresa_id, codigo, nome, descricao, ordem, origem, created_by)
    VALUES (
      _empresa_id,
      v_codigo,
      v_nome,
      nullif(btrim(coalesce(v_item->>'descricao', '')), ''),
      coalesce((v_item->>'ordem')::int, v_ordem),
      'personalizado',
      v_user
    )
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END
$function$;

CREATE OR REPLACE FUNCTION public.diagnostico_permissoes(_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_global(auth.uid())
         AND NOT (app_private.eh_administrador(auth.uid())
                  AND app_private.mesma_empresa(auth.uid(), _user_id))
      THEN NULL::jsonb
    ELSE jsonb_build_object(
      'perfil_atual', (SELECT perfil FROM public.user_profiles WHERE user_id = _user_id LIMIT 1),
      'nivel', app_private.nivel(_user_id),
      'eh_administrador', app_private.eh_administrador(_user_id),
      'eh_gestor', app_private.eh_gestor(_user_id)
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.eh_usuario_legado(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT exists (SELECT 1 FROM public.usuarios_legados WHERE user_id = _user_id)
$function$;

CREATE OR REPLACE FUNCTION public.empresa_do_usuario(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR app_private.eh_global(auth.uid())
          OR (app_private.eh_administrador(auth.uid())
              AND app_private.mesma_empresa(auth.uid(), _user_id)))
   ORDER BY CASE papel WHEN 'proprietario' THEN 0 WHEN 'administrador' THEN 1 ELSE 2 END, created_at
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.empresa_modulos_limite_plano()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _limite int;
  _usados int;
BEGIN
  IF NEW.origem = 'legado' OR NEW.ativo = false OR NEW.excluido = true THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ativo = true AND OLD.excluido = false THEN
    RETURN NEW;
  END IF;

  _limite := app_private.limite_modulos_empresa(NEW.empresa_id);
  IF _limite IS NULL THEN
    RETURN NEW; -- sem plano vigente ou plano sem limite
  END IF;

  SELECT count(*) INTO _usados FROM public.empresa_modulos m
   WHERE m.empresa_id = NEW.empresa_id AND m.ativo = true AND m.excluido = false
     AND m.id <> NEW.id;

  IF _usados >= _limite THEN
    RAISE EXCEPTION 'O plano contratado permite no máximo % módulo(s) ativo(s). Desative um módulo ou faça upgrade do plano.', _limite
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.empresas_do_usuario(_user_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.empresa_usuarios
   WHERE user_id = _user_id AND ativo = true
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR app_private.eh_global(auth.uid())
          OR (app_private.eh_administrador(auth.uid())
              AND app_private.mesma_empresa(auth.uid(), _user_id)))
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'conferente') on conflict do nothing;
  insert into public.user_profiles (user_id, nome, perfil)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), 'agricola')
  on conflict (user_id) do nothing;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user_id <> auth.uid()
         AND NOT app_private.eh_global(auth.uid())
         AND NOT (app_private.eh_administrador(auth.uid())
                  AND app_private.mesma_empresa(auth.uid(), _user_id))
      THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  END
$function$;

CREATE OR REPLACE FUNCTION public.historico_cascade_notificacoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.conferencia_id IS NOT NULL THEN
    DELETE FROM public.notificacoes_conferencia n
     WHERE n.conferencia_id = OLD.conferencia_id;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.importar_dados_legados(_tabela text, _registros jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  permitidas constant text[] := ARRAY[
    'empresas','empresa_setores','empresa_modulos','empresa_usuarios','profiles','user_profiles',
    'user_roles','permissoes_perfil','permissoes_usuario','cadastros_mestres','integracoes',
    'configuracoes_sistema','planos','assinaturas','assinatura_pagamentos','avisos_sistema',
    'unidades','materiais','conferencias','conferencia_itens','conferencia_pausas',
    'historico_conferencias','notificacoes_conferencia','notificacao_emails','notificacao_leituras',
    'auditoria','metas','material_imagens','aviso_leituras'];
  col_usuario constant jsonb := '{"profiles":"id","user_profiles":"user_id","user_roles":"user_id",
    "empresa_usuarios":"user_id","permissoes_usuario":"user_id","notificacao_leituras":"user_id",
    "aviso_leituras":"user_id"}';
  tipos jsonb;
  obrig jsonb;
  dados jsonb;
  colunas text;
  atualizar text;
  total integer;
BEGIN
  IF NOT (_tabela = ANY (permitidas)) THEN
    RAISE EXCEPTION 'Tabela não permitida na restauração: %', _tabela;
  END IF;
  IF jsonb_typeof(_registros) <> 'array' THEN
    RAISE EXCEPTION 'Registros inválidos';
  END IF;

  SELECT jsonb_object_agg(column_name, udt_name),
         jsonb_object_agg(column_name, (is_nullable = 'NO' AND udt_name = 'text'))
    INTO tipos, obrig
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = _tabela;

  SELECT coalesce(jsonb_agg(conv.obj), '[]'::jsonb) INTO dados
    FROM jsonb_array_elements(_registros) r(reg)
    CROSS JOIN LATERAL (
      SELECT jsonb_object_agg(e.key,
        CASE
          WHEN e.value IS NULL OR e.value = 'null'::jsonb OR e.value = '""'::jsonb THEN
            CASE WHEN coalesce((obrig ->> e.key)::boolean, false) THEN '""'::jsonb ELSE 'null'::jsonb END
          WHEN tipos ->> e.key IN ('jsonb', 'json') OR left(tipos ->> e.key, 1) = '_' THEN
            CASE WHEN jsonb_typeof(e.value) = 'string' THEN (e.value #>> '{}')::jsonb ELSE e.value END
          ELSE e.value
        END) AS obj
      FROM jsonb_each(r.reg) e
      WHERE tipos ? e.key
    ) conv;

  IF col_usuario ? _tabela THEN
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO dados
      FROM jsonb_array_elements(dados) d
     WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = d ->> (col_usuario ->> _tabela));
  END IF;

  IF _tabela = 'configuracoes_sistema' THEN
    SELECT jsonb_agg(CASE WHEN d ->> 'chave' = 'emails_conferencia'
      THEN jsonb_set(jsonb_set(d, '{valor,remetente}', '"nao-responda@conferenciarapida.com.br"'),
                     '{valor,sender_domain}', '"conferenciarapida.com.br"')
      ELSE d END) INTO dados
      FROM jsonb_array_elements(dados) d;
  END IF;

  IF jsonb_array_length(dados) = 0 THEN
    RETURN 0;
  END IF;

  CASE _tabela
    WHEN 'user_profiles' THEN
      DELETE FROM public.user_profiles t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.id::text <> d ->> 'id';
    WHEN 'user_roles' THEN
      DELETE FROM public.user_roles t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.role::text = d ->> 'role' AND t.id::text <> d ->> 'id';
    WHEN 'permissoes_usuario' THEN
      DELETE FROM public.permissoes_usuario t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.modulo = d ->> 'modulo' AND t.id::text <> d ->> 'id';
    WHEN 'permissoes_perfil' THEN
      DELETE FROM public.permissoes_perfil t USING jsonb_array_elements(dados) d
       WHERE t.perfil = d ->> 'perfil' AND t.modulo = d ->> 'modulo' AND t.id::text <> d ->> 'id';
    WHEN 'integracoes' THEN
      DELETE FROM public.integracoes t USING jsonb_array_elements(dados) d WHERE t.tipo = d ->> 'tipo' AND t.id::text <> d ->> 'id';
    WHEN 'planos' THEN
      DELETE FROM public.planos t USING jsonb_array_elements(dados) d
       WHERE t.codigo = d ->> 'codigo' AND t.ambiente = d ->> 'ambiente' AND t.id::text <> d ->> 'id';
    WHEN 'cadastros_mestres' THEN
      DELETE FROM public.cadastros_mestres t USING jsonb_array_elements(dados) d
       WHERE t.tipo = d ->> 'tipo' AND lower(t.codigo) = lower(d ->> 'codigo') AND t.id::text <> d ->> 'id';
    WHEN 'empresa_usuarios' THEN
      DELETE FROM public.empresa_usuarios t USING jsonb_array_elements(dados) d
       WHERE t.empresa_id = (d ->> 'empresa_id')::uuid AND t.user_id = (d ->> 'user_id')::uuid AND t.id::text <> d ->> 'id';
    WHEN 'empresa_setores' THEN
      DELETE FROM public.empresa_setores t USING jsonb_array_elements(dados) d
       WHERE t.empresa_id = (d ->> 'empresa_id')::uuid AND t.codigo = d ->> 'codigo' AND t.id::text <> d ->> 'id';
    WHEN 'notificacao_leituras' THEN
      DELETE FROM public.notificacao_leituras t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.chave = d ->> 'chave' AND t.id::text <> d ->> 'id';
    ELSE NULL;
  END CASE;

  SELECT string_agg(quote_ident(k), ', ') INTO colunas
    FROM jsonb_object_keys(dados -> 0) k
   WHERE tipos ? k;

  SELECT string_agg(format('%1$I = EXCLUDED.%1$I', k), ', ') INTO atualizar
    FROM jsonb_object_keys(dados -> 0) k
   WHERE tipos ? k AND k NOT IN ('id', 'chave');

  EXECUTE format(
    'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) '
    'ON CONFLICT (%3$s) DO UPDATE SET %4$s',
    _tabela, colunas,
    CASE WHEN _tabela = 'configuracoes_sistema' THEN 'chave' ELSE 'id' END,
    atualizar)
    USING dados;
  GET DIAGNOSTICS total = ROW_COUNT;
  RETURN total;
END
$function$;

CREATE OR REPLACE FUNCTION public.materiais_normalizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.codigo := NULLIF(btrim(regexp_replace(COALESCE(NEW.codigo,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', '', 'g')), '');
  NEW.codigo := COALESCE(NEW.codigo, '—');
  NEW.descricao := btrim(regexp_replace(COALESCE(NEW.descricao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g'));
  NEW.descricao := regexp_replace(NEW.descricao, '\s+', ' ', 'g');
  NEW.locacao := NULLIF(btrim(regexp_replace(COALESCE(NEW.locacao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g')), '');
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.modulos_ativos_empresa(_empresa_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::integer
    ELSE (
      SELECT count(*)::integer FROM public.empresa_modulos m
       WHERE m.empresa_id = _empresa_id AND m.ativo = true AND m.excluido = false
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.plano_da_empresa(_empresa_id uuid, _ambiente text DEFAULT 'live'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::jsonb
    ELSE (
      SELECT jsonb_build_object(
               'assinatura_id', a.id,
               'status', a.status,
               'plano_codigo', a.plano_codigo,
               'periodicidade', a.periodicidade,
               'valor_centavos', a.valor_centavos,
               'moeda', a.moeda,
               'periodo_atual_fim', a.periodo_atual_fim,
               'proxima_cobranca', a.proxima_cobranca,
               'trial_fim', a.trial_fim,
               'cancelar_no_fim_periodo', a.cancelar_no_fim_periodo,
               'modulos', COALESCE(p.modulos, '{}'::text[]),
               'max_usuarios', p.max_usuarios,
               'max_modulos', (p.limites -> 'max_modulos'),
               'recursos', COALESCE(p.recursos, '{}'::jsonb),
               'limites', COALESCE(p.limites, '{}'::jsonb)
             )
        FROM public.assinaturas a
        LEFT JOIN public.planos p ON p.id = a.plano_id
       WHERE a.empresa_id = _empresa_id AND a.ambiente = _ambiente
         AND a.provider = 'mercadopago'
       ORDER BY CASE a.status WHEN 'ativa' THEN 0 WHEN 'trial' THEN 1 WHEN 'pagamento_pendente' THEN 2 ELSE 3 END,
                a.created_at DESC
       LIMIT 1
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.preencher_escopo_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
BEGIN
  IF NEW.empresa_id IS NULL AND NEW.unidade_id IS NOT NULL THEN
    SELECT u.empresa_id, COALESCE(NEW.modulo_id, u.modulo_id)
      INTO NEW.empresa_id, NEW.modulo_id
      FROM public.unidades u WHERE u.id = NEW.unidade_id;
  END IF;
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := public.empresa_do_usuario(auth.uid());
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.sync_historico_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.hora_fim IS DISTINCT FROM OLD.hora_fim
     OR NEW.total_tempo_pausado IS DISTINCT FROM OLD.total_tempo_pausado
     OR NEW.quantidade_pausas IS DISTINCT FROM OLD.quantidade_pausas
     OR NEW.ultima_pausa IS DISTINCT FROM OLD.ultima_pausa
     OR NEW.tempo_trabalhado IS DISTINCT FROM OLD.tempo_trabalhado THEN
    UPDATE public.historico_conferencias h
       SET status = NEW.status,
           hora_fim = CASE WHEN NEW.status IN ('finalizada','cancelada') THEN COALESCE(NEW.hora_fim, now()) ELSE NULL END,
           total_tempo_pausado = COALESCE(NEW.total_tempo_pausado, 0),
           quantidade_pausas = COALESCE(NEW.quantidade_pausas, 0),
           ultima_pausa = NEW.ultima_pausa,
           ultima_retomada = NEW.ultima_retomada,
           tempo_trabalhado = NEW.tempo_trabalhado,
           duracao_segundos = CASE
             WHEN NEW.status IN ('finalizada','cancelada') THEN NEW.tempo_trabalhado
             ELSE NULL END,
           updated_at = now()
     WHERE h.conferencia_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unidades_escopo_empresa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := public.empresa_do_usuario(auth.uid());
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.usuarios_ativos_empresa(_empresa_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND NOT app_private.eh_global(auth.uid())
         AND NOT EXISTS (
           SELECT 1 FROM public.empresa_usuarios eu
            WHERE eu.user_id = auth.uid() AND eu.ativo = true AND eu.empresa_id = _empresa_id
         )
      THEN NULL::integer
    ELSE (
      SELECT count(*)::integer
        FROM public.empresa_usuarios eu
        LEFT JOIN public.user_profiles up ON up.user_id = eu.user_id
       WHERE eu.empresa_id = _empresa_id
         AND eu.ativo = true
         AND coalesce(up.bloqueado, false) = false
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.validar_hook(_nome text, _valor text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_private.hook_secrets
    WHERE nome = _nome AND valor = _valor
  )
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_destinatarios_limite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


-- ============================================================================
-- Chaves estrangeiras
-- ============================================================================

ALTER TABLE ONLY public.assinatura_pagamentos ADD CONSTRAINT assinatura_pagamentos_assinatura_id_fkey FOREIGN KEY (assinatura_id) REFERENCES assinaturas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assinatura_pagamentos ADD CONSTRAINT assinatura_pagamentos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assinaturas ADD CONSTRAINT assinaturas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assinaturas ADD CONSTRAINT assinaturas_plano_id_fkey FOREIGN KEY (plano_id) REFERENCES planos(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.aviso_leituras ADD CONSTRAINT aviso_leituras_aviso_id_fkey FOREIGN KEY (aviso_id) REFERENCES avisos_sistema(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conferencia_itens ADD CONSTRAINT conferencia_itens_conferencia_id_fkey FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conferencia_itens ADD CONSTRAINT conferencia_itens_material_id_fkey FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.conferencia_pausas ADD CONSTRAINT conferencia_pausas_conferencia_id_fkey FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conferencias ADD CONSTRAINT conferencias_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.empresa_modulos ADD CONSTRAINT empresa_modulos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.empresa_setores ADD CONSTRAINT empresa_setores_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.empresa_usuarios ADD CONSTRAINT empresa_usuarios_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.empresa_usuarios ADD CONSTRAINT empresa_usuarios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.empresa_whatsapp_destinatarios ADD CONSTRAINT empresa_whatsapp_destinatarios_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.historico_conferencias ADD CONSTRAINT historico_conferencias_conferencia_id_fkey FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.historico_conferencias ADD CONSTRAINT historico_conferencias_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.historico_conferencias ADD CONSTRAINT historico_conferencias_modulo_id_fkey FOREIGN KEY (modulo_id) REFERENCES empresa_modulos(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.materiais ADD CONSTRAINT materiais_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.material_imagens ADD CONSTRAINT material_imagens_material_id_fkey FOREIGN KEY (material_id) REFERENCES materiais(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.metas ADD CONSTRAINT metas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.metas ADD CONSTRAINT metas_modulo_id_fkey FOREIGN KEY (modulo_id) REFERENCES empresa_modulos(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notificacao_emails ADD CONSTRAINT notificacao_emails_notificacao_id_fkey FOREIGN KEY (notificacao_id) REFERENCES notificacoes_conferencia(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notificacoes_conferencia ADD CONSTRAINT notificacoes_conferencia_conferencia_id_fkey FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notificacoes_conferencia ADD CONSTRAINT notificacoes_conferencia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notificacoes_conferencia ADD CONSTRAINT notificacoes_conferencia_modulo_id_fkey FOREIGN KEY (modulo_id) REFERENCES empresa_modulos(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notificacoes_conferencia ADD CONSTRAINT notificacoes_conferencia_unidade_id_fkey FOREIGN KEY (unidade_id) REFERENCES unidades(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.unidades ADD CONSTRAINT unidades_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.unidades ADD CONSTRAINT unidades_modulo_id_fkey FOREIGN KEY (modulo_id) REFERENCES empresa_modulos(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_profiles ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.usuarios_legados ADD CONSTRAINT usuarios_legados_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_conferencia_id_fkey FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_destinatario_id_fkey FOREIGN KEY (destinatario_id) REFERENCES empresa_whatsapp_destinatarios(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.whatsapp_notificacoes ADD CONSTRAINT whatsapp_notificacoes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE;


-- ============================================================================
-- Índices
-- ============================================================================

CREATE INDEX assinatura_pagamentos_empresa_idx ON public.assinatura_pagamentos USING btree (empresa_id, ocorrido_em DESC);
CREATE UNIQUE INDEX assinatura_pagamentos_tx_uidx ON public.assinatura_pagamentos USING btree (provider_transaction_id, status);
CREATE INDEX assinaturas_empresa_idx ON public.assinaturas USING btree (empresa_id, ambiente, status);
CREATE UNIQUE INDEX assinaturas_provider_sub_uidx ON public.assinaturas USING btree (provider_subscription_id);
CREATE INDEX auditoria_tipo_acao_idx ON public.auditoria USING btree (tipo_acao, created_at DESC);
CREATE INDEX idx_aud_created ON public.auditoria USING btree (created_at DESC);
CREATE INDEX idx_aud_lista ON public.auditoria USING btree (lista);
CREATE INDEX idx_aud_modulo ON public.auditoria USING btree (modulo);
CREATE INDEX idx_aud_perfil ON public.auditoria USING btree (perfil);
CREATE INDEX idx_aud_resultado ON public.auditoria USING btree (resultado);
CREATE INDEX idx_aud_setor ON public.auditoria USING btree (setor);
CREATE INDEX idx_aud_tipo ON public.auditoria USING btree (tipo_acao);
CREATE INDEX idx_aud_user ON public.auditoria USING btree (user_id);
CREATE INDEX aviso_leituras_user_idx ON public.aviso_leituras USING btree (user_id);
CREATE INDEX avisos_sistema_publicado_idx ON public.avisos_sistema USING btree (publicado, agendado_para DESC);
CREATE UNIQUE INDEX cadastros_mestres_tipo_codigo_idx ON public.cadastros_mestres USING btree (tipo, lower(codigo)) WHERE (excluido = false);
CREATE INDEX cadastros_mestres_tipo_idx ON public.cadastros_mestres USING btree (tipo, ordem, nome);
CREATE INDEX conferencia_itens_conferencia_id_idx ON public.conferencia_itens USING btree (conferencia_id);
CREATE INDEX conferencia_itens_origem_idx ON public.conferencia_itens USING btree (conferencia_id, origem);
CREATE UNIQUE INDEX conferencia_itens_unico_material ON public.conferencia_itens USING btree (conferencia_id, material_id) WHERE (material_id IS NOT NULL);
CREATE INDEX conferencia_itens_updated_at_idx ON public.conferencia_itens USING btree (updated_at);
CREATE INDEX idx_conferencia_pausas_conf ON public.conferencia_pausas USING btree (conferencia_id, pausada_em);
CREATE INDEX conferencias_created_at_idx ON public.conferencias USING btree (created_at);
CREATE INDEX conferencias_unidade_id_idx ON public.conferencias USING btree (unidade_id);
CREATE INDEX idx_conferencias_abertas ON public.conferencias USING btree (status, hora_inicio) WHERE (status = ANY (ARRAY['em_andamento'::text, 'pausada'::text]));
CREATE UNIQUE INDEX empresa_modulos_codigo_uk ON public.empresa_modulos USING btree (empresa_id, codigo);
CREATE INDEX empresa_modulos_empresa_idx ON public.empresa_modulos USING btree (empresa_id, ordem);
CREATE UNIQUE INDEX empresa_modulos_nome_uk ON public.empresa_modulos USING btree (empresa_id, lower(btrim(nome))) WHERE (excluido = false);
CREATE INDEX empresa_setores_empresa_idx ON public.empresa_setores USING btree (empresa_id, ordem);
CREATE INDEX empresa_usuarios_user_idx ON public.empresa_usuarios USING btree (user_id);
CREATE INDEX idx_wa_dest_empresa ON public.empresa_whatsapp_destinatarios USING btree (empresa_id);
CREATE UNIQUE INDEX uq_wa_dest_empresa_telefone ON public.empresa_whatsapp_destinatarios USING btree (empresa_id, telefone_normalizado);
CREATE UNIQUE INDEX empresas_cnpj_uidx ON public.empresas USING btree (cnpj) WHERE (cnpj IS NOT NULL);
CREATE INDEX historico_conferencias_updated_at_idx ON public.historico_conferencias USING btree (updated_at);
CREATE INDEX historico_empresa_idx ON public.historico_conferencias USING btree (empresa_id);
CREATE INDEX idx_hist_created ON public.historico_conferencias USING btree (created_at DESC);
CREATE INDEX idx_hist_data ON public.historico_conferencias USING btree (data DESC);
CREATE INDEX idx_hist_divergencias ON public.historico_conferencias USING btree (divergencias);
CREATE INDEX idx_hist_duracao ON public.historico_conferencias USING btree (duracao_segundos);
CREATE INDEX idx_hist_lista ON public.historico_conferencias USING btree (lista);
CREATE INDEX idx_hist_modulo ON public.historico_conferencias USING btree (modulo);
CREATE INDEX idx_hist_perfil ON public.historico_conferencias USING btree (perfil);
CREATE INDEX idx_hist_setor ON public.historico_conferencias USING btree (setor);
CREATE INDEX idx_hist_status ON public.historico_conferencias USING btree (status);
CREATE INDEX idx_hist_user ON public.historico_conferencias USING btree (user_id);
CREATE INDEX materiais_codigo_trgm ON public.materiais USING gin (codigo gin_trgm_ops);
CREATE INDEX materiais_created_at_idx ON public.materiais USING btree (created_at);
CREATE INDEX materiais_descricao_trgm ON public.materiais USING gin (descricao gin_trgm_ops);
CREATE INDEX materiais_func_codigo_trgm ON public.materiais USING gin (funcionario_codigo gin_trgm_ops);
CREATE UNIQUE INDEX materiais_unico_codigo_locacao ON public.materiais USING btree (unidade_id, upper(codigo), COALESCE(upper(locacao), ''::text));
CREATE INDEX materiais_unidade_id_idx ON public.materiais USING btree (unidade_id);
CREATE INDEX material_imagens_created_at_idx ON public.material_imagens USING btree (created_at);
CREATE INDEX material_imagens_material_id_idx ON public.material_imagens USING btree (material_id);
CREATE INDEX idx_metas_escopo_alvo ON public.metas USING btree (escopo, alvo);
CREATE INDEX metas_empresa_idx ON public.metas USING btree (empresa_id);
CREATE INDEX idx_notif_email_enviado ON public.notificacao_emails USING btree (enviado_em DESC);
CREATE INDEX idx_notificacao_leituras_user ON public.notificacao_leituras USING btree (user_id, chave);
CREATE INDEX idx_notif_conf_created ON public.notificacoes_conferencia USING btree (created_at DESC);
CREATE INDEX idx_notif_conf_data ON public.notificacoes_conferencia USING btree (data);
CREATE INDEX idx_notif_conf_email_status ON public.notificacoes_conferencia USING btree (email_status);
CREATE INDEX idx_notif_conf_tipo ON public.notificacoes_conferencia USING btree (tipo, created_at DESC);
CREATE UNIQUE INDEX idx_notif_conf_unico_evento ON public.notificacoes_conferencia USING btree (conferencia_id, tipo) WHERE (tipo = ANY (ARRAY['conferencia_concluida'::text, 'conferencia_atrasada'::text]));
CREATE INDEX idx_notif_conf_user ON public.notificacoes_conferencia USING btree (user_id);
CREATE INDEX notificacoes_empresa_idx ON public.notificacoes_conferencia USING btree (empresa_id);
CREATE INDEX permissoes_usuario_user_idx ON public.permissoes_usuario USING btree (user_id);
CREATE INDEX planos_provider_plan_id_idx ON public.planos USING btree (provider_plan_id) WHERE (provider_plan_id IS NOT NULL);
CREATE INDEX sessoes_usuario_ativas_idx ON public.sessoes_usuario USING btree (ultimo_ping DESC) WHERE (encerrada_em IS NULL);
CREATE INDEX sessoes_usuario_user_idx ON public.sessoes_usuario USING btree (user_id, ultimo_ping DESC);
CREATE INDEX unidades_created_at_idx ON public.unidades USING btree (created_at);
CREATE INDEX unidades_empresa_idx ON public.unidades USING btree (empresa_id);
CREATE INDEX unidades_modulo_idx ON public.unidades USING btree (modulo_id);
CREATE UNIQUE INDEX user_profiles_um_proprietario ON public.user_profiles USING btree (perfil) WHERE (perfil = 'proprietario'::text);
CREATE INDEX user_profiles_updated_at_idx ON public.user_profiles USING btree (updated_at);
CREATE INDEX idx_wa_notif_empresa ON public.whatsapp_notificacoes USING btree (empresa_id, created_at DESC);
CREATE UNIQUE INDEX uq_wa_notif_idempotency ON public.whatsapp_notificacoes USING btree (idempotency_key);

ALTER TABLE public.conferencias REPLICA IDENTITY FULL;
ALTER TABLE public.conferencia_itens REPLICA IDENTITY FULL;


-- ============================================================================
-- Triggers
-- ============================================================================

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER assinaturas_updated_at BEFORE UPDATE ON public.assinaturas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER avisos_sistema_updated_at BEFORE UPDATE ON public.avisos_sistema FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER cadastros_mestres_updated_at BEFORE UPDATE ON public.cadastros_mestres FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_conferencias_tempo_pausa BEFORE UPDATE ON public.conferencias FOR EACH ROW EXECUTE FUNCTION conferencias_tempo_pausa();
CREATE TRIGGER trg_sync_historico_status AFTER UPDATE ON public.conferencias FOR EACH ROW EXECUTE FUNCTION sync_historico_status();
CREATE TRIGGER trg_configuracoes_updated BEFORE UPDATE ON public.configuracoes_sistema FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER empresa_modulos_limite_plano BEFORE INSERT OR UPDATE ON public.empresa_modulos FOR EACH ROW EXECUTE FUNCTION empresa_modulos_limite_plano();
CREATE TRIGGER empresa_modulos_updated_at BEFORE UPDATE ON public.empresa_modulos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER empresa_setores_updated_at BEFORE UPDATE ON public.empresa_setores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER empresa_usuarios_updated_at BEFORE UPDATE ON public.empresa_usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER empresa_whatsapp_destinatarios_updated_at BEFORE UPDATE ON public.empresa_whatsapp_destinatarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER whatsapp_destinatarios_limite BEFORE INSERT OR UPDATE ON public.empresa_whatsapp_destinatarios FOR EACH ROW EXECUTE FUNCTION whatsapp_destinatarios_limite();
CREATE TRIGGER empresas_updated_at BEFORE UPDATE ON public.empresas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER historico_conferencias_updated_at BEFORE UPDATE ON public.historico_conferencias FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER historico_escopo_empresa BEFORE INSERT ON public.historico_conferencias FOR EACH ROW EXECUTE FUNCTION preencher_escopo_empresa();
CREATE TRIGGER trg_historico_cascade_notificacoes AFTER DELETE ON public.historico_conferencias FOR EACH ROW EXECUTE FUNCTION historico_cascade_notificacoes();
CREATE TRIGGER trg_integracoes_updated BEFORE UPDATE ON public.integracoes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_materiais_normalizar BEFORE INSERT OR UPDATE ON public.materiais FOR EACH ROW EXECUTE FUNCTION materiais_normalizar();
CREATE TRIGGER metas_updated_at BEFORE UPDATE ON public.metas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER notificacoes_escopo_empresa BEFORE INSERT ON public.notificacoes_conferencia FOR EACH ROW EXECUTE FUNCTION preencher_escopo_empresa();
CREATE TRIGGER trg_notificacoes_conferencia_updated BEFORE UPDATE ON public.notificacoes_conferencia FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER permissoes_perfil_updated_at BEFORE UPDATE ON public.permissoes_perfil FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER permissoes_usuario_updated_at BEFORE UPDATE ON public.permissoes_usuario FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER planos_updated_at BEFORE UPDATE ON public.planos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_relatorios_agendados_updated BEFORE UPDATE ON public.relatorios_agendados FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER sessoes_usuario_updated_at BEFORE UPDATE ON public.sessoes_usuario FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER unidades_escopo_empresa BEFORE INSERT ON public.unidades FOR EACH ROW EXECUTE FUNCTION unidades_escopo_empresa();
CREATE TRIGGER trg_proteger_proprietario BEFORE INSERT OR DELETE OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION app_private.proteger_proprietario();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER whatsapp_notificacoes_updated_at BEFORE UPDATE ON public.whatsapp_notificacoes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE public.assinatura_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviso_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadastros_mestres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conferencia_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conferencia_pausas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_setores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresa_whatsapp_destinatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_conferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_imagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes_conferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissoes_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissoes_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relatorios_agendados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_legados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_eventos_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_notificacoes ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- Policies
-- ============================================================================

CREATE POLICY assinatura_pagamentos_select_membro_ou_admin ON public.assinatura_pagamentos AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) OR (empresa_id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas))));

CREATE POLICY assinaturas_select_membro_ou_admin ON public.assinaturas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_proprietario(auth.uid()) OR (empresa_id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas))));

CREATE POLICY auditoria_insert ON public.auditoria AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY auditoria_read ON public.auditoria AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR (app_private.perfil_atual() = 'administrador'::text)));

CREATE POLICY aviso_leituras_insert ON public.aviso_leituras AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY aviso_leituras_select ON public.aviso_leituras AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR app_private.eh_administrador(auth.uid())));

CREATE POLICY avisos_delete ON public.avisos_sistema AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

CREATE POLICY avisos_insert ON public.avisos_sistema AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY avisos_select ON public.avisos_sistema AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) OR (publicado AND (NOT arquivado) AND ((agendado_para IS NULL) OR (agendado_para <= now())) AND ((destino_perfil IS NULL) OR (destino_perfil = ''::text) OR (destino_perfil = app_private.perfil_atual())) AND ((destino_setor IS NULL) OR (destino_setor = ''::text) OR (destino_setor = app_private.setor_atual())))));

CREATE POLICY avisos_update ON public.avisos_sistema AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY cadastros_insert ON public.cadastros_mestres AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY cadastros_select ON public.cadastros_mestres AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) OR (ativo AND (NOT excluido))));

CREATE POLICY cadastros_update ON public.cadastros_mestres AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY conferencia_itens_delete ON public.conferencia_itens AS PERMISSIVE FOR DELETE TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_itens.conferencia_id) AND app_private.pode_unidade(c.unidade_id)))) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY conferencia_itens_insert ON public.conferencia_itens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_itens.conferencia_id) AND app_private.pode_unidade(c.unidade_id)))) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY conferencia_itens_select ON public.conferencia_itens AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_itens.conferencia_id) AND app_private.pode_unidade(c.unidade_id)))));

CREATE POLICY conferencia_itens_update ON public.conferencia_itens AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_itens.conferencia_id) AND app_private.pode_unidade(c.unidade_id)))) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_itens.conferencia_id) AND app_private.pode_unidade(c.unidade_id)))) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY "Pausas visiveis para admin ou dono da conferencia" ON public.conferencia_pausas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) OR (EXISTS ( SELECT 1
   FROM conferencias c
  WHERE ((c.id = conferencia_pausas.conferencia_id) AND (c.created_by = auth.uid()))))));

CREATE POLICY conferencias_delete ON public.conferencias AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY conferencias_insert ON public.conferencias AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((created_by = auth.uid()) AND app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY conferencias_select ON public.conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.pode_unidade(unidade_id));

CREATE POLICY conferencias_update ON public.conferencias AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))))
  WITH CHECK ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY configuracoes_delete ON public.configuracoes_sistema AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY configuracoes_insert ON public.configuracoes_sistema AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY configuracoes_select ON public.configuracoes_sistema AS PERMISSIVE FOR SELECT TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) OR (chave = 'geral'::text)));

CREATE POLICY configuracoes_update ON public.configuracoes_sistema AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text))
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY empresa_modulos_delete_admin ON public.empresa_modulos AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_modulos_insert_admin ON public.empresa_modulos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_modulos_select_membros ON public.empresa_modulos AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.pertence_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_modulos_update_admin ON public.empresa_modulos AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()))
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_setores_delete_admin ON public.empresa_setores AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_setores_insert_admin ON public.empresa_setores AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_setores_select_membros ON public.empresa_setores AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.pertence_empresa(empresa_id, auth.uid()) OR (app_private.eh_legado(auth.uid()) AND app_private.empresa_legada(empresa_id))));

CREATE POLICY empresa_setores_update_admin ON public.empresa_setores AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()))
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY empresa_usuarios_admin_delete ON public.empresa_usuarios AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_proprietario(auth.uid()));

CREATE POLICY empresa_usuarios_admin_insert ON public.empresa_usuarios AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

CREATE POLICY empresa_usuarios_admin_update ON public.empresa_usuarios AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_proprietario(auth.uid()))
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

CREATE POLICY empresa_usuarios_select ON public.empresa_usuarios AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_proprietario(auth.uid()) OR (user_id = auth.uid()) OR (empresa_id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas))));

CREATE POLICY wa_dest_delete_admin ON public.empresa_whatsapp_destinatarios AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.eh_global(auth.uid()) OR app_private.eh_admin_empresa(empresa_id, auth.uid())));

CREATE POLICY wa_dest_insert_admin ON public.empresa_whatsapp_destinatarios AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.eh_global(auth.uid()) OR app_private.eh_admin_empresa(empresa_id, auth.uid())));

CREATE POLICY wa_dest_select_empresa ON public.empresa_whatsapp_destinatarios AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_global(auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND (EXISTS ( SELECT 1
   FROM empresa_usuarios eu
  WHERE ((eu.user_id = auth.uid()) AND (eu.ativo = true) AND (eu.empresa_id = empresa_whatsapp_destinatarios.empresa_id)))))));

CREATE POLICY wa_dest_update_admin ON public.empresa_whatsapp_destinatarios AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.eh_global(auth.uid()) OR app_private.eh_admin_empresa(empresa_id, auth.uid())))
  WITH CHECK ((app_private.eh_global(auth.uid()) OR app_private.eh_admin_empresa(empresa_id, auth.uid())));

CREATE POLICY empresas_insert_admin ON public.empresas AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

CREATE POLICY empresas_select_membro_ou_admin ON public.empresas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_proprietario(auth.uid()) OR (id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas))));

CREATE POLICY empresas_update_admin ON public.empresas AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.eh_proprietario(auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND (id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas)))))
  WITH CHECK ((app_private.eh_proprietario(auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND (id IN ( SELECT app_private.minhas_empresas() AS minhas_empresas)))));

CREATE POLICY historico_insert_own ON public.historico_conferencias AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY historico_select_admin ON public.historico_conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY historico_select_gestor ON public.historico_conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_gestor(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY historico_select_own ON public.historico_conferencias AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY historico_update_own ON public.historico_conferencias AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY integracoes_delete ON public.integracoes AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY integracoes_insert ON public.integracoes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY integracoes_select ON public.integracoes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY integracoes_update ON public.integracoes AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text))
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY materiais_delete ON public.materiais AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY materiais_insert ON public.materiais AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY materiais_select ON public.materiais AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.pode_unidade(unidade_id));

CREATE POLICY materiais_update ON public.materiais AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))))
  WITH CHECK ((app_private.pode_unidade(unidade_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY material_imagens_delete ON public.material_imagens AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role]))))));

CREATE POLICY material_imagens_insert ON public.material_imagens AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role]))))));

CREATE POLICY material_imagens_select ON public.material_imagens AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM materiais m
  WHERE ((m.id = material_imagens.material_id) AND app_private.pode_unidade(m.unidade_id)))));

CREATE POLICY material_imagens_update ON public.material_imagens AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role]))))));

CREATE POLICY metas_delete_admin ON public.metas AS PERMISSIVE FOR DELETE TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY metas_insert_admin ON public.metas AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY metas_select_admin ON public.metas AS PERMISSIVE FOR SELECT TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY metas_select_gestor ON public.metas AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_gestor(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY metas_update_admin ON public.metas AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))))
  WITH CHECK (((app_private.perfil_atual() = 'administrador'::text) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY "Admins veem historico de envios" ON public.notificacao_emails AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

CREATE POLICY notificacao_leituras_delete ON public.notificacao_leituras AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY notificacao_leituras_insert ON public.notificacao_leituras AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY notificacao_leituras_select ON public.notificacao_leituras AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));

CREATE POLICY "Admins atualizam status da notificacao" ON public.notificacoes_conferencia AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid())))))
  WITH CHECK (((user_id = auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid())))));

CREATE POLICY "Admins excluem notificacoes de conferencia" ON public.notificacoes_conferencia AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY "Admins veem todas as notificacoes de conferencia" ON public.notificacoes_conferencia AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid())))));

CREATE POLICY "Usuario registra o proprio inicio de conferencia" ON public.notificacoes_conferencia AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY notificacoes_select_gestor ON public.notificacoes_conferencia AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_gestor(auth.uid()) AND ((empresa_id IS NULL) OR app_private.pertence_empresa(empresa_id, auth.uid()))));

CREATE POLICY perm_perfil_delete ON public.permissoes_perfil AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

CREATE POLICY perm_perfil_insert ON public.permissoes_perfil AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY perm_perfil_select ON public.permissoes_perfil AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_administrador(auth.uid()) OR (perfil = app_private.perfil_atual())));

CREATE POLICY perm_perfil_update ON public.permissoes_perfil AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY perm_usuario_delete ON public.permissoes_usuario AS PERMISSIVE FOR DELETE TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

CREATE POLICY perm_usuario_insert ON public.permissoes_usuario AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY perm_usuario_select ON public.permissoes_usuario AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR app_private.eh_administrador(auth.uid())));

CREATE POLICY perm_usuario_update ON public.permissoes_usuario AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY planos_insert_admin ON public.planos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY planos_select_autenticado ON public.planos AS PERMISSIVE FOR SELECT TO authenticated
  USING (((ativo = true) OR app_private.eh_administrador(auth.uid())));

CREATE POLICY planos_update_admin ON public.planos AS PERMISSIVE FOR UPDATE TO authenticated
  USING (app_private.eh_administrador(auth.uid()))
  WITH CHECK (app_private.eh_administrador(auth.uid()));

CREATE POLICY profiles_insert ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = id));

CREATE POLICY profiles_read ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = id));

CREATE POLICY profiles_write ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = id));

CREATE POLICY relatorios_agendados_delete ON public.relatorios_agendados AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY relatorios_agendados_insert ON public.relatorios_agendados AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY relatorios_agendados_select ON public.relatorios_agendados AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY relatorios_agendados_update ON public.relatorios_agendados AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.perfil_atual() = 'administrador'::text))
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY sessoes_insert ON public.sessoes_usuario AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY sessoes_select ON public.sessoes_usuario AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR app_private.eh_administrador(auth.uid())));

CREATE POLICY sessoes_update ON public.sessoes_usuario AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((user_id = auth.uid()) OR app_private.eh_administrador(auth.uid())))
  WITH CHECK (((user_id = auth.uid()) OR app_private.eh_administrador(auth.uid())));

CREATE POLICY unidades_delete ON public.unidades AS PERMISSIVE FOR DELETE TO authenticated
  USING ((app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY unidades_insert ON public.unidades AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY unidades_select ON public.unidades AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.acesso_unidade(tipo, empresa_id, modulo_id));

CREATE POLICY unidades_update ON public.unidades AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))))
  WITH CHECK ((app_private.acesso_unidade(tipo, empresa_id, modulo_id) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['admin'::app_role, 'conferente'::app_role])))))));

CREATE POLICY user_profiles_delete_admin ON public.user_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND app_private.mesma_empresa_ou_legado(user_id)));

CREATE POLICY user_profiles_insert_admin ON public.user_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((app_private.perfil_atual() = 'administrador'::text));

CREATE POLICY user_profiles_insert_own ON public.user_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (perfil = ANY (ARRAY['agricola'::text, 'industria'::text])) AND (bloqueado = false) AND (NOT (EXISTS ( SELECT 1
   FROM user_profiles p
  WHERE (p.user_id = auth.uid()))))));

CREATE POLICY user_profiles_select_own ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR ((app_private.perfil_atual() = 'administrador'::text) AND app_private.mesma_empresa_ou_legado(user_id))));

CREATE POLICY user_profiles_update_admin ON public.user_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((app_private.perfil_atual() = 'administrador'::text) AND app_private.mesma_empresa_ou_legado(user_id)))
  WITH CHECK (((app_private.perfil_atual() = 'administrador'::text) AND app_private.mesma_empresa_ou_legado(user_id)));

CREATE POLICY roles_read ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "Usuário vê seu próprio registro legado" ON public.usuarios_legados AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY webhook_eventos_select_admin ON public.webhook_eventos_pagamento AS PERMISSIVE FOR SELECT TO authenticated
  USING (app_private.eh_administrador(auth.uid()));

CREATE POLICY wa_notif_select_admin_empresa ON public.whatsapp_notificacoes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((app_private.eh_global(auth.uid()) OR (app_private.eh_administrador(auth.uid()) AND (EXISTS ( SELECT 1
   FROM empresa_usuarios eu
  WHERE ((eu.user_id = auth.uid()) AND (eu.ativo = true) AND (eu.empresa_id = whatsapp_notificacoes.empresa_id)))))));


-- ============================================================================
-- Privilégios de schema, tabelas e funções
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

REVOKE ALL ON TABLE app_private.hook_secrets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE app_private.hook_secrets TO service_role;
REVOKE ALL ON TABLE public.assinatura_pagamentos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.assinatura_pagamentos TO anon;
GRANT ALL ON TABLE public.assinatura_pagamentos TO authenticated;
GRANT ALL ON TABLE public.assinatura_pagamentos TO service_role;
REVOKE ALL ON TABLE public.assinaturas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.assinaturas TO anon;
GRANT ALL ON TABLE public.assinaturas TO authenticated;
GRANT ALL ON TABLE public.assinaturas TO service_role;
REVOKE ALL ON TABLE public.auditoria FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.auditoria TO anon;
GRANT ALL ON TABLE public.auditoria TO authenticated;
GRANT ALL ON TABLE public.auditoria TO service_role;
REVOKE ALL ON TABLE public.aviso_leituras FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.aviso_leituras TO anon;
GRANT ALL ON TABLE public.aviso_leituras TO authenticated;
GRANT ALL ON TABLE public.aviso_leituras TO service_role;
REVOKE ALL ON TABLE public.avisos_sistema FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.avisos_sistema TO anon;
GRANT ALL ON TABLE public.avisos_sistema TO authenticated;
GRANT ALL ON TABLE public.avisos_sistema TO service_role;
REVOKE ALL ON TABLE public.cadastros_mestres FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.cadastros_mestres TO anon;
GRANT ALL ON TABLE public.cadastros_mestres TO authenticated;
GRANT ALL ON TABLE public.cadastros_mestres TO service_role;
REVOKE ALL ON TABLE public.conferencia_itens FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.conferencia_itens TO anon;
GRANT ALL ON TABLE public.conferencia_itens TO authenticated;
GRANT ALL ON TABLE public.conferencia_itens TO service_role;
REVOKE ALL ON TABLE public.conferencia_pausas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.conferencia_pausas TO anon;
GRANT ALL ON TABLE public.conferencia_pausas TO authenticated;
GRANT ALL ON TABLE public.conferencia_pausas TO service_role;
REVOKE ALL ON TABLE public.conferencias FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.conferencias TO anon;
GRANT ALL ON TABLE public.conferencias TO authenticated;
GRANT ALL ON TABLE public.conferencias TO service_role;
REVOKE ALL ON TABLE public.configuracoes_sistema FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.configuracoes_sistema TO anon;
GRANT ALL ON TABLE public.configuracoes_sistema TO authenticated;
GRANT ALL ON TABLE public.configuracoes_sistema TO service_role;
REVOKE ALL ON TABLE public.empresa_modulos FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.empresa_modulos TO anon;
GRANT ALL ON TABLE public.empresa_modulos TO authenticated;
GRANT ALL ON TABLE public.empresa_modulos TO service_role;
REVOKE ALL ON TABLE public.empresa_setores FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.empresa_setores TO anon;
GRANT ALL ON TABLE public.empresa_setores TO authenticated;
GRANT ALL ON TABLE public.empresa_setores TO service_role;
REVOKE ALL ON TABLE public.empresa_usuarios FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.empresa_usuarios TO anon;
GRANT ALL ON TABLE public.empresa_usuarios TO authenticated;
GRANT ALL ON TABLE public.empresa_usuarios TO service_role;
REVOKE ALL ON TABLE public.empresa_whatsapp_destinatarios FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.empresa_whatsapp_destinatarios TO anon;
GRANT ALL ON TABLE public.empresa_whatsapp_destinatarios TO authenticated;
GRANT ALL ON TABLE public.empresa_whatsapp_destinatarios TO service_role;
REVOKE ALL ON TABLE public.empresas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.empresas TO anon;
GRANT ALL ON TABLE public.empresas TO authenticated;
GRANT ALL ON TABLE public.empresas TO service_role;
REVOKE ALL ON TABLE public.historico_conferencias FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.historico_conferencias TO anon;
GRANT ALL ON TABLE public.historico_conferencias TO authenticated;
GRANT ALL ON TABLE public.historico_conferencias TO service_role;
REVOKE ALL ON TABLE public.integracoes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.integracoes TO anon;
GRANT ALL ON TABLE public.integracoes TO authenticated;
GRANT ALL ON TABLE public.integracoes TO service_role;
REVOKE ALL ON TABLE public.materiais FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.materiais TO anon;
GRANT ALL ON TABLE public.materiais TO authenticated;
GRANT ALL ON TABLE public.materiais TO service_role;
REVOKE ALL ON TABLE public.material_imagens FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.material_imagens TO anon;
GRANT ALL ON TABLE public.material_imagens TO authenticated;
GRANT ALL ON TABLE public.material_imagens TO service_role;
REVOKE ALL ON TABLE public.metas FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.metas TO anon;
GRANT ALL ON TABLE public.metas TO authenticated;
GRANT ALL ON TABLE public.metas TO service_role;
REVOKE ALL ON TABLE public.notificacao_emails FROM PUBLIC, anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.notificacao_emails TO anon;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 170000 THEN EXECUTE 'GRANT MAINTAIN ON TABLE public.notificacao_emails TO anon'; END IF; END $$;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.notificacao_emails TO authenticated;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 170000 THEN EXECUTE 'GRANT MAINTAIN ON TABLE public.notificacao_emails TO authenticated'; END IF; END $$;
GRANT ALL ON TABLE public.notificacao_emails TO service_role;
REVOKE ALL ON TABLE public.notificacao_leituras FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.notificacao_leituras TO anon;
GRANT ALL ON TABLE public.notificacao_leituras TO authenticated;
GRANT ALL ON TABLE public.notificacao_leituras TO service_role;
REVOKE ALL ON TABLE public.notificacoes_conferencia FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.notificacoes_conferencia TO anon;
GRANT ALL ON TABLE public.notificacoes_conferencia TO authenticated;
GRANT ALL ON TABLE public.notificacoes_conferencia TO service_role;
REVOKE ALL ON TABLE public.permissoes_perfil FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.permissoes_perfil TO anon;
GRANT ALL ON TABLE public.permissoes_perfil TO authenticated;
GRANT ALL ON TABLE public.permissoes_perfil TO service_role;
REVOKE ALL ON TABLE public.permissoes_usuario FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.permissoes_usuario TO anon;
GRANT ALL ON TABLE public.permissoes_usuario TO authenticated;
GRANT ALL ON TABLE public.permissoes_usuario TO service_role;
REVOKE ALL ON TABLE public.planos FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE public.planos TO anon;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 170000 THEN EXECUTE 'GRANT MAINTAIN ON TABLE public.planos TO anon'; END IF; END $$;
GRANT ALL ON TABLE public.planos TO authenticated;
GRANT ALL ON TABLE public.planos TO service_role;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
REVOKE ALL ON TABLE public.relatorios_agendados FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.relatorios_agendados TO anon;
GRANT ALL ON TABLE public.relatorios_agendados TO authenticated;
GRANT ALL ON TABLE public.relatorios_agendados TO service_role;
REVOKE ALL ON TABLE public.sessoes_usuario FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.sessoes_usuario TO anon;
GRANT ALL ON TABLE public.sessoes_usuario TO authenticated;
GRANT ALL ON TABLE public.sessoes_usuario TO service_role;
REVOKE ALL ON TABLE public.unidades FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.unidades TO anon;
GRANT ALL ON TABLE public.unidades TO authenticated;
GRANT ALL ON TABLE public.unidades TO service_role;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_profiles TO anon;
GRANT ALL ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated, service_role;
GRANT REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE public.user_roles TO authenticated;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 170000 THEN EXECUTE 'GRANT MAINTAIN ON TABLE public.user_roles TO authenticated'; END IF; END $$;
GRANT ALL ON TABLE public.user_roles TO service_role;
REVOKE ALL ON TABLE public.usuarios_legados FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.usuarios_legados TO anon;
GRANT ALL ON TABLE public.usuarios_legados TO authenticated;
GRANT ALL ON TABLE public.usuarios_legados TO service_role;
REVOKE ALL ON TABLE public.webhook_eventos_pagamento FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.webhook_eventos_pagamento TO anon;
GRANT ALL ON TABLE public.webhook_eventos_pagamento TO authenticated;
GRANT ALL ON TABLE public.webhook_eventos_pagamento TO service_role;
REVOKE ALL ON TABLE public.whatsapp_notificacoes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.whatsapp_notificacoes TO anon;
GRANT ALL ON TABLE public.whatsapp_notificacoes TO authenticated;
GRANT ALL ON TABLE public.whatsapp_notificacoes TO service_role;

REVOKE ALL ON FUNCTION app_private.acesso_unidade(text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.acesso_unidade(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.acesso_unidade(text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.eh_admin_empresa(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_admin_empresa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.eh_admin_empresa(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.eh_administrador(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_administrador(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.eh_administrador(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.eh_gestor(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_gestor(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.eh_global(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_global(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.eh_global(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.eh_legado(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_legado(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.eh_master() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_master() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.eh_master() TO service_role;
REVOKE ALL ON FUNCTION app_private.eh_proprietario(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.eh_proprietario(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.empresa_legada(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.empresa_legada(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_role(uuid, app_role) TO service_role;
REVOKE ALL ON FUNCTION app_private.limite_modulos_empresa(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.mesma_empresa(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.mesma_empresa_ou_legado(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa_ou_legado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.mesma_empresa_ou_legado(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.minhas_empresas() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.minhas_empresas() TO authenticated;
REVOKE ALL ON FUNCTION app_private.nivel(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nivel(uuid) TO authenticated;
REVOKE ALL ON FUNCTION app_private.nivel_atual() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nivel_atual() TO authenticated;
REVOKE ALL ON FUNCTION app_private.nivel_perfil(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nivel_perfil(text) TO authenticated;
REVOKE ALL ON FUNCTION app_private.perfil_atual() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.perfil_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.perfil_atual() TO service_role;
REVOKE ALL ON FUNCTION app_private.pertence_empresa(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.pertence_empresa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.pertence_empresa(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.pode_tipo(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.pode_tipo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.pode_tipo(text) TO service_role;
REVOKE ALL ON FUNCTION app_private.pode_unidade(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.pode_unidade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.pode_unidade(uuid) TO service_role;
REVOKE ALL ON FUNCTION app_private.setor_atual() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.setor_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.setor_atual() TO service_role;
REVOKE ALL ON FUNCTION app_private.validar_hook(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.validar_hook(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.assinatura_ativa_empresa(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assinatura_ativa_empresa(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.conferencias_tempo_pausa() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conferencias_tempo_pausa() TO service_role;
REVOKE ALL ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_empresa_onboarding(text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.criar_setores_iniciais(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_setores_iniciais(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_setores_iniciais(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.diagnostico_permissoes(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.diagnostico_permissoes(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.eh_usuario_legado(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.eh_usuario_legado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eh_usuario_legado(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.empresa_do_usuario(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_do_usuario(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.empresa_modulos_limite_plano() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresa_modulos_limite_plano() TO service_role;
REVOKE ALL ON FUNCTION public.empresas_do_usuario(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.empresas_do_usuario(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.historico_cascade_notificacoes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.historico_cascade_notificacoes() TO service_role;
REVOKE ALL ON FUNCTION public.importar_dados_legados(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.importar_dados_legados(text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.materiais_normalizar() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materiais_normalizar() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.materiais_normalizar() TO anon;
GRANT EXECUTE ON FUNCTION public.materiais_normalizar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.materiais_normalizar() TO service_role;
REVOKE ALL ON FUNCTION public.modulos_ativos_empresa(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.modulos_ativos_empresa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.modulos_ativos_empresa(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.plano_da_empresa(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.preencher_escopo_empresa() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preencher_escopo_empresa() TO service_role;
REVOKE ALL ON FUNCTION public.sync_historico_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_historico_status() TO service_role;
REVOKE ALL ON FUNCTION public.unidades_escopo_empresa() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unidades_escopo_empresa() TO service_role;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
REVOKE ALL ON FUNCTION public.usuarios_ativos_empresa(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.usuarios_ativos_empresa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.usuarios_ativos_empresa(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.validar_hook(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validar_hook(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.whatsapp_destinatarios_limite() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_destinatarios_limite() TO service_role;


-- ============================================================================
-- Realtime
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conferencias') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conferencias;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conferencia_itens') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conferencia_itens;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'historico_conferencias') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.historico_conferencias;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notificacoes_conferencia') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes_conferencia;
  END IF;
END $$;


-- ============================================================================
-- Agendamento do monitor de conferências (somente onde pg_cron/pg_net existem)
-- ============================================================================

INSERT INTO app_private.hook_secrets (nome, valor)
VALUES ('monitor_conferencias', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (nome) DO NOTHING;
DO $$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;
  SELECT valor INTO v FROM app_private.hook_secrets WHERE nome = 'monitor_conferencias';
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'monitor-conferencias';
  PERFORM cron.schedule('monitor-conferencias', '*/5 * * * *', format($f$
  select net.http_post(
    url:='https://conferenciarapida.com.br/api/public/hooks/monitor-conferencias',
    headers:='{"Content-Type": "application/json", "x-hook-secret": "%s"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$f$, v));
END $$;
