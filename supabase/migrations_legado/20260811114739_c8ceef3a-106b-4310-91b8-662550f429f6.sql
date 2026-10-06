-- FASE 13A — Fundação do Motor Universal de Módulos (nada legado é alterado)

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS segmento text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_etapa text;

-- Helper: o usuário é proprietário/administrador da empresa informada?
CREATE OR REPLACE FUNCTION app_private.eh_admin_empresa(_empresa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, app_private
AS $$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_administrador(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
         AND eu.papel IN ('proprietario', 'administrador')
    )
  )
$$;

REVOKE ALL ON FUNCTION app_private.eh_admin_empresa(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.eh_admin_empresa(uuid, uuid) TO authenticated, service_role;

-- Helper: o usuário pertence (ativo) à empresa informada?
CREATE OR REPLACE FUNCTION app_private.pertence_empresa(_empresa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, app_private
AS $$
  SELECT _user_id IS NOT NULL AND (
    app_private.eh_administrador(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.empresa_usuarios eu
       WHERE eu.empresa_id = _empresa_id
         AND eu.user_id = _user_id
         AND eu.ativo = true
    )
  )
$$;

REVOKE ALL ON FUNCTION app_private.pertence_empresa(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.pertence_empresa(uuid, uuid) TO authenticated, service_role;

-- Módulos de conferência criados por cada empresa
CREATE TABLE IF NOT EXISTS public.empresa_modulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nome text NOT NULL,
  descricao text,
  icone text NOT NULL DEFAULT 'package',
  cor text,
  tipo text NOT NULL DEFAULT 'lista',
  recursos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  excluido boolean NOT NULL DEFAULT false,
  origem text NOT NULL DEFAULT 'personalizado',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_modulos_tipo_check CHECK (tipo IN ('lista', 'caixa', 'frota')),
  CONSTRAINT empresa_modulos_origem_check CHECK (origem IN ('sugerido', 'personalizado', 'legado'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresa_modulos TO authenticated;
GRANT ALL ON public.empresa_modulos TO service_role;

ALTER TABLE public.empresa_modulos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa_modulos_select_membros"
  ON public.empresa_modulos FOR SELECT TO authenticated
  USING (app_private.pertence_empresa(empresa_id, auth.uid()));

CREATE POLICY "empresa_modulos_insert_admin"
  ON public.empresa_modulos FOR INSERT TO authenticated
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY "empresa_modulos_update_admin"
  ON public.empresa_modulos FOR UPDATE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()))
  WITH CHECK (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE POLICY "empresa_modulos_delete_admin"
  ON public.empresa_modulos FOR DELETE TO authenticated
  USING (app_private.eh_admin_empresa(empresa_id, auth.uid()));

CREATE UNIQUE INDEX IF NOT EXISTS empresa_modulos_codigo_uk
  ON public.empresa_modulos (empresa_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS empresa_modulos_nome_uk
  ON public.empresa_modulos (empresa_id, lower(btrim(nome))) WHERE excluido = false;
CREATE INDEX IF NOT EXISTS empresa_modulos_empresa_idx
  ON public.empresa_modulos (empresa_id, ordem);

CREATE TRIGGER empresa_modulos_updated_at
  BEFORE UPDATE ON public.empresa_modulos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Criação em lote dos módulos escolhidos no onboarding
CREATE OR REPLACE FUNCTION public.criar_modulos_iniciais(_empresa_id uuid, _modulos jsonb)
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
  v_criados integer := 0;
  v_ordem integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF NOT app_private.eh_admin_empresa(_empresa_id, v_user) THEN
    RAISE EXCEPTION 'Somente o administrador da empresa pode criar módulos';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(_modulos, '[]'::jsonb))
  LOOP
    v_nome := btrim(coalesce(v_item->>'nome', ''));
    CONTINUE WHEN length(v_nome) < 2;

    v_codigo := coalesce(nullif(btrim(coalesce(v_item->>'codigo', '')), ''),
                         upper(regexp_replace(v_nome, '[^a-zA-Z0-9]+', '_', 'g')));
    v_ordem := v_ordem + 1;

    INSERT INTO public.empresa_modulos
      (empresa_id, codigo, nome, descricao, icone, cor, tipo, recursos, ordem, origem, created_by)
    VALUES (
      _empresa_id,
      v_codigo,
      v_nome,
      nullif(btrim(coalesce(v_item->>'descricao', '')), ''),
      coalesce(nullif(btrim(coalesce(v_item->>'icone', '')), ''), 'package'),
      nullif(btrim(coalesce(v_item->>'cor', '')), ''),
      CASE WHEN v_item->>'tipo' IN ('lista', 'caixa', 'frota') THEN v_item->>'tipo' ELSE 'lista' END,
      coalesce(v_item->'recursos', '{}'::jsonb),
      coalesce((v_item->>'ordem')::int, v_ordem),
      CASE WHEN v_item->>'origem' = 'sugerido' THEN 'sugerido' ELSE 'personalizado' END,
      v_user
    )
    ON CONFLICT (empresa_id, codigo) DO NOTHING;

    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END
$$;

REVOKE ALL ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_modulos_iniciais(uuid, jsonb) TO authenticated, service_role;