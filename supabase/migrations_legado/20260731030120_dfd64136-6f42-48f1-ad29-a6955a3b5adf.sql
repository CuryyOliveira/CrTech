-- 1. Lock down SECURITY DEFINER functions from direct API execution
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2. profiles: only own profile readable
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- 3. user_roles: only own role readable, no writes via API
DROP POLICY IF EXISTS roles_read ON public.user_roles;
CREATE POLICY roles_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- 4. auditoria: own entries only, forced ownership on insert
DROP POLICY IF EXISTS auditoria_read ON public.auditoria;
DROP POLICY IF EXISTS auditoria_insert ON public.auditoria;
CREATE POLICY auditoria_read ON public.auditoria
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY auditoria_insert ON public.auditoria
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 5. Business tables: shared reads, role-restricted writes
DROP POLICY IF EXISTS unidades_all ON public.unidades;
CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated USING (true);
CREATE POLICY unidades_insert ON public.unidades FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY unidades_update ON public.unidades FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY unidades_delete ON public.unidades FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));

DROP POLICY IF EXISTS materiais_all ON public.materiais;
CREATE POLICY materiais_select ON public.materiais FOR SELECT TO authenticated USING (true);
CREATE POLICY materiais_insert ON public.materiais FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY materiais_update ON public.materiais FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY materiais_delete ON public.materiais FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));

DROP POLICY IF EXISTS material_imagens_all ON public.material_imagens;
CREATE POLICY material_imagens_select ON public.material_imagens FOR SELECT TO authenticated USING (true);
CREATE POLICY material_imagens_insert ON public.material_imagens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY material_imagens_update ON public.material_imagens FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY material_imagens_delete ON public.material_imagens FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));

DROP POLICY IF EXISTS conferencias_all ON public.conferencias;
CREATE POLICY conferencias_select ON public.conferencias FOR SELECT TO authenticated USING (true);
CREATE POLICY conferencias_insert ON public.conferencias FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY conferencias_update ON public.conferencias FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY conferencias_delete ON public.conferencias FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));

DROP POLICY IF EXISTS conferencia_itens_all ON public.conferencia_itens;
CREATE POLICY conferencia_itens_select ON public.conferencia_itens FOR SELECT TO authenticated USING (true);
CREATE POLICY conferencia_itens_insert ON public.conferencia_itens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY conferencia_itens_update ON public.conferencia_itens FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));
CREATE POLICY conferencia_itens_delete ON public.conferencia_itens FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','conferente')));