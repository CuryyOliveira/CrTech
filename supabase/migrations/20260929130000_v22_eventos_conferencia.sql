-- V2.2/V2.3 — Conferência orientada a EVENTOS, com processamento idempotente no servidor.
--
-- Cada ação feita no aparelho vira um evento com event_id (uuid gerado no aparelho, o
-- mesmo em todas as tentativas). O servidor:
--   * aplica o evento UMA vez (trava por event_id + registro imutável em conferencia_eventos);
--   * devolve o mesmo resultado a qualquer reenvio ("evento já processado");
--   * usa a HORA DO EVENTO no aparelho (com limites) para pausas, retomadas e finalização —
--     nunca a hora em que a sincronização acontece;
--   * detecta conflitos (ex.: item alterado por outro aparelho) e os registra, sem descartar.
--
-- Migration aditiva. NÃO executada na produção.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Versão dos itens (detecção de conflito) — preenchida por trigger
-- ---------------------------------------------------------------------------
ALTER TABLE public.conferencia_itens ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 0;
ALTER TABLE public.conferencia_itens ADD COLUMN IF NOT EXISTS ultimo_dispositivo text;
ALTER TABLE public.conferencia_itens ADD COLUMN IF NOT EXISTS ultimo_evento uuid;

CREATE OR REPLACE FUNCTION app_private.conferencia_itens_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.quantidade_contada IS DISTINCT FROM OLD.quantidade_contada
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.observacoes IS DISTINCT FROM OLD.observacoes
     OR NEW.fotos IS DISTINCT FROM OLD.fotos THEN
    NEW.versao := OLD.versao + 1;
    -- Alterações feitas pela V1 (sem evento) ficam sem dispositivo: contam como "outro aparelho".
    NEW.ultimo_dispositivo := nullif(current_setting('cr.dispositivo', true), '');
    NEW.ultimo_evento := nullif(current_setting('cr.evento_id', true), '')::uuid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conferencia_itens_10_versao ON public.conferencia_itens;
CREATE TRIGGER trg_conferencia_itens_10_versao
  BEFORE UPDATE ON public.conferencia_itens
  FOR EACH ROW EXECUTE FUNCTION app_private.conferencia_itens_versao();

-- ---------------------------------------------------------------------------
-- 2. Tempo de pausa pela hora REAL do evento
--    Ordem de preferência para "agora":
--      a) cr.evento_em  — hora do evento enviada pelo motor da V2;
--      b) ultima_pausa / ultima_retomada informadas pela V1 no próprio UPDATE
--         (hora do aparelho no momento do clique, mesmo que sincronize depois);
--      c) now().
--    Limites: nunca antes do início/da última retomada; nunca mais de 5 min no futuro.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conferencias_tempo_pausa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hora_evento timestamptz := nullif(current_setting('cr.evento_em', true), '')::timestamptz;
  agora timestamptz := coalesce(hora_evento, now());
  limite_futuro timestamptz := now() + interval '5 minutes';
  fim_pausa timestamptz;
