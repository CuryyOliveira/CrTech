CREATE POLICY user_profiles_insert_own ON public.user_profiles
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND perfil IN ('agricola','industria'));