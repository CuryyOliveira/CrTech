-- V2.3 — Sincronização servidor → aparelho com CURSOR confiável e EXCLUSÕES.
--
-- Decisão (docs/V2_OFFLINE_SYNC_RELATORIO.md): REGISTRO DE ALTERAÇÕES (change log) com
-- tombstones, alimentado por triggers. Motivos:
--   * não exige deleted_at em todas as tabelas nem muda como a V1 exclui (DELETE continua);
--   * captura criação, atualização, exclusão e mudança de status, feitas pela V1, pela V2,
--     pelo painel ou pelo servidor;
--   * o aparelho recebe só o que mudou e só o que a RLS permite ver.
--
-- Cursor: posição (txid, seq) + marca d'água pg_snapshot_xmin. Só são entregues alterações
-- de transações JÁ TERMINADAS (txid < xmin), em ordem (txid, seq). Assim, uma transação lenta
-- que ainda não confirmou nunca é "pulada": ela aparece numa chamada seguinte, antes de
-- qualquer transação mais nova ser entregue depois dela.
--
-- Migration aditiva. NÃO executada na produção.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.alteracoes_sync (
  seq bigserial PRIMARY KEY,
  txid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  tabela text NOT NULL CHECK (tabela IN ('unidades', 'materiais', 'conferencias', 'conferencia_itens', 'conferencia_fotos')),
  registro_id uuid NOT NULL,
  operacao text NOT NULL CHECK (operacao IN ('upsert', 'delete')),
  conferencia_id uuid,
  unidade_id uuid,
  -- Escopo de acesso gravado no momento da alteração (vale também para exclusões).
  empresa_id uuid,
  u_tipo text,
  u_modulo_id uuid,
  alterado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alteracoes_sync_cursor_idx ON public.alteracoes_sync (txid, seq);
CREATE INDEX IF NOT EXISTS alteracoes_sync_alterado_idx ON public.alteracoes_sync (alterado_em);

ALTER TABLE public.alteracoes_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY alteracoes_sync_select ON public.alteracoes_sync AS PERMISSIVE FOR SELECT TO authenticated
  USING (CASE WHEN empresa_id IS NULL THEN app_private.eh_global(auth.uid())
              ELSE app_private.acesso_unidade(u_tipo, empresa_id, u_modulo_id) END);
REVOKE ALL ON public.alteracoes_sync FROM anon, authenticated;
GRANT SELECT ON public.alteracoes_sync TO authenticated;
GRANT ALL ON public.alteracoes_sync TO service_role;

-- Controle da limpeza (alterações antigas removidas → aparelho com cursor antigo recarrega tudo).
CREATE TABLE IF NOT EXISTS app_private.sync_controle (
  chave text PRIMARY KEY,
  valor text NOT NULL
);
REVOKE ALL ON app_private.sync_controle FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.sync_controle TO service_role;

-- Até onde o registro foi limpo (lido pelo usuário sem acesso direto à tabela de controle).
CREATE OR REPLACE FUNCTION app_private.sync_limpo_ate()
RETURNS xid8
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private'
AS $$
  SELECT valor::xid8 FROM app_private.sync_controle WHERE chave = 'limpo_ate_txid'
$$;
REVOKE ALL ON FUNCTION app_private.sync_limpo_ate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.sync_limpo_ate() TO authenticated, service_role;

-- Trigger de captura (SECURITY DEFINER: grava independentemente da RLS de quem alterou).
CREATE OR REPLACE FUNCTION app_private.registrar_alteracao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  linha record;
  v_unidade uuid;
  v_conferencia uuid;
  u record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    linha := OLD;
  ELSE
    linha := NEW;
  END IF;
  IF TG_TABLE_NAME = 'unidades' THEN
    v_unidade := linha.id;
    INSERT INTO public.alteracoes_sync (tabela, registro_id, operacao, unidade_id, empresa_id, u_tipo, u_modulo_id)
    VALUES ('unidades', linha.id, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
            linha.id, linha.empresa_id, linha.tipo, linha.modulo_id);
    -- Mudança de escopo (empresa/módulo/tipo): quem perdeu acesso recebe a exclusão.
    IF TG_OP = 'UPDATE' AND (OLD.empresa_id IS DISTINCT FROM NEW.empresa_id
                             OR OLD.modulo_id IS DISTINCT FROM NEW.modulo_id OR OLD.tipo IS DISTINCT FROM NEW.tipo) THEN
      INSERT INTO public.alteracoes_sync (tabela, registro_id, operacao, unidade_id, empresa_id, u_tipo, u_modulo_id)
      VALUES ('unidades', OLD.id, 'delete', OLD.id, OLD.empresa_id, OLD.tipo, OLD.modulo_id);
    END IF;
    RETURN NULL;
  ELSIF TG_TABLE_NAME = 'materiais' OR TG_TABLE_NAME = 'conferencias' THEN
    v_unidade := linha.unidade_id;
    v_conferencia := CASE WHEN TG_TABLE_NAME = 'conferencias' THEN linha.id END;
  ELSE
    v_conferencia := linha.conferencia_id;
    SELECT unidade_id INTO v_unidade FROM public.conferencias WHERE id = v_conferencia;
  END IF;

  SELECT empresa_id, tipo, modulo_id INTO u FROM public.unidades WHERE id = v_unidade;
  INSERT INTO public.alteracoes_sync
    (tabela, registro_id, operacao, conferencia_id, unidade_id, empresa_id, u_tipo, u_modulo_id)
  VALUES (TG_TABLE_NAME, linha.id, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          v_conferencia, v_unidade, u.empresa_id, u.tipo, u.modulo_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.registrar_alteracao() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unidades', 'materiais', 'conferencias', 'conferencia_itens', 'conferencia_fotos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_zz_sync ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_zz_sync AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                    FOR EACH ROW EXECUTE FUNCTION app_private.registrar_alteracao()', t);
  END LOOP;
END $$;

-- Linha atual de um registro, como o aparelho a guarda (sem imagens pesadas).
CREATE OR REPLACE FUNCTION app_private.linha_sync(_tabela text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  r jsonb;
BEGIN
  CASE _tabela
    WHEN 'unidades' THEN SELECT to_jsonb(x) INTO r FROM public.unidades x WHERE id = _id;
    WHEN 'materiais' THEN SELECT to_jsonb(x) - 'imagem_principal' INTO r FROM public.materiais x WHERE id = _id;
    WHEN 'conferencias' THEN
      SELECT (to_jsonb(x) - 'assinatura' - 'assinatura_gestor')
             || jsonb_build_object('tem_assinatura', x.assinatura IS NOT NULL,
                                   'tem_assinatura_gestor', x.assinatura_gestor IS NOT NULL)
        INTO r FROM public.conferencias x WHERE id = _id;
    WHEN 'conferencia_itens' THEN
      SELECT (to_jsonb(x) - 'fotos') || jsonb_build_object('qtd_fotos_v1', jsonb_array_length(x.fotos))
        INTO r FROM public.conferencia_itens x WHERE id = _id;
    WHEN 'conferencia_fotos' THEN SELECT to_jsonb(x) INTO r FROM public.conferencia_fotos x WHERE id = _id;
  END CASE;
  RETURN r;   -- NULL = não existe mais ou o usuário não tem acesso (RLS)
END;
$$;

CREATE OR REPLACE FUNCTION app_private.ler_cursor(_cursor text, OUT txid xid8, OUT seq bigint)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _cursor IS NULL OR _cursor !~ '^[0-9]+:-?[0-9]+$' THEN
    RAISE EXCEPTION 'Cursor inválido' USING ERRCODE = '22023';
  END IF;
  txid := split_part(_cursor, ':', 1)::xid8;
  seq := split_part(_cursor, ':', 2)::bigint;
END;
$$;

-- Cursor inicial: tudo o que foi confirmado ANTES deste ponto vem na carga inicial
-- (snapshot_sync); o que vier depois chega por alteracoes_sync.
CREATE OR REPLACE FUNCTION public.cursor_sync_inicial()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT pg_snapshot_xmin(pg_current_snapshot())::text || ':-1'
$$;

-- Carga inicial paginada de uma tabela (somente o que a RLS permite).
CREATE OR REPLACE FUNCTION public.snapshot_sync(_tabela text, _apos uuid DEFAULT NULL, _limite integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_limite integer := least(greatest(coalesce(_limite, 500), 1), 1000);
  v_ids uuid[];
  v_linhas jsonb;
BEGIN
  IF _tabela NOT IN ('unidades', 'materiais', 'conferencias', 'conferencia_itens', 'conferencia_fotos') THEN
    RAISE EXCEPTION 'Tabela não sincronizável: %', _tabela USING ERRCODE = '22023';
  END IF;
  EXECUTE format(
    CASE _tabela
      -- Conferências: abertas e as encerradas nos últimos 30 dias; itens/fotos só dessas.
      WHEN 'conferencias' THEN
        'SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.conferencias
          WHERE ($1 IS NULL OR id > $1) AND (status IN (''em_andamento'',''pausada'') OR created_at > now() - interval ''30 days'')
          ORDER BY id LIMIT $2) s'
      WHEN 'conferencia_itens' THEN
        'SELECT array_agg(id ORDER BY id) FROM (SELECT i.id FROM public.conferencia_itens i
          JOIN public.conferencias c ON c.id = i.conferencia_id
          WHERE ($1 IS NULL OR i.id > $1) AND (c.status IN (''em_andamento'',''pausada'') OR c.created_at > now() - interval ''30 days'')
          ORDER BY i.id LIMIT $2) s'
      WHEN 'conferencia_fotos' THEN
        'SELECT array_agg(id ORDER BY id) FROM (SELECT f.id FROM public.conferencia_fotos f
          JOIN public.conferencias c ON c.id = f.conferencia_id
          WHERE ($1 IS NULL OR f.id > $1) AND (c.status IN (''em_andamento'',''pausada'') OR c.created_at > now() - interval ''30 days'')
          ORDER BY f.id LIMIT $2) s'
      ELSE 'SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.%1$I WHERE ($1 IS NULL OR id > $1) ORDER BY id LIMIT $2) s'
    END, _tabela)
  INTO v_ids USING _apos, v_limite;

  SELECT coalesce(jsonb_agg(app_private.linha_sync(_tabela, x) ORDER BY x), '[]'::jsonb)
    INTO v_linhas FROM unnest(coalesce(v_ids, '{}')) x;
  RETURN jsonb_build_object('linhas', v_linhas,
                            'proximo', CASE WHEN coalesce(array_length(v_ids, 1), 0) = v_limite THEN v_ids[v_limite] END);
END;
$$;

-- Alterações depois do cursor. Várias alterações do mesmo registro na página viram uma só
-- (estado atual). Registro inexistente/inacessível = exclusão para o aparelho.
CREATE OR REPLACE FUNCTION public.alteracoes_sync(_cursor text, _limite integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  c record := app_private.ler_cursor(_cursor);
  v_xmin xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_limite integer := least(greatest(coalesce(_limite, 500), 1), 2000);
  v_limpo xid8;
  v_ultimo_txid xid8;
  v_ultimo_seq bigint;
  v_total integer;
  v_alteracoes jsonb;
BEGIN
  v_limpo := app_private.sync_limpo_ate();
  IF v_limpo IS NOT NULL AND c.txid <= v_limpo THEN
    RETURN jsonb_build_object('reset', true, 'alteracoes', '[]'::jsonb, 'cursor', public.cursor_sync_inicial(), 'mais', false);
  END IF;

  WITH lote AS MATERIALIZED (
    SELECT a.seq, a.txid, a.tabela, a.registro_id, a.operacao, a.conferencia_id
      FROM public.alteracoes_sync a
     WHERE (a.txid, a.seq) > (c.txid, c.seq) AND a.txid < v_xmin
     ORDER BY a.txid, a.seq
     LIMIT v_limite
  ), unicos AS (
    SELECT DISTINCT ON (l.tabela, l.registro_id) l.tabela, l.registro_id, l.conferencia_id, l.txid, l.seq,
           CASE WHEN l.operacao = 'delete' THEN NULL ELSE app_private.linha_sync(l.tabela, l.registro_id) END AS dados
      FROM lote l
     ORDER BY l.tabela, l.registro_id, l.txid DESC, l.seq DESC
  )
  SELECT (SELECT count(*) FROM lote),
         (SELECT l.txid FROM lote l ORDER BY l.txid DESC, l.seq DESC LIMIT 1),
         (SELECT l.seq FROM lote l ORDER BY l.txid DESC, l.seq DESC LIMIT 1),
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'tabela', u.tabela, 'id', u.registro_id, 'conferencia_id', u.conferencia_id,
                   'operacao', CASE WHEN u.dados IS NULL THEN 'delete' ELSE 'upsert' END,
                   'dados', u.dados) ORDER BY u.txid, u.seq), '[]'::jsonb) FROM unicos u)
    INTO v_total, v_ultimo_txid, v_ultimo_seq, v_alteracoes;

  RETURN jsonb_build_object(
    'alteracoes', v_alteracoes,
    'cursor', CASE WHEN v_ultimo_txid IS NULL THEN _cursor ELSE v_ultimo_txid::text || ':' || v_ultimo_seq::text END,
    'mais', v_total = v_limite,
    'reset', false);
END;
$$;

-- Limpeza periódica (servidor). Aparelhos com cursor anterior recebem "reset".
CREATE OR REPLACE FUNCTION public.limpar_alteracoes_sync(_dias integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_max xid8;
  v_total integer;
BEGIN
  SELECT max(txid) INTO v_max FROM public.alteracoes_sync WHERE alterado_em < now() - make_interval(days => _dias);
  IF v_max IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.alteracoes_sync WHERE txid <= v_max;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  INSERT INTO app_private.sync_controle (chave, valor) VALUES ('limpo_ate_txid', v_max::text)
  ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION app_private.linha_sync(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.ler_cursor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.linha_sync(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.ler_cursor(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cursor_sync_inicial() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.snapshot_sync(text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.alteracoes_sync(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.limpar_alteracoes_sync(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cursor_sync_inicial() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_sync(text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.alteracoes_sync(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.limpar_alteracoes_sync(integer) TO service_role;

-- Limpeza diária onde há pg_cron (Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'limpar-alteracoes-sync';
    PERFORM cron.schedule('limpar-alteracoes-sync', '17 4 * * *', 'select public.limpar_alteracoes_sync(30)');
  END IF;
END $$;