BEGIN
  -- Conferência encerrada sem mudança de status nem dos horários: preserva o tempo registrado.
  IF OLD.status IN ('finalizada', 'cancelada', 'concluida') AND NEW.status = OLD.status
     AND NEW.hora_inicio IS NOT DISTINCT FROM OLD.hora_inicio
     AND NEW.hora_fim IS NOT DISTINCT FROM OLD.hora_fim
     AND NEW.total_tempo_pausado IS NOT DISTINCT FROM OLD.total_tempo_pausado THEN
    NEW.tempo_trabalhado := OLD.tempo_trabalhado;
    RETURN NEW;
  END IF;

  NEW.total_tempo_pausado := COALESCE(NEW.total_tempo_pausado, COALESCE(OLD.total_tempo_pausado, 0));
  NEW.quantidade_pausas := COALESCE(NEW.quantidade_pausas, COALESCE(OLD.quantidade_pausas, 0));

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Entrando em pausa.
    IF NEW.status = 'pausada' AND OLD.status <> 'pausada' THEN
      IF hora_evento IS NULL AND NEW.ultima_pausa IS NOT NULL
         AND NEW.ultima_pausa IS DISTINCT FROM OLD.ultima_pausa THEN
        agora := NEW.ultima_pausa;            -- hora informada pelo aparelho (V1)
      END IF;
      agora := least(greatest(agora, coalesce(OLD.ultima_retomada, OLD.hora_inicio)), limite_futuro);
      NEW.ultima_pausa := agora;
      NEW.quantidade_pausas := COALESCE(OLD.quantidade_pausas, 0) + 1;
      INSERT INTO public.conferencia_pausas (conferencia_id, pausada_em) VALUES (NEW.id, agora);

    -- Saindo da pausa (retomada, finalização ou cancelamento).
    ELSIF OLD.status = 'pausada' AND NEW.status <> 'pausada' THEN
      IF hora_evento IS NULL AND NEW.status = 'em_andamento' AND NEW.ultima_retomada IS NOT NULL
         AND NEW.ultima_retomada IS DISTINCT FROM OLD.ultima_retomada THEN
        agora := NEW.ultima_retomada;         -- hora informada pelo aparelho (V1)
      ELSIF hora_evento IS NULL AND NEW.status IN ('finalizada', 'cancelada') AND NEW.hora_fim IS NOT NULL THEN
        agora := NEW.hora_fim;
      END IF;
      fim_pausa := COALESCE(OLD.ultima_pausa, agora);
      agora := least(greatest(agora, fim_pausa), limite_futuro);
      NEW.total_tempo_pausado := COALESCE(OLD.total_tempo_pausado, 0)
        + GREATEST(0, EXTRACT(EPOCH FROM (agora - fim_pausa))::int);
      UPDATE public.conferencia_pausas
         SET retomada_em = agora,
             segundos = GREATEST(0, EXTRACT(EPOCH FROM (agora - pausada_em))::int)
       WHERE conferencia_id = NEW.id AND retomada_em IS NULL;
      NEW.ultima_pausa := NULL;
      IF NEW.status = 'em_andamento' THEN
        NEW.ultima_retomada := agora;
      END IF;
    END IF;
  ELSIF NEW.status = 'pausada' AND NEW.ultima_pausa IS NULL THEN
    -- Autocorreção: conferência pausada sem marca de pausa registrada.
    NEW.ultima_pausa := agora;
    NEW.quantidade_pausas := GREATEST(1, COALESCE(OLD.quantidade_pausas, 0));
    INSERT INTO public.conferencia_pausas (conferencia_id, pausada_em) VALUES (NEW.id, agora);
  END IF;

  IF NEW.status IN ('finalizada', 'cancelada') THEN
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(NEW.hora_fim, agora) - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  ELSIF NEW.status = 'pausada' THEN
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(NEW.ultima_pausa, agora) - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  ELSE
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (agora - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Registro imutável dos eventos recebidos (auditoria da sincronização)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conferencia_eventos (
  event_id uuid PRIMARY KEY,
  conferencia_id uuid NOT NULL,
  unidade_id uuid,
  empresa_id uuid,
  user_id uuid NOT NULL,
  device_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'CONFERENCE_CREATED', 'ITEM_COUNTED', 'MATERIAL_ADDED', 'CONFERENCE_PAUSED',
    'CONFERENCE_RESUMED', 'SIGNATURE_ADDED', 'CONFERENCE_FINALIZED', 'CONFERENCE_CANCELLED',
    'PHOTO_ADDED')),
  schema_version integer NOT NULL DEFAULT 1,
  created_at_device timestamptz,          -- hora informada pelo aparelho (bruta)
  hora_aplicada timestamptz,              -- hora usada no processamento (após limites)
  received_at_server timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,  -- sem imagens (apenas hash e tamanho)
  status text NOT NULL CHECK (status IN ('aplicado', 'conflito', 'rejeitado')),
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS conferencia_eventos_conferencia_idx
  ON public.conferencia_eventos (conferencia_id, received_at_server);
CREATE INDEX IF NOT EXISTS conferencia_eventos_status_idx
  ON public.conferencia_eventos (status) WHERE status <> 'aplicado';

ALTER TABLE public.conferencia_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY conferencia_eventos_select ON public.conferencia_eventos
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (unidade_id IS NOT NULL AND app_private.pode_unidade(unidade_id))
         OR app_private.eh_global(auth.uid()));
