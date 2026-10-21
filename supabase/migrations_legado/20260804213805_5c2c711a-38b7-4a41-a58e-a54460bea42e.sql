-- 1) Perfis aceitos
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_perfil_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_perfil_check
  CHECK (perfil = ANY (ARRAY['proprietario','super_admin','administrador','gestor','agricola','industria','usuario']));

-- 2) Nível hierárquico
CREATE OR REPLACE FUNCTION app_private.nivel_perfil(_perfil text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _perfil
    WHEN 'proprietario' THEN 6
    WHEN 'super_admin' THEN 5
    WHEN 'administrador' THEN 4
    WHEN 'gestor' THEN 3
    WHEN 'agricola' THEN 2
    WHEN 'industria' THEN 2
    WHEN 'usuario' THEN 1
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION app_private.nivel(_user_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN bloqueado THEN 0 ELSE app_private.nivel_perfil(perfil) END
       FROM public.user_profiles WHERE user_id = _user_id LIMIT 1), 0)
$$;

CREATE OR REPLACE FUNCTION app_private.nivel_atual()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.nivel(auth.uid())
$$;

-- 3) Owner e super admin equivalem a administrador nas regras existentes
CREATE OR REPLACE FUNCTION app_private.perfil_atual()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN perfil IN ('proprietario','super_admin') THEN 'administrador'
           ELSE perfil
         END
    FROM public.user_profiles WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_private.eh_administrador(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.nivel(_user_id) >= 4
$$;

CREATE OR REPLACE FUNCTION app_private.eh_gestor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_private.nivel(_user_id) >= 3
$$;

CREATE OR REPLACE FUNCTION app_private.pode_tipo(_tipo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE app_private.perfil_atual()
    WHEN 'administrador' THEN true
    WHEN 'gestor' THEN true
    WHEN 'agricola' THEN _tipo IN ('caminhao','caixa','prateleira')
    WHEN 'industria' THEN _tipo IN ('caixa_industria','prateleira_industria')
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION app_private.nivel_perfil(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.nivel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.nivel_atual() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.eh_gestor(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Leitura para gestores
DROP POLICY IF EXISTS historico_select_gestor ON public.historico_conferencias;
CREATE POLICY historico_select_gestor ON public.historico_conferencias
  FOR SELECT TO authenticated USING (app_private.eh_gestor(auth.uid()));

DROP POLICY IF EXISTS metas_select_gestor ON public.metas;
CREATE POLICY metas_select_gestor ON public.metas
  FOR SELECT TO authenticated USING (app_private.eh_gestor(auth.uid()));

DROP POLICY IF EXISTS notificacoes_select_gestor ON public.notificacoes_conferencia;
CREATE POLICY notificacoes_select_gestor ON public.notificacoes_conferencia
  FOR SELECT TO authenticated USING (app_private.eh_gestor(auth.uid()));