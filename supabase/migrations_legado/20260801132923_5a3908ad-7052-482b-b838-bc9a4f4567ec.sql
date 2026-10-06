-- Função auxiliar: administrador atual
CREATE OR REPLACE FUNCTION public.eh_administrador(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = _user_id AND perfil = 'administrador' AND bloqueado = false
  )
$$;
REVOKE ALL ON FUNCTION public.eh_administrador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_administrador(uuid) TO authenticated, service_role;

-- 1. CADASTROS MESTRES ------------------------------------------------------
CREATE TABLE public.cadastros_mestres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('setor','perfil','modulo','categoria','tipo_conferencia')),
  codigo text NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  excluido boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cadastros_mestres_tipo_codigo_idx
  ON public.cadastros_mestres (tipo, lower(codigo)) WHERE excluido = false;
CREATE INDEX cadastros_mestres_tipo_idx ON public.cadastros_mestres (tipo, ordem, nome);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cadastros_mestres TO authenticated;
GRANT ALL ON public.cadastros_mestres TO service_role;
ALTER TABLE public.cadastros_mestres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cadastros_select" ON public.cadastros_mestres FOR SELECT TO authenticated USING (true);
CREATE POLICY "cadastros_insert" ON public.cadastros_mestres FOR INSERT TO authenticated
  WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "cadastros_update" ON public.cadastros_mestres FOR UPDATE TO authenticated
  USING (public.eh_administrador(auth.uid())) WITH CHECK (public.eh_administrador(auth.uid()));

CREATE TRIGGER cadastros_mestres_updated_at BEFORE UPDATE ON public.cadastros_mestres
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. PERMISSÕES -------------------------------------------------------------
CREATE TABLE public.permissoes_perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil text NOT NULL,
  modulo text NOT NULL,
  acoes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (perfil, modulo)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissoes_perfil TO authenticated;
GRANT ALL ON public.permissoes_perfil TO service_role;
ALTER TABLE public.permissoes_perfil ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perm_perfil_select" ON public.permissoes_perfil FOR SELECT TO authenticated USING (true);
CREATE POLICY "perm_perfil_insert" ON public.permissoes_perfil FOR INSERT TO authenticated
  WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "perm_perfil_update" ON public.permissoes_perfil FOR UPDATE TO authenticated
  USING (public.eh_administrador(auth.uid())) WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "perm_perfil_delete" ON public.permissoes_perfil FOR DELETE TO authenticated
  USING (public.eh_administrador(auth.uid()));
