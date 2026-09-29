-- Isolamento por empresa: administradores de empresa deixam de ter alcance global.
DROP POLICY IF EXISTS empresas_select_membro_ou_admin ON public.empresas;
CREATE POLICY empresas_select_membro_ou_admin ON public.empresas
  FOR SELECT TO authenticated
  USING (app_private.eh_proprietario(auth.uid()) OR id IN (SELECT app_private.minhas_empresas()));

DROP POLICY IF EXISTS empresas_update_admin ON public.empresas;
CREATE POLICY empresas_update_admin ON public.empresas
  FOR UPDATE TO authenticated
  USING (
    app_private.eh_proprietario(auth.uid())
    OR (app_private.eh_administrador(auth.uid()) AND id IN (SELECT app_private.minhas_empresas()))
  )
  WITH CHECK (
    app_private.eh_proprietario(auth.uid())
    OR (app_private.eh_administrador(auth.uid()) AND id IN (SELECT app_private.minhas_empresas()))
  );

DROP POLICY IF EXISTS empresas_insert_admin ON public.empresas;
CREATE POLICY empresas_insert_admin ON public.empresas
  FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

-- Vínculos de usuário/empresa: leitura escopada e escrita apenas pelo Proprietário do Sistema
-- (o backend continua usando a chave de serviço, respeitando o limite do plano).
DROP POLICY IF EXISTS empresa_usuarios_select ON public.empresa_usuarios;
CREATE POLICY empresa_usuarios_select ON public.empresa_usuarios
  FOR SELECT TO authenticated
  USING (
    app_private.eh_proprietario(auth.uid())
    OR user_id = auth.uid()
    OR empresa_id IN (SELECT app_private.minhas_empresas())
  );

DROP POLICY IF EXISTS empresa_usuarios_admin_insert ON public.empresa_usuarios;
CREATE POLICY empresa_usuarios_admin_insert ON public.empresa_usuarios
  FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

DROP POLICY IF EXISTS empresa_usuarios_admin_update ON public.empresa_usuarios;
CREATE POLICY empresa_usuarios_admin_update ON public.empresa_usuarios
  FOR UPDATE TO authenticated
  USING (app_private.eh_proprietario(auth.uid()))
  WITH CHECK (app_private.eh_proprietario(auth.uid()));

DROP POLICY IF EXISTS empresa_usuarios_admin_delete ON public.empresa_usuarios;
CREATE POLICY empresa_usuarios_admin_delete ON public.empresa_usuarios
  FOR DELETE TO authenticated
  USING (app_private.eh_proprietario(auth.uid()));

-- Assinaturas e pagamentos: visão global apenas do Proprietário do Sistema.
DROP POLICY IF EXISTS assinaturas_select_membro_ou_admin ON public.assinaturas;
CREATE POLICY assinaturas_select_membro_ou_admin ON public.assinaturas
  FOR SELECT TO authenticated
  USING (app_private.eh_proprietario(auth.uid()) OR empresa_id IN (SELECT app_private.minhas_empresas()));