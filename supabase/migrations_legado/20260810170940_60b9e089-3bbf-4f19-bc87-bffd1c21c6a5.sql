CREATE TABLE public.usuarios_legados (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  motivo text NOT NULL DEFAULT 'Usuário existente antes do onboarding SaaS',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.usuarios_legados TO authenticated;
GRANT ALL ON public.usuarios_legados TO service_role;

ALTER TABLE public.usuarios_legados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário vê seu próprio registro legado"
ON public.usuarios_legados FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Só registra usuários que existem neste banco (em um banco novo, entram após a importação).
INSERT INTO public.usuarios_legados (user_id, email)
SELECT v.user_id::uuid, v.email FROM (VALUES
  ('8aa560be-c290-476c-af5a-eab79d049672', 'lucassamuel2003@hotmail.com'),
  ('522c0dc7-8ff9-42aa-8282-f6e901f8831a', 'lucasaranttess@gmail.com'),
  ('10602714-df00-46a8-ae90-d35a7df5f59a', 'arakakigrupo@gmail.com'),
  ('776291d7-a21a-4826-aa16-a7f923578a3f', 'aprendiz.almoxarifado@alcoeste.com'),
  ('4967b42e-1546-4e53-aae5-a74f0e5f7e2e', 'estoque.industria26@gmail.com')
) AS v(user_id, email)
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.user_id::uuid)
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.eh_usuario_legado(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT exists (SELECT 1 FROM public.usuarios_legados WHERE user_id = _user_id)
$$;

REVOKE ALL ON FUNCTION public.eh_usuario_legado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_usuario_legado(uuid) TO authenticated, service_role;