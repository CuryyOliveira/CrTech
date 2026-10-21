ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS bloqueada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueada_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_bloqueio text,
  ADD COLUMN IF NOT EXISTS desativada_em timestamptz;

-- Proprietário Master do SaaS: identidade fixa, verificada no banco pelo e-mail
-- autenticado. Não é um perfil nem uma permissão atribuível.
CREATE OR REPLACE FUNCTION app_private.eh_master()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app_private, public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = auth.uid()
       AND lower(u.email) = 'lucassamuel2003@hotmail.com'
       AND u.deleted_at IS NULL
  )
$$;
REVOKE ALL ON FUNCTION app_private.eh_master() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.eh_master() TO authenticated, service_role;