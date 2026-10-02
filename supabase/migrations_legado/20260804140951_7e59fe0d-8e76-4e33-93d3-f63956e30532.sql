-- 1) Novo valor de perfil
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_perfil_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_perfil_check
  CHECK (perfil = ANY (ARRAY['proprietario'::text,'administrador'::text,'agricola'::text,'industria'::text]));

-- 2) Somente um Proprietário do Sistema
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_um_proprietario
  ON public.user_profiles ((perfil)) WHERE perfil = 'proprietario';

-- 3) O Proprietário herda as permissões de Administrador em todas as políticas existentes
CREATE OR REPLACE FUNCTION app_private.perfil_atual()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select case when perfil = 'proprietario' then 'administrador' else perfil end
  from public.user_profiles where user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION app_private.eh_administrador(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = _user_id AND perfil IN ('administrador','proprietario') AND bloqueado = false
  )
$$;

CREATE OR REPLACE FUNCTION app_private.eh_proprietario(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = _user_id AND perfil = 'proprietario'
  )
$$;

REVOKE ALL ON FUNCTION app_private.eh_proprietario(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Proteção do registro do Proprietário contra alterações vindas do aplicativo
CREATE OR REPLACE FUNCTION app_private.proteger_proprietario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_proteger_proprietario ON public.user_profiles;
CREATE TRIGGER trg_proteger_proprietario
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_proprietario();