CREATE TRIGGER permissoes_perfil_updated_at BEFORE UPDATE ON public.permissoes_perfil
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.permissoes_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  modulo text NOT NULL,
  acoes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (user_id, modulo)
);
CREATE INDEX permissoes_usuario_user_idx ON public.permissoes_usuario (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissoes_usuario TO authenticated;
GRANT ALL ON public.permissoes_usuario TO service_role;
ALTER TABLE public.permissoes_usuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perm_usuario_select" ON public.permissoes_usuario FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.eh_administrador(auth.uid()));
CREATE POLICY "perm_usuario_insert" ON public.permissoes_usuario FOR INSERT TO authenticated
  WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "perm_usuario_update" ON public.permissoes_usuario FOR UPDATE TO authenticated
  USING (public.eh_administrador(auth.uid())) WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "perm_usuario_delete" ON public.permissoes_usuario FOR DELETE TO authenticated
  USING (public.eh_administrador(auth.uid()));
CREATE TRIGGER permissoes_usuario_updated_at BEFORE UPDATE ON public.permissoes_usuario
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. AVISOS DO SISTEMA ------------------------------------------------------
CREATE TABLE public.avisos_sistema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  mensagem text NOT NULL,
  categoria text NOT NULL DEFAULT 'aviso' CHECK (categoria IN ('aviso','atualizacao','alerta','notificacao')),
  prioridade text NOT NULL DEFAULT 'info' CHECK (prioridade IN ('info','aviso','atencao','critica')),
  destino_perfil text,
  destino_setor text,
  agendado_para timestamptz,
  publicado boolean NOT NULL DEFAULT true,
  exige_confirmacao boolean NOT NULL DEFAULT false,
  arquivado boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avisos_sistema_publicado_idx ON public.avisos_sistema (publicado, agendado_para DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avisos_sistema TO authenticated;
GRANT ALL ON public.avisos_sistema TO service_role;
ALTER TABLE public.avisos_sistema ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avisos_select" ON public.avisos_sistema FOR SELECT TO authenticated USING (true);
CREATE POLICY "avisos_insert" ON public.avisos_sistema FOR INSERT TO authenticated
  WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "avisos_update" ON public.avisos_sistema FOR UPDATE TO authenticated
  USING (public.eh_administrador(auth.uid())) WITH CHECK (public.eh_administrador(auth.uid()));
CREATE POLICY "avisos_delete" ON public.avisos_sistema FOR DELETE TO authenticated
  USING (public.eh_administrador(auth.uid()));
CREATE TRIGGER avisos_sistema_updated_at BEFORE UPDATE ON public.avisos_sistema
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.aviso_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aviso_id uuid NOT NULL REFERENCES public.avisos_sistema(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  confirmado boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aviso_id, user_id)
);
CREATE INDEX aviso_leituras_user_idx ON public.aviso_leituras (user_id);
GRANT SELECT, INSERT ON public.aviso_leituras TO authenticated;
GRANT ALL ON public.aviso_leituras TO service_role;
ALTER TABLE public.aviso_leituras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aviso_leituras_select" ON public.aviso_leituras FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.eh_administrador(auth.uid()));
CREATE POLICY "aviso_leituras_insert" ON public.aviso_leituras FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 4. SESSÕES E ACESSOS ------------------------------------------------------
CREATE TABLE public.sessoes_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dispositivo text,
  navegador text,
  ip text,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_ping timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz,
  encerrada_por uuid,
  motivo_encerramento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessoes_usuario_user_idx ON public.sessoes_usuario (user_id, ultimo_ping DESC);
CREATE INDEX sessoes_usuario_ativas_idx ON public.sessoes_usuario (ultimo_ping DESC) WHERE encerrada_em IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.sessoes_usuario TO authenticated;
GRANT ALL ON public.sessoes_usuario TO service_role;
ALTER TABLE public.sessoes_usuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessoes_select" ON public.sessoes_usuario FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.eh_administrador(auth.uid()));
CREATE POLICY "sessoes_insert" ON public.sessoes_usuario FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessoes_update" ON public.sessoes_usuario FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.eh_administrador(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.eh_administrador(auth.uid()));
CREATE TRIGGER sessoes_usuario_updated_at BEFORE UPDATE ON public.sessoes_usuario
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. USUÁRIOS E AUDITORIA ---------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS assinatura text,
  ADD COLUMN IF NOT EXISTS ultimo_acesso timestamptz;

ALTER TABLE public.auditoria
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS dispositivo text;

CREATE INDEX IF NOT EXISTS auditoria_tipo_acao_idx ON public.auditoria (tipo_acao, created_at DESC);

-- 6. SEED DOS CADASTROS MESTRES --------------------------------------------
INSERT INTO public.cadastros_mestres (tipo, codigo, nome, descricao, ordem) VALUES
  ('setor','agricola','Agrícola','Setor agrícola',1),
  ('setor','industria','Indústria','Setor industrial',2),
  ('perfil','administrador','Administrador','Acesso total ao sistema',1),
  ('perfil','agricola','Agrícola','Acesso aos módulos agrícolas',2),
  ('perfil','industria','Indústria','Acesso aos módulos industriais',3),
  ('modulo','FROTA','Frota de Caminhões','Conferência dos materiais de cada caminhão',1),
  ('modulo','FERRAMENTAS_AGRICOLA','Ferramentas Agrícola','Caixas de ferramentas do setor agrícola',2),
  ('modulo','ESTOQUE_AGRICOLA','Estoque Agrícola','Listas de prateleiras do setor agrícola',3),
  ('modulo','FERRAMENTAS_INDUSTRIA','Ferramentas Indústria','Caixas de ferramentas do setor industrial',4),
  ('modulo','ESTOQUE_INDUSTRIA','Estoque Indústria','Listas de prateleiras do setor industrial',5),
  ('modulo','ADMIN','Central Administrativa','Gestão, inteligência e controle',6),
  ('categoria','ferramentas','Ferramentas','Materiais de ferramentaria',1),
  ('categoria','pecas','Peças','Peças de reposição',2),
  ('categoria','insumos','Insumos','Insumos e consumíveis',3),
  ('tipo_conferencia','caminhao','Caminhão','Conferência de caminhão',1),
  ('tipo_conferencia','caixa','Caixa de ferramentas','Conferência de caixa de ferramentas',2),
  ('tipo_conferencia','prateleira','Prateleira','Conferência de lista de prateleira',3);

INSERT INTO public.permissoes_perfil (perfil, modulo, acoes) VALUES
  ('administrador','FROTA','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('administrador','FERRAMENTAS_AGRICOLA','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('administrador','ESTOQUE_AGRICOLA','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('administrador','FERRAMENTAS_INDUSTRIA','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('administrador','ESTOQUE_INDUSTRIA','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('administrador','ADMIN','{visualizar,criar,editar,excluir,exportar,importar,administrar,auditar}'),
  ('agricola','FROTA','{visualizar,criar,editar,exportar,importar}'),
  ('agricola','FERRAMENTAS_AGRICOLA','{visualizar,criar,editar,exportar,importar}'),
  ('agricola','ESTOQUE_AGRICOLA','{visualizar,criar,editar,exportar,importar}'),
  ('industria','FERRAMENTAS_INDUSTRIA','{visualizar,criar,editar,exportar,importar}'),
  ('industria','ESTOQUE_INDUSTRIA','{visualizar,criar,editar,exportar,importar}');