-- Sem INSERT/UPDATE/DELETE para usuários: só o processamento grava (função abaixo).
REVOKE ALL ON public.conferencia_eventos FROM anon, authenticated;
GRANT SELECT ON public.conferencia_eventos TO authenticated;
GRANT ALL ON public.conferencia_eventos TO service_role;

CREATE OR REPLACE FUNCTION app_private.registrar_evento(
  _event_id uuid, _conferencia_id uuid, _event_type text, _device_id text,
  _created_at_device timestamptz, _hora_aplicada timestamptz, _payload jsonb,
  _schema_version integer, _status text, _resultado jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_unidade uuid;
  v_empresa uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  SELECT c.unidade_id, u.empresa_id INTO v_unidade, v_empresa
    FROM public.conferencias c JOIN public.unidades u ON u.id = c.unidade_id
   WHERE c.id = _conferencia_id;
  IF v_unidade IS NULL AND _event_type = 'CONFERENCE_CREATED' THEN
    v_unidade := nullif(_payload->>'unidade_id', '')::uuid;
    SELECT empresa_id INTO v_empresa FROM public.unidades WHERE id = v_unidade;
  END IF;
  INSERT INTO public.conferencia_eventos
    (event_id, conferencia_id, unidade_id, empresa_id, user_id, device_id, event_type,
     schema_version, created_at_device, hora_aplicada, payload, status, resultado)
  VALUES (_event_id, _conferencia_id, v_unidade, v_empresa, auth.uid(), _device_id, _event_type,
          _schema_version, _created_at_device, _hora_aplicada, _payload, _status, _resultado);
END;
$$;
-- Chamada apenas por processar_evento_conferencia (app_private não é exposto pela API).
REVOKE ALL ON FUNCTION app_private.registrar_evento(uuid, uuid, text, text, timestamptz, timestamptz, jsonb, integer, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.registrar_evento(uuid, uuid, text, text, timestamptz, timestamptz, jsonb, integer, text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Fotos (arquivos no Supabase Storage; aqui só os metadados confirmados)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conferencia_fotos (
  id uuid PRIMARY KEY,                              -- gerado no aparelho
  conferencia_id uuid NOT NULL REFERENCES public.conferencias(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.conferencia_itens(id) ON DELETE SET NULL,
  empresa_id uuid,
  caminho text NOT NULL UNIQUE,                     -- <empresa>/<conferencia>/<foto>.<ext> no bucket "conferencias"
  mime text,
  bytes integer,
  largura integer,
  altura integer,
  evento_id uuid,
  enviado_por uuid NOT NULL DEFAULT auth.uid(),
  capturada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conferencia_fotos_conferencia_idx ON public.conferencia_fotos (conferencia_id);

ALTER TABLE public.conferencia_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY conferencia_fotos_select ON public.conferencia_fotos AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conferencias c
                  WHERE c.id = conferencia_fotos.conferencia_id AND app_private.pode_unidade(c.unidade_id)));
CREATE POLICY conferencia_fotos_insert ON public.conferencia_fotos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (enviado_por = auth.uid() AND app_private.pode_operar(auth.uid())
              AND EXISTS (SELECT 1 FROM public.conferencias c
                           WHERE c.id = conferencia_fotos.conferencia_id AND app_private.pode_unidade(c.unidade_id)));
REVOKE ALL ON public.conferencia_fotos FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.conferencia_fotos FROM authenticated;
GRANT SELECT, INSERT ON public.conferencia_fotos TO authenticated;
GRANT ALL ON public.conferencia_fotos TO service_role;

CREATE OR REPLACE FUNCTION app_private.conferencia_fotos_integridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
BEGIN
  IF app_private.alteracao_privilegiada() THEN
    RETURN NEW;
  END IF;
  IF app_private.conferencia_encerrada(app_private.status_conferencia(NEW.conferencia_id)) THEN
    RAISE EXCEPTION 'Não é possível anexar fotos a uma conferência encerrada.' USING ERRCODE = 'CR004';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_conferencia_fotos_00_integridade ON public.conferencia_fotos;
CREATE TRIGGER trg_conferencia_fotos_00_integridade
  BEFORE INSERT ON public.conferencia_fotos
  FOR EACH ROW EXECUTE FUNCTION app_private.conferencia_fotos_integridade();

-- Caminho de foto permitido para o usuário: <empresa_id>/<conferencia_id>/<arquivo>
CREATE OR REPLACE FUNCTION app_private.pode_caminho_foto(_caminho text, _gravar boolean)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT CASE
    WHEN _caminho !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.conferencias c
        JOIN public.unidades u ON u.id = c.unidade_id
       WHERE c.id = split_part(_caminho, '/', 2)::uuid
         AND u.empresa_id = split_part(_caminho, '/', 1)::uuid
         AND app_private.pode_unidade(c.unidade_id)
         AND (NOT _gravar OR app_private.pode_operar(auth.uid()))
    )
  END
$$;
REVOKE ALL ON FUNCTION app_private.pode_caminho_foto(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.pode_caminho_foto(text, boolean) TO authenticated, service_role;

-- Bucket privado e policies do Storage (só onde o schema storage existe: Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage')
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'storage' AND c.relname = 'objects') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('conferencias', 'conferencias', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO NOTHING;
    EXECUTE 'DROP POLICY IF EXISTS cr_conferencias_fotos_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS cr_conferencias_fotos_select ON storage.objects';
    EXECUTE $p$CREATE POLICY cr_conferencias_fotos_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'conferencias' AND app_private.pode_caminho_foto(name, true))$p$;
    EXECUTE $p$CREATE POLICY cr_conferencias_fotos_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'conferencias' AND app_private.pode_caminho_foto(name, false))$p$;
    -- Sem UPDATE/DELETE: arquivo de conferência é imutável para usuários.
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Processamento dos eventos
-- ---------------------------------------------------------------------------

-- Hora do evento usada no processamento: a do aparelho, limitada a um intervalo plausível.
CREATE OR REPLACE FUNCTION app_private.hora_evento(_bruta text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  t timestamptz;
BEGIN
  BEGIN
    t := nullif(_bruta, '')::timestamptz;
  EXCEPTION WHEN others THEN
    t := NULL;
  END;
  IF t IS NULL OR t > now() + interval '5 minutes' THEN
    RETURN now();   -- sem hora válida ou relógio adiantado
  END IF;
  RETURN t;
END;
$$;

-- Estado atual da conferência no servidor (devolvido junto de conflitos e recusas).
CREATE OR REPLACE FUNCTION app_private.estado_conferencia(_conferencia_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'status', c.status, 'hora_inicio', c.hora_inicio, 'hora_fim', c.hora_fim,
    'ultima_pausa', c.ultima_pausa, 'total_tempo_pausado', c.total_tempo_pausado,
    'quantidade_pausas', c.quantidade_pausas, 'tempo_trabalhado', c.tempo_trabalhado,
    'tem_assinatura', c.assinatura IS NOT NULL)
    FROM public.conferencias c WHERE c.id = _conferencia_id
$$;

CREATE OR REPLACE FUNCTION app_private.item_do_evento(_conferencia_id uuid, _payload jsonb)
RETURNS public.conferencia_itens
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  i public.conferencia_itens;
BEGIN
  IF nullif(_payload->>'item_id', '') IS NOT NULL THEN
    SELECT * INTO i FROM public.conferencia_itens
     WHERE id = (_payload->>'item_id')::uuid AND conferencia_id = _conferencia_id FOR UPDATE;
  ELSIF nullif(_payload->>'material_id', '') IS NOT NULL THEN
    SELECT * INTO i FROM public.conferencia_itens
     WHERE conferencia_id = _conferencia_id AND material_id = (_payload->>'material_id')::uuid FOR UPDATE;
  END IF;
  RETURN i;
END;
$$;

-- Garante que a conferência existe; se não existir distingue "ainda não chegou" (CR010,
-- não registrado: o aparelho reenviará) de "foi excluída no servidor" (CR016, registrado).
CREATE OR REPLACE FUNCTION app_private.exigir_conferencia(_conferencia_id uuid)
RETURNS public.conferencias
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  c public.conferencias;
BEGIN
  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.conferencia_eventos
                WHERE conferencia_id = _conferencia_id AND event_type = 'CONFERENCE_CREATED'
                  AND status = 'aplicado') THEN
      RAISE EXCEPTION 'A conferência foi excluída no servidor.' USING ERRCODE = 'CR016';
    END IF;
    RAISE EXCEPTION 'Conferência ainda não sincronizada ou sem acesso.' USING ERRCODE = 'CR010';
  END IF;
  RETURN c;
END;
$$;

-- Aplica UM evento (SECURITY INVOKER: RLS e regras de integridade da Fase 0 valem).
CREATE OR REPLACE FUNCTION app_private.aplicar_evento(
  _tipo text, _conferencia_id uuid, _payload jsonb, _quando timestamptz, _dispositivo text, _event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  c public.conferencias;
  i public.conferencia_itens;
  r jsonb;
  v_qtd numeric;
  v_status_item text;
  v_quando timestamptz := _quando;
  v_assinatura text;
BEGIN
  CASE _tipo

  WHEN 'CONFERENCE_CREATED' THEN
    r := public.iniciar_conferencia(
      _conferencia_id,
      nullif(_payload->>'unidade_id', '')::uuid,
      (_payload - 'unidade_id') || jsonb_build_object('hora_inicio', v_quando, 'ocorrido_em', v_quando),
      _event_id);
    IF coalesce((r->>'reaproveitada')::boolean, false) THEN
      RAISE EXCEPTION 'Já existe outra conferência aberta nesta lista (%).', r->>'conferencia_id'
        USING ERRCODE = 'CR015';
    END IF;
    RETURN jsonb_build_object('status', 'aplicado', 'conferencia_id', _conferencia_id,
                              'itens', r->'itens', 'repetida', coalesce((r->>'repetida')::boolean, false));

  WHEN 'ITEM_COUNTED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    i := app_private.item_do_evento(_conferencia_id, _payload);
    IF i.id IS NULL THEN
      RAISE EXCEPTION 'O item não faz parte desta conferência no servidor.' USING ERRCODE = 'CR017';
    END IF;
    -- Conflito: o item mudou no servidor, por OUTRO aparelho, depois da versão que este aparelho viu.
    IF NOT coalesce((_payload->>'forcar')::boolean, false)
       AND i.versao > coalesce((_payload->>'versao_base')::int, 0)
       AND i.ultimo_dispositivo IS DISTINCT FROM _dispositivo THEN
      RETURN jsonb_build_object('status', 'conflito', 'motivo', 'item_alterado_no_servidor',
        'item_id', i.id,
        'estado_servidor', jsonb_build_object(
          'quantidade_contada', i.quantidade_contada, 'observacoes', i.observacoes,
          'status', i.status, 'versao', i.versao, 'atualizado_em', i.updated_at,
          'ultimo_dispositivo', i.ultimo_dispositivo));
    END IF;
    v_qtd := CASE WHEN _payload ? 'quantidade' AND _payload->'quantidade' <> 'null'::jsonb
                  THEN (_payload->>'quantidade')::numeric END;
    v_status_item := CASE WHEN v_qtd IS NULL THEN 'pendente'
                          WHEN v_qtd = i.quantidade_esperada THEN 'conferido'
                          ELSE 'divergencia' END;
    UPDATE public.conferencia_itens SET
      quantidade_contada = v_qtd,
      status = v_status_item,
      observacoes = CASE WHEN _payload ? 'observacoes' THEN _payload->>'observacoes' ELSE observacoes END,
      updated_at = v_quando
    WHERE id = i.id
    RETURNING * INTO i;
    RETURN jsonb_build_object('status', 'aplicado', 'item_id', i.id, 'versao', i.versao,
                              'status_item', i.status);

  WHEN 'MATERIAL_ADDED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    r := public.adicionar_item_conferencia(
      nullif(_payload->>'item_id', '')::uuid, _conferencia_id,
      _payload || jsonb_build_object('ocorrido_em', v_quando), _event_id);
    RETURN jsonb_build_object('status', 'aplicado', 'item_id', r->>'item_id',
                              'status_item', r->>'status', 'repetida', coalesce((r->>'repetida')::boolean, false));

  WHEN 'CONFERENCE_PAUSED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    IF app_private.conferencia_encerrada(c.status) THEN
      RAISE EXCEPTION 'Conferência encerrada (%).', c.status USING ERRCODE = 'CR002';
    END IF;
    IF c.status = 'pausada' THEN
      RETURN jsonb_build_object('status', 'aplicado', 'sem_efeito', 'ja_pausada');
    END IF;
    UPDATE public.conferencias SET status = 'pausada' WHERE id = c.id RETURNING * INTO c;
    RETURN jsonb_build_object('status', 'aplicado', 'pausada_em', c.ultima_pausa,
                              'tempo_trabalhado', c.tempo_trabalhado);

  WHEN 'CONFERENCE_RESUMED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    IF app_private.conferencia_encerrada(c.status) THEN
      RAISE EXCEPTION 'Conferência encerrada (%).', c.status USING ERRCODE = 'CR002';
    END IF;
    IF c.status = 'em_andamento' THEN
      RETURN jsonb_build_object('status', 'aplicado', 'sem_efeito', 'ja_em_andamento');
    END IF;
    UPDATE public.conferencias SET status = 'em_andamento' WHERE id = c.id RETURNING * INTO c;
    RETURN jsonb_build_object('status', 'aplicado', 'total_tempo_pausado', c.total_tempo_pausado,
                              'tempo_trabalhado', c.tempo_trabalhado);

  WHEN 'SIGNATURE_ADDED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    v_assinatura := _payload->>'imagem';
    IF v_assinatura IS NULL OR v_assinatura !~ '^data:image/(png|jpeg|webp);base64,'
       OR length(v_assinatura) > 700000 THEN
      RAISE EXCEPTION 'Assinatura inválida.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(_payload->>'tipo', 'conferente') = 'gestor' THEN
      UPDATE public.conferencias SET assinatura_gestor = v_assinatura WHERE id = c.id;
    ELSE
      UPDATE public.conferencias SET assinatura = v_assinatura WHERE id = c.id;
    END IF;
    RETURN jsonb_build_object('status', 'aplicado', 'tipo', coalesce(_payload->>'tipo', 'conferente'));

  WHEN 'CONFERENCE_FINALIZED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    IF c.status = 'finalizada' THEN
      RETURN jsonb_build_object('status', 'aplicado', 'sem_efeito', 'ja_finalizada',
                                'hora_fim', c.hora_fim, 'tempo_trabalhado', c.tempo_trabalhado);
    END IF;
    r := public.finalizar_conferencia(
      _conferencia_id,
      _payload || jsonb_build_object(
        'assinatura', coalesce(nullif(_payload->>'assinatura', ''), c.assinatura),
        'assinatura_gestor', coalesce(nullif(_payload->>'assinatura_gestor', ''), c.assinatura_gestor),
        'hora_fim', v_quando, 'ocorrido_em', v_quando),
      _event_id);
    RETURN jsonb_build_object('status', 'aplicado', 'tempo_trabalhado', r->'tempo_trabalhado');

  WHEN 'CONFERENCE_CANCELLED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    IF c.status = 'cancelada' THEN
      RETURN jsonb_build_object('status', 'aplicado', 'sem_efeito', 'ja_cancelada');
    END IF;
    IF app_private.conferencia_encerrada(c.status) THEN
      RAISE EXCEPTION 'Conferência finalizada não pode ser cancelada.' USING ERRCODE = 'CR008';
    END IF;
    IF length(btrim(coalesce(_payload->>'motivo', ''))) < 3 THEN
      RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = 'CR007';
    END IF;
    UPDATE public.conferencias
       SET status = 'cancelada', hora_fim = v_quando, motivo_cancelamento = btrim(_payload->>'motivo')
     WHERE id = c.id RETURNING * INTO c;
    RETURN jsonb_build_object('status', 'aplicado', 'hora_fim', c.hora_fim);

  WHEN 'PHOTO_ADDED' THEN
    c := app_private.exigir_conferencia(_conferencia_id);
    IF NOT app_private.pode_caminho_foto(_payload->>'caminho', true)
       OR split_part(_payload->>'caminho', '/', 2)::uuid <> _conferencia_id THEN
      RAISE EXCEPTION 'Caminho de foto inválido para esta conferência.' USING ERRCODE = '42501';
    END IF;
    i := app_private.item_do_evento(_conferencia_id, _payload);
    INSERT INTO public.conferencia_fotos
      (id, conferencia_id, item_id, empresa_id, caminho, mime, bytes, largura, altura, evento_id, capturada_em)
    VALUES (
      (_payload->>'foto_id')::uuid, _conferencia_id, i.id,
      split_part(_payload->>'caminho', '/', 1)::uuid, _payload->>'caminho',
      _payload->>'mime', (_payload->>'bytes')::int, (_payload->>'largura')::int,
      (_payload->>'altura')::int, _event_id, v_quando)
    ON CONFLICT (id) DO NOTHING;
    RETURN jsonb_build_object('status', 'aplicado', 'foto_id', _payload->>'foto_id', 'item_id', i.id);

  ELSE
    RAISE EXCEPTION 'Tipo de evento desconhecido: %', _tipo USING ERRCODE = '22023';
  END CASE;
END;
$$;

-- Processa UM evento de forma idempotente. Reenvios do mesmo event_id devolvem o
-- resultado já registrado, sem aplicar de novo.
CREATE OR REPLACE FUNCTION public.processar_evento_conferencia(_evento jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_id uuid;
  v_tipo text := _evento->>'event_type';
  v_conf uuid;
  v_disp text := left(coalesce(_evento->>'device_id', ''), 100);
  v_payload jsonb := coalesce(_evento->'payload', '{}'::jsonb);
  v_versao integer := coalesce((_evento->>'schema_version')::int, 1);
  v_bruta timestamptz;
  v_quando timestamptz;
  v_existente public.conferencia_eventos;
  v_res jsonb;
  v_status text;
  v_codigo text;
  v_msg text;
  v_registro jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_id := (_evento->>'event_id')::uuid;
    v_conf := (_evento->>'conference_id')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Evento malformado (event_id/conference_id)' USING ERRCODE = '22023';
  END;
  IF v_id IS NULL OR v_conf IS NULL OR v_tipo IS NULL THEN
    RAISE EXCEPTION 'Evento malformado' USING ERRCODE = '22023';
  END IF;
  IF v_versao <> 1 THEN
    RAISE EXCEPTION 'Versão de evento não suportada: %', v_versao USING ERRCODE = '22023';
  END IF;

  -- Um mesmo event_id é processado por uma transação de cada vez: reenvios simultâneos
  -- (ex.: resposta lenta + nova tentativa) esperam aqui e depois recebem o resultado registrado.
  PERFORM pg_advisory_xact_lock(hashtextextended('cr.evento:' || v_id::text, 0));

  SELECT * INTO v_existente FROM public.conferencia_eventos WHERE event_id = v_id;
  IF FOUND THEN
    IF v_existente.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'event_id já utilizado por outro usuário' USING ERRCODE = '42501';
    END IF;
    RETURN v_existente.resultado || jsonb_build_object(
      'event_id', v_id, 'duplicado', true, 'status', v_existente.status,
      'recebido_em', v_existente.received_at_server, 'txid', pg_current_xact_id()::text);
  END IF;

  BEGIN
    v_bruta := nullif(_evento->>'created_at_device', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_bruta := NULL;
  END;
  v_quando := app_private.hora_evento(_evento->>'created_at_device');

  PERFORM set_config('cr.evento_em', v_quando::text, true);
  PERFORM set_config('cr.dispositivo', v_disp, true);
  PERFORM set_config('cr.evento_id', v_id::text, true);
  BEGIN
    v_res := app_private.aplicar_evento(v_tipo, v_conf, v_payload, v_quando, v_disp, v_id);
    v_status := coalesce(v_res->>'status', 'aplicado');
  EXCEPTION
    -- Falhas transitórias ou dependência ainda não sincronizada: NÃO registra; o aparelho reenvia.
    WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled THEN
      PERFORM set_config('cr.evento_em', '', true);
      RAISE;
    WHEN SQLSTATE 'CR010' THEN
      PERFORM set_config('cr.evento_em', '', true);
      RAISE;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_codigo = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      v_status := CASE WHEN v_codigo IN ('CR002', 'CR004', 'CR006', 'CR008', 'CR012', 'CR013',
                                         'CR014', 'CR015', 'CR016', 'CR017', '23505')
                       THEN 'conflito' ELSE 'rejeitado' END;
      v_res := jsonb_build_object('status', v_status, 'erro_codigo', v_codigo, 'erro_mensagem', v_msg,
                                  'estado_servidor', app_private.estado_conferencia(v_conf));
  END;
  PERFORM set_config('cr.evento_em', '', true);
  PERFORM set_config('cr.dispositivo', '', true);
  PERFORM set_config('cr.evento_id', '', true);

  -- O registro guarda o payload sem as imagens (apenas hash e tamanho).
  v_registro := v_payload;
  IF v_registro ? 'imagem' THEN
    v_registro := (v_registro - 'imagem') || jsonb_build_object(
      'imagem_sha256', encode(extensions.digest(v_payload->>'imagem', 'sha256'), 'hex'),
      'imagem_bytes', length(v_payload->>'imagem'));
  END IF;
  IF v_registro ? 'assinatura' THEN
    v_registro := (v_registro - 'assinatura') || jsonb_build_object(
      'assinatura_sha256', encode(extensions.digest(v_payload->>'assinatura', 'sha256'), 'hex'));
  END IF;

  PERFORM app_private.registrar_evento(v_id, v_conf, v_tipo, nullif(v_disp, ''), v_bruta, v_quando,
                                       v_registro, v_versao, v_status, v_res);
  -- txid: o aparelho sabe que o efeito já chegou pelo pull quando a marca d'água passar dele.
  RETURN v_res || jsonb_build_object('event_id', v_id, 'duplicado', false, 'status', v_status,
                                     'txid', pg_current_xact_id()::text);
END;
$$;

-- Processa um LOTE, na ordem recebida. Cada evento é independente (subtransação).
-- Uma falha transitória interrompe o lote: os eventos seguintes voltam como
-- "tentar_novamente" (não registrados) e o aparelho os reenviará.
CREATE OR REPLACE FUNCTION public.processar_eventos_conferencia(_eventos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  e jsonb;
  resultados jsonb := '[]'::jsonb;
  interromper boolean := false;
  v_codigo text;
  v_msg text;
BEGIN
  IF jsonb_typeof(_eventos) <> 'array' OR jsonb_array_length(_eventos) > 200 THEN
    RAISE EXCEPTION 'Envie de 1 a 200 eventos por lote' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(_eventos) LOOP
    IF interromper THEN
      resultados := resultados || jsonb_build_array(jsonb_build_object(
        'event_id', e->>'event_id', 'status', 'tentar_novamente', 'erro_codigo', 'LOTE_INTERROMPIDO'));
      CONTINUE;
    END IF;
    BEGIN
      resultados := resultados || jsonb_build_array(public.processar_evento_conferencia(e));
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_codigo = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      resultados := resultados || jsonb_build_array(jsonb_build_object(
        'event_id', e->>'event_id',
        'status', CASE WHEN v_codigo IN ('22023', '42501') THEN 'rejeitado' ELSE 'tentar_novamente' END,
        'erro_codigo', v_codigo, 'erro_mensagem', v_msg));
      -- Dependência ausente ou falha transitória: não processa o restante do lote agora
      -- (preserva a ordem por conferência).
      IF v_codigo NOT IN ('22023', '42501') THEN
        interromper := true;
      END IF;
    END;
  END LOOP;
  RETURN resultados;
END;
$$;

REVOKE ALL ON FUNCTION app_private.hora_evento(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.estado_conferencia(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.item_do_evento(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.exigir_conferencia(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.aplicar_evento(text, uuid, jsonb, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.conferencia_itens_versao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.hora_evento(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.estado_conferencia(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.item_do_evento(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.exigir_conferencia(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.aplicar_evento(text, uuid, jsonb, timestamptz, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.processar_evento_conferencia(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.processar_eventos_conferencia(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processar_evento_conferencia(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.processar_eventos_conferencia(jsonb) TO authenticated, service_role;
