ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS setor text,
  ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false;

UPDATE public.user_profiles
SET setor = CASE WHEN perfil = 'industria' THEN 'industria' ELSE 'agricola' END
WHERE setor IS NULL;

DROP POLICY IF EXISTS user_profiles_insert_own ON public.user_profiles;
CREATE POLICY user_profiles_insert_own ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND perfil = ANY (ARRAY['agricola'::text, 'industria'::text])
    AND bloqueado = false
  );