GRANT DELETE ON public.notificacoes_conferencia TO authenticated;
CREATE POLICY "Admins excluem notificacoes de conferencia"
ON public.notificacoes_conferencia FOR DELETE TO authenticated
USING (app_private.eh_administrador(auth.uid()));