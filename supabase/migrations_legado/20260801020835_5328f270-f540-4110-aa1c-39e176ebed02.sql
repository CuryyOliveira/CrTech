-- 1) Perfis de acesso
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text,
  perfil text NOT NULL DEFAULT 'agricola' CHECK (perfil IN ('administrador','agricola','industria')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.perfil_atual()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT perfil FROM public.user_profiles WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.perfil_atual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perfil_atual() TO authenticated, service_role;

CREATE POLICY user_profiles_select_own ON public.user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.perfil_atual() = 'administrador');
CREATE POLICY user_profiles_insert_admin ON public.user_profiles
  FOR INSERT TO authenticated WITH CHECK (public.perfil_atual() = 'administrador');
CREATE POLICY user_profiles_update_admin ON public.user_profiles
  FOR UPDATE TO authenticated USING (public.perfil_atual() = 'administrador')
  WITH CHECK (public.perfil_atual() = 'administrador');
CREATE POLICY user_profiles_delete_admin ON public.user_profiles
  FOR DELETE TO authenticated USING (public.perfil_atual() = 'administrador');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Criação automática do perfil no cadastro
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'conferente') on conflict do nothing;
  insert into public.user_profiles (user_id, nome, perfil)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), 'agricola')
  on conflict (user_id) do nothing;
  return new;
end; $$;

-- usuários já existentes viram administradores
INSERT INTO public.user_profiles (user_id, nome, perfil)
SELECT u.id, coalesce(u.raw_user_meta_data->>'nome', split_part(u.email,'@',1)), 'administrador'
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- 3) Isolamento de dados por módulo/perfil
CREATE OR REPLACE FUNCTION public.pode_tipo(_tipo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.perfil_atual()
    WHEN 'administrador' THEN true
    WHEN 'agricola' THEN _tipo IN ('caminhao','caixa','prateleira')
    WHEN 'industria' THEN _tipo IN ('caixa_industria','prateleira_industria')
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.pode_tipo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_tipo(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pode_unidade(_unidade_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = _unidade_id AND public.pode_tipo(u.tipo))
$$;
REVOKE ALL ON FUNCTION public.pode_unidade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_unidade(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS unidades_select ON public.unidades;
CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated USING (public.pode_tipo(tipo));

DROP POLICY IF EXISTS materiais_select ON public.materiais;
CREATE POLICY materiais_select ON public.materiais FOR SELECT TO authenticated USING (public.pode_unidade(unidade_id));

DROP POLICY IF EXISTS conferencias_select ON public.conferencias;
CREATE POLICY conferencias_select ON public.conferencias FOR SELECT TO authenticated USING (public.pode_unidade(unidade_id));

DROP POLICY IF EXISTS conferencia_itens_select ON public.conferencia_itens;
CREATE POLICY conferencia_itens_select ON public.conferencia_itens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conferencias c WHERE c.id = conferencia_id AND public.pode_unidade(c.unidade_id)));