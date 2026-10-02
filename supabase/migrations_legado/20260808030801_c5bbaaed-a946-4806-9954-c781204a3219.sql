ALTER TABLE public.assinaturas ADD COLUMN IF NOT EXISTS ultimo_evento_em timestamptz;

REVOKE SELECT ON public.planos FROM anon;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='planos' AND cmd='SELECT'
  LOOP EXECUTE format('DROP POLICY %I ON public.planos', p.policyname); END LOOP;
END $$;

CREATE POLICY "planos_select_autenticado" ON public.planos
  FOR SELECT TO authenticated USING (ativo = true OR app_private.eh_administrador(auth.uid()));