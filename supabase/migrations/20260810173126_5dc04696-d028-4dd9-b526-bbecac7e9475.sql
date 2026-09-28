CREATE OR REPLACE FUNCTION app_private.minhas_empresas()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id
    FROM public.empresa_usuarios
   WHERE user_id = auth.uid()
     AND ativo = true
$$;

REVOKE ALL ON FUNCTION app_private.minhas_empresas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.minhas_empresas() TO authenticated;

DROP POLICY IF EXISTS empresas_select_membro_ou_admin ON public.empresas;
CREATE POLICY empresas_select_membro_ou_admin ON public.empresas
FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR id IN (SELECT app_private.minhas_empresas()));

DROP POLICY IF EXISTS empresa_usuarios_select ON public.empresa_usuarios;
CREATE POLICY empresa_usuarios_select ON public.empresa_usuarios
FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR user_id = auth.uid() OR empresa_id IN (SELECT app_private.minhas_empresas()));

DROP POLICY IF EXISTS assinaturas_select_membro_ou_admin ON public.assinaturas;
CREATE POLICY assinaturas_select_membro_ou_admin ON public.assinaturas
FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR empresa_id IN (SELECT app_private.minhas_empresas()));

DROP POLICY IF EXISTS assinatura_pagamentos_select_membro_ou_admin ON public.assinatura_pagamentos;
CREATE POLICY assinatura_pagamentos_select_membro_ou_admin ON public.assinatura_pagamentos
FOR SELECT TO authenticated
USING (app_private.eh_administrador(auth.uid()) OR empresa_id IN (SELECT app_private.minhas_empresas()));