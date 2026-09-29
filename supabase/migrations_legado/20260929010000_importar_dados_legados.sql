-- Restauração dos dados exportados da Lovable Cloud (CSV), mantendo os IDs originais.
-- Chamada apenas pelo servidor (service_role) a partir do Painel Master → Restaurar dados.
-- Cada chamada recebe um lote de registros de UMA tabela, com os valores como texto do CSV.
CREATE OR REPLACE FUNCTION public.importar_dados_legados(_tabela text, _registros jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  permitidas constant text[] := ARRAY[
    'empresas','empresa_setores','empresa_modulos','empresa_usuarios','profiles','user_profiles',
    'user_roles','permissoes_perfil','permissoes_usuario','cadastros_mestres','integracoes',
    'configuracoes_sistema','planos','assinaturas','assinatura_pagamentos','avisos_sistema',
    'unidades','materiais','conferencias','conferencia_itens','conferencia_pausas',
    'historico_conferencias','notificacoes_conferencia','notificacao_emails','notificacao_leituras',
    'auditoria','metas','material_imagens','aviso_leituras'];
  -- Tabelas ligadas a contas: só entram registros de usuários que existem neste banco.
  col_usuario constant jsonb := '{"profiles":"id","user_profiles":"user_id","user_roles":"user_id",
    "empresa_usuarios":"user_id","permissoes_usuario":"user_id","notificacao_leituras":"user_id",
    "aviso_leituras":"user_id"}';
  tipos jsonb;
  obrig jsonb;
  dados jsonb;
  colunas text;
  atualizar text;
  total integer;
BEGIN
  IF NOT (_tabela = ANY (permitidas)) THEN
    RAISE EXCEPTION 'Tabela não permitida na restauração: %', _tabela;
  END IF;
  IF jsonb_typeof(_registros) <> 'array' THEN
    RAISE EXCEPTION 'Registros inválidos';
  END IF;

  SELECT jsonb_object_agg(column_name, udt_name),
         jsonb_object_agg(column_name, (is_nullable = 'NO' AND udt_name = 'text'))
    INTO tipos, obrig
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = _tabela;

  -- Converte os textos do CSV para os tipos da tabela (vazio → nulo; JSON e listas decodificados).
  SELECT coalesce(jsonb_agg(conv.obj), '[]'::jsonb) INTO dados
    FROM jsonb_array_elements(_registros) r(reg)
    CROSS JOIN LATERAL (
      SELECT jsonb_object_agg(e.key,
        CASE
          WHEN e.value IS NULL OR e.value = 'null'::jsonb OR e.value = '""'::jsonb THEN
            CASE WHEN coalesce((obrig ->> e.key)::boolean, false) THEN '""'::jsonb ELSE 'null'::jsonb END
          WHEN tipos ->> e.key IN ('jsonb', 'json') OR left(tipos ->> e.key, 1) = '_' THEN
            CASE WHEN jsonb_typeof(e.value) = 'string' THEN (e.value #>> '{}')::jsonb ELSE e.value END
          ELSE e.value
        END) AS obj
      FROM jsonb_each(r.reg) e
      WHERE tipos ? e.key
    ) conv;

  IF col_usuario ? _tabela THEN
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO dados
      FROM jsonb_array_elements(dados) d
     WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = d ->> (col_usuario ->> _tabela));
  END IF;

  IF _tabela = 'configuracoes_sistema' THEN
    -- O remetente passou a ser o domínio autenticado no Brevo.
    SELECT jsonb_agg(CASE WHEN d ->> 'chave' = 'emails_conferencia'
      THEN jsonb_set(jsonb_set(d, '{valor,remetente}', '"nao-responda@conferenciarapida.com.br"'),
                     '{valor,sender_domain}', '"conferenciarapida.com.br"')
      ELSE d END) INTO dados
      FROM jsonb_array_elements(dados) d;
  END IF;

  IF jsonb_array_length(dados) = 0 THEN
    RETURN 0;
  END IF;

  -- Remove registros padrão (com outro ID) que ocupam as mesmas chaves únicas dos importados.
  -- Registros com o mesmo ID são atualizados no INSERT ... ON CONFLICT abaixo, sem apagar dependentes.
  CASE _tabela
    WHEN 'user_profiles' THEN
      DELETE FROM public.user_profiles t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.id::text <> d ->> 'id';
    WHEN 'user_roles' THEN
      DELETE FROM public.user_roles t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.role::text = d ->> 'role' AND t.id::text <> d ->> 'id';
    WHEN 'permissoes_usuario' THEN
      DELETE FROM public.permissoes_usuario t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.modulo = d ->> 'modulo' AND t.id::text <> d ->> 'id';
    WHEN 'permissoes_perfil' THEN
      DELETE FROM public.permissoes_perfil t USING jsonb_array_elements(dados) d
       WHERE t.perfil = d ->> 'perfil' AND t.modulo = d ->> 'modulo' AND t.id::text <> d ->> 'id';
    WHEN 'integracoes' THEN
      DELETE FROM public.integracoes t USING jsonb_array_elements(dados) d WHERE t.tipo = d ->> 'tipo' AND t.id::text <> d ->> 'id';
    WHEN 'planos' THEN
      DELETE FROM public.planos t USING jsonb_array_elements(dados) d
       WHERE t.codigo = d ->> 'codigo' AND t.ambiente = d ->> 'ambiente' AND t.id::text <> d ->> 'id';
    WHEN 'cadastros_mestres' THEN
      DELETE FROM public.cadastros_mestres t USING jsonb_array_elements(dados) d
       WHERE t.tipo = d ->> 'tipo' AND lower(t.codigo) = lower(d ->> 'codigo') AND t.id::text <> d ->> 'id';
    WHEN 'empresa_usuarios' THEN
      DELETE FROM public.empresa_usuarios t USING jsonb_array_elements(dados) d
       WHERE t.empresa_id = (d ->> 'empresa_id')::uuid AND t.user_id = (d ->> 'user_id')::uuid AND t.id::text <> d ->> 'id';
    WHEN 'empresa_setores' THEN
      DELETE FROM public.empresa_setores t USING jsonb_array_elements(dados) d
       WHERE t.empresa_id = (d ->> 'empresa_id')::uuid AND t.codigo = d ->> 'codigo' AND t.id::text <> d ->> 'id';
    WHEN 'notificacao_leituras' THEN
      DELETE FROM public.notificacao_leituras t USING jsonb_array_elements(dados) d
       WHERE t.user_id = (d ->> 'user_id')::uuid AND t.chave = d ->> 'chave' AND t.id::text <> d ->> 'id';
    ELSE NULL;
  END CASE;

  -- Só as colunas presentes no arquivo; as demais recebem o valor padrão da tabela.
  SELECT string_agg(quote_ident(k), ', ') INTO colunas
    FROM jsonb_object_keys(dados -> 0) k
   WHERE tipos ? k;

  SELECT string_agg(format('%1$I = EXCLUDED.%1$I', k), ', ') INTO atualizar
    FROM jsonb_object_keys(dados -> 0) k
   WHERE tipos ? k AND k NOT IN ('id', 'chave');

  EXECUTE format(
    'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) '
    'ON CONFLICT (%3$s) DO UPDATE SET %4$s',
    _tabela, colunas,
    CASE WHEN _tabela = 'configuracoes_sistema' THEN 'chave' ELSE 'id' END,
    atualizar)
    USING dados;
  GET DIAGNOSTICS total = ROW_COUNT;
  RETURN total;
END
$$;

REVOKE ALL ON FUNCTION public.importar_dados_legados(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_dados_legados(text, jsonb) TO service_role;
