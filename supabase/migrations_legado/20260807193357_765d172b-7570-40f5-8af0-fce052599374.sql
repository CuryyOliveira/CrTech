-- Lock down role assignment table: no client writes ever.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
REVOKE ALL ON public.user_roles FROM anon;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- Ensure single profile row per user (blocks self-insert of a second, escalated profile)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_profiles'::regclass
       AND conname = 'user_profiles_user_id_unique'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'user_profiles'
       AND indexname = 'user_profiles_user_id_key'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Restrict the self-insert path further: only for the caller, only non-privileged
-- perfis, and only when they do not already have a profile row.
DROP POLICY IF EXISTS user_profiles_insert_own ON public.user_profiles;
CREATE POLICY user_profiles_insert_own
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND perfil = ANY (ARRAY['agricola'::text, 'industria'::text])
    AND bloqueado = false
    AND NOT EXISTS (
      SELECT 1 FROM public.user_profiles p WHERE p.user_id = auth.uid()
    )
  );