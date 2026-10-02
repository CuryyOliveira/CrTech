ALTER PUBLICATION supabase_realtime DROP TABLE public.notificacao_emails;

DROP POLICY IF EXISTS "Pausas visiveis para admin ou dono da conferencia" ON public.conferencia_pausas;
CREATE POLICY "Pausas visiveis para admin ou dono da conferencia"
ON public.conferencia_pausas
FOR SELECT
TO authenticated
USING (
  app_private.eh_administrador(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.conferencias c
    WHERE c.id = conferencia_pausas.conferencia_id
      AND c.created_by = auth.uid()
  )
);