CREATE TABLE public.empresa_setores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'personalizado',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresa_setores TO authenticated;
GRANT ALL ON public.empresa_setores TO service_role;

ALTER TABLE public.empresa_setores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_setores_select_membros" ON public.empresa_setores
  FOR SELECT TO authenticated
  USING (
    app_private.pertence_empresa(empresa_id, auth.uid())
    OR (app_private.eh_legado(auth.uid()) AND app_private.empresa_legada(empresa_id))
  );

CREATE POLICY "empresa_setores_insert_admin" ON public.empresa_setores
  FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY "empresa_setores_update_admin" ON public.empresa_setores
  FOR UPDATE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()))
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY "empresa_setores_delete_admin" ON public.empresa_setores
  FOR DELETE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE TRIGGER empresa_setores_updated_at BEFORE UPDATE ON public.empresa_setores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX empresa_setores_empresa_idx ON public.empresa_setores (empresa_id, ordem);

-- Preserva os setores da operação atual (empresa legada), sem renomear nem migrar.
INSERT INTO public.empresa_setores (empresa_id, codigo, nome, ordem, origem)
SELECT e.id, v.codigo, v.nome, v.ordem, 'legado'
  FROM public.empresas e
  CROSS JOIN (VALUES ('agricola', 'Agrícola', 1), ('industria', 'Indústria', 2)) AS v(codigo, nome, ordem)
 WHERE e.created_at < '2026-08-10T00:00:00Z'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Setores iniciais criados durante o onboarding da empresa.
CREATE OR REPLACE FUNCTION public.criar_setores_iniciais(_empresa_id uuid, _setores jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_nome text;
  v_codigo text;
  v_ordem integer := 0;
  v_criados integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT app_private.eh_admin_empresa(_empresa_id, v_user) THEN
    RAISE EXCEPTION 'Somente o administrador da empresa pode criar setores';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_setores, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    CONTINUE WHEN length(v_nome) < 2;

    v_codigo := coalesce(nullif(btrim(coalesce(v_item->>'codigo', '')), ''),
                         lower(regexp_replace(v_nome, '[^a-zA-Z0-9]+', '_', 'g')));
    v_ordem := v_ordem + 1;

    INSERT INTO public.empresa_setores (empresa_id, codigo, nome, descricao, ordem, origem, created_by)
    VALUES (
      _empresa_id,
      v_codigo,
      v_nome,
      nullif(btrim(coalesce(v_item->>'descricao', '')), ''),
      coalesce((v_item->>'ordem')::int, v_ordem),
      'personalizado',
      v_user
    )
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END
$$;

REVOKE ALL ON FUNCTION public.criar_setores_iniciais(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_setores_iniciais(uuid, jsonb) TO authenticated, service_role;