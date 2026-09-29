-- unidades
DROP POLICY IF EXISTS unidades_insert ON public.unidades;
DROP POLICY IF EXISTS unidades_update ON public.unidades;
DROP POLICY IF EXISTS unidades_delete ON public.unidades;

CREATE POLICY unidades_insert ON public.unidades FOR INSERT TO authenticated
WITH CHECK (
  app_private.pode_tipo(tipo)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY unidades_update ON public.unidades FOR UPDATE TO authenticated
USING (
  app_private.pode_tipo(tipo)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
)
WITH CHECK (
  app_private.pode_tipo(tipo)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY unidades_delete ON public.unidades FOR DELETE TO authenticated
USING (
  app_private.pode_tipo(tipo)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

-- materiais
DROP POLICY IF EXISTS materiais_insert ON public.materiais;
DROP POLICY IF EXISTS materiais_update ON public.materiais;
DROP POLICY IF EXISTS materiais_delete ON public.materiais;

CREATE POLICY materiais_insert ON public.materiais FOR INSERT TO authenticated
WITH CHECK (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY materiais_update ON public.materiais FOR UPDATE TO authenticated
USING (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
)
WITH CHECK (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY materiais_delete ON public.materiais FOR DELETE TO authenticated
USING (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

-- conferencias
DROP POLICY IF EXISTS conferencias_insert ON public.conferencias;
DROP POLICY IF EXISTS conferencias_update ON public.conferencias;
DROP POLICY IF EXISTS conferencias_delete ON public.conferencias;

CREATE POLICY conferencias_insert ON public.conferencias FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY conferencias_update ON public.conferencias FOR UPDATE TO authenticated
USING (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
)
WITH CHECK (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY conferencias_delete ON public.conferencias FOR DELETE TO authenticated
USING (
  app_private.pode_unidade(unidade_id)
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

-- conferencia_itens
DROP POLICY IF EXISTS conferencia_itens_insert ON public.conferencia_itens;
DROP POLICY IF EXISTS conferencia_itens_update ON public.conferencia_itens;
DROP POLICY IF EXISTS conferencia_itens_delete ON public.conferencia_itens;

CREATE POLICY conferencia_itens_insert ON public.conferencia_itens FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.conferencias c WHERE c.id = conferencia_id AND app_private.pode_unidade(c.unidade_id))
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY conferencia_itens_update ON public.conferencia_itens FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.conferencias c WHERE c.id = conferencia_id AND app_private.pode_unidade(c.unidade_id))
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.conferencias c WHERE c.id = conferencia_id AND app_private.pode_unidade(c.unidade_id))
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);

CREATE POLICY conferencia_itens_delete ON public.conferencia_itens FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.conferencias c WHERE c.id = conferencia_id AND app_private.pode_unidade(c.unidade_id))
  AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['admin'::app_role,'conferente'::app_role]))
);