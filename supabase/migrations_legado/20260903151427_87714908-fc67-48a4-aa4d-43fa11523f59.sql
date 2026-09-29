GRANT EXECUTE ON FUNCTION app_private.eh_legado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.empresa_legada(uuid) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS materiais_codigo_trgm ON public.materiais USING gin (codigo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materiais_descricao_trgm ON public.materiais USING gin (descricao gin_trgm_ops);
CREATE INDEX IF NOT EXISTS materiais_func_codigo_trgm ON public.materiais USING gin (funcionario_codigo gin_trgm_ops);