-- 1) Normalização permanente de código/descrição/locação
CREATE OR REPLACE FUNCTION public.materiais_normalizar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.codigo := NULLIF(btrim(regexp_replace(COALESCE(NEW.codigo,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', '', 'g')), '');
  NEW.codigo := COALESCE(NEW.codigo, '—');
  NEW.descricao := btrim(regexp_replace(COALESCE(NEW.descricao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g'));
  NEW.descricao := regexp_replace(NEW.descricao, '\s+', ' ', 'g');
  NEW.locacao := NULLIF(btrim(regexp_replace(COALESCE(NEW.locacao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g')), '');
  RETURN NEW;
END $$;

UPDATE public.materiais SET
  codigo = COALESCE(NULLIF(btrim(regexp_replace(COALESCE(codigo,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', '', 'g')), ''), '—'),
  descricao = regexp_replace(btrim(regexp_replace(COALESCE(descricao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g')), '\s+', ' ', 'g'),
  locacao = NULLIF(btrim(regexp_replace(COALESCE(locacao,''), '[\u200B\u200C\u200D\uFEFF\u00A0]', ' ', 'g')), '');

-- 2) Mapa de duplicidades (mantém o registro mais antigo por unidade+código+locação)
CREATE TEMP TABLE _map_dup ON COMMIT DROP AS
WITH r AS (
  SELECT id, unidade_id, quantidade_esperada, created_at,
         first_value(id) OVER (
           PARTITION BY unidade_id, upper(codigo), COALESCE(upper(locacao),'')
           ORDER BY created_at, id
         ) AS keeper
  FROM public.materiais
)
SELECT id, keeper, quantidade_esperada FROM r WHERE id <> keeper;

-- 3) Soma as quantidades esperadas dos duplicados no registro mantido
UPDATE public.materiais m
SET quantidade_esperada = m.quantidade_esperada + s.extra
FROM (SELECT keeper, SUM(quantidade_esperada) extra FROM _map_dup GROUP BY keeper) s
WHERE m.id = s.keeper;

-- 4) Reaponta referências (histórico das conferências preservado)
UPDATE public.conferencia_itens ci SET material_id = d.keeper
FROM _map_dup d WHERE ci.material_id = d.id;

UPDATE public.material_imagens mi SET material_id = d.keeper
FROM _map_dup d WHERE mi.material_id = d.id;

-- 5) Consolida itens de conferência que passaram a apontar para o mesmo material
WITH dupitens AS (
  SELECT id, conferencia_id, material_id, quantidade_esperada, quantidade_contada,
         first_value(id) OVER (PARTITION BY conferencia_id, material_id ORDER BY updated_at, id) AS keeper
  FROM public.conferencia_itens
  WHERE material_id IS NOT NULL
), extras AS (
  SELECT keeper,
         SUM(quantidade_esperada) qe,
         SUM(COALESCE(quantidade_contada,0)) qc,
         bool_or(quantidade_contada IS NOT NULL) tem_contagem
  FROM dupitens WHERE id <> keeper GROUP BY keeper
)
UPDATE public.conferencia_itens ci
SET quantidade_esperada = ci.quantidade_esperada + e.qe,
    quantidade_contada = CASE
      WHEN ci.quantidade_contada IS NULL AND NOT e.tem_contagem THEN NULL
      ELSE COALESCE(ci.quantidade_contada,0) + e.qc END
FROM extras e WHERE ci.id = e.keeper;

DELETE FROM public.conferencia_itens ci
USING (
  SELECT id, first_value(id) OVER (PARTITION BY conferencia_id, material_id ORDER BY updated_at, id) AS keeper
  FROM public.conferencia_itens WHERE material_id IS NOT NULL
) d
WHERE ci.id = d.id AND d.id <> d.keeper;

-- 6) Remove materiais duplicados e órfãos
DELETE FROM public.materiais m USING _map_dup d WHERE m.id = d.id;
DELETE FROM public.materiais m WHERE NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = m.unidade_id);
DELETE FROM public.material_imagens mi WHERE NOT EXISTS (SELECT 1 FROM public.materiais m WHERE m.id = mi.material_id);

-- 7) Prevenção definitiva
CREATE TRIGGER trg_materiais_normalizar
BEFORE INSERT OR UPDATE ON public.materiais
FOR EACH ROW EXECUTE FUNCTION public.materiais_normalizar();

CREATE UNIQUE INDEX IF NOT EXISTS materiais_unico_codigo_locacao
ON public.materiais (unidade_id, upper(codigo), COALESCE(upper(locacao), ''));

CREATE UNIQUE INDEX IF NOT EXISTS conferencia_itens_unico_material
ON public.conferencia_itens (conferencia_id, material_id) WHERE material_id IS NOT NULL;