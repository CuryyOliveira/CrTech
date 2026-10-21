-- FASE 0 — Integridade da conferência no banco (não depende do frontend).
--
-- Definições:
--   * Conferência ABERTA    = status 'em_andamento' ou 'pausada'.
--   * Conferência ENCERRADA = status 'finalizada', 'cancelada' ou 'concluida'
--                             ('concluida' é um status legado: 1 registro em produção).
--
-- Regras:
--   1. No máximo UMA conferência aberta por lista (unidade).
--   2. Conferência encerrada é imutável para usuários (API com token do usuário):
--      não pode ser alterada, reaberta nem excluída; seus itens também não.
--      Repetir a mesma finalização/cancelamento é aceito sem efeito (idempotente).
--   3. Transições válidas: em_andamento ⇄ pausada; aberta → finalizada | cancelada.
--      Cancelada não vira finalizada; finalizada não vira cancelada.
--   4. Finalizar exige assinatura do conferente; encerrar sempre registra hora_fim.
--   5. Operações administrativas explícitas (reabrir/excluir, por RPC com motivo) e
--      rotinas do servidor (service_role) são permitidas e ficam AUDITADAS.
--
-- Os dados atuais de produção já cumprem todas as restrições (verificado em 29/09/2026:
-- 0 violações; 0 listas com mais de uma conferência aberta).

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Estrutura aditiva
-- ---------------------------------------------------------------------------
ALTER TABLE public.conferencias ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

ALTER TABLE public.conferencias
  ADD CONSTRAINT conferencias_status_valido
  CHECK (status IN ('em_andamento', 'pausada', 'finalizada', 'cancelada', 'concluida'));

ALTER TABLE public.conferencias
  ADD CONSTRAINT conferencias_encerrada_tem_hora_fim
  CHECK (status NOT IN ('finalizada', 'cancelada', 'concluida') OR hora_fim IS NOT NULL);

ALTER TABLE public.conferencia_itens
  ADD CONSTRAINT conferencia_itens_status_valido
  CHECK (status IN ('pendente', 'conferido', 'divergencia'));

ALTER TABLE public.conferencia_itens
  ADD CONSTRAINT conferencia_itens_origem_valida
  CHECK (origem IN ('lista', 'adicionado'));

-- Status coerente com as quantidades (mesma regra usada pela tela desde a V1).
ALTER TABLE public.conferencia_itens
  ADD CONSTRAINT conferencia_itens_status_coerente
  CHECK (
    (quantidade_contada IS NULL AND status = 'pendente')
    OR (quantidade_contada IS NOT NULL AND status <> 'pendente'
        AND (status = 'conferido') = (quantidade_contada = quantidade_esperada))
  );

ALTER TABLE public.conferencia_itens
  ADD CONSTRAINT conferencia_itens_contagem_nao_negativa
  CHECK (quantidade_contada IS NULL OR quantidade_contada >= 0);

-- Regra 1: uma conferência aberta por lista.
CREATE UNIQUE INDEX IF NOT EXISTS conferencias_uma_aberta_por_unidade
  ON public.conferencias (unidade_id)
  WHERE status IN ('em_andamento', 'pausada');

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.conferencia_encerrada(_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _status IN ('finalizada', 'cancelada', 'concluida')
$$;

-- Quem está alterando é um usuário final (token da API) ou o servidor/banco?
-- Usuário final = papéis authenticated/anon. Tudo o mais (service_role, funções
-- SECURITY DEFINER do próprio banco, exclusões em cascata) é confiável e auditado.
CREATE OR REPLACE FUNCTION app_private.alteracao_privilegiada()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user NOT IN ('authenticated', 'anon')
$$;

-- Status da conferência sem depender da RLS de quem chama.
CREATE OR REPLACE FUNCTION app_private.status_conferencia(_conferencia_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT status FROM public.conferencias WHERE id = _conferencia_id
$$;

CREATE OR REPLACE FUNCTION app_private.unidade_tem_conferencia_encerrada(_unidade_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conferencias
     WHERE unidade_id = _unidade_id AND app_private.conferencia_encerrada(status)
  )
$$;

-- Registro de auditoria gerado pelo próprio banco (não depende do cliente).
CREATE OR REPLACE FUNCTION app_private.auditar_conferencia(_acao text, _tipo text, _c public.conferencias)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.auditoria (user_id, usuario, acao, detalhe, tipo_acao, resultado, lista)
  VALUES (
    auth.uid(),
    coalesce(auth.email(), current_user::text),
    _acao,
    format('Conferência %s (status %s, data %s, início %s) — por %s. Motivo: %s',
           _c.id, _c.status, _c.data, _c.hora_inicio,
           CASE WHEN auth.uid() IS NULL THEN current_user::text ELSE 'usuário ' || auth.uid()::text END,
           coalesce(nullif(current_setting('cr.motivo', true), ''), 'não informado')),
    _tipo,
    'sucesso',
    (SELECT nome FROM public.unidades WHERE id = _c.unidade_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.status_conferencia(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.unidade_tem_conferencia_encerrada(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.auditar_conferencia(text, text, public.conferencias) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.status_conferencia(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.unidade_tem_conferencia_encerrada(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.auditar_conferencia(text, text, public.conferencias) TO service_role;

-- ---------------------------------------------------------------------------
-- Trigger: conferencias
-- (SECURITY INVOKER de propósito: precisa enxergar quem chama em current_user.)
-- O nome começa com "trg_conferencias_00" para rodar ANTES do cálculo de tempo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.conferencias_integridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  privilegiada boolean := app_private.alteracao_privilegiada();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_private.conferencia_encerrada(OLD.status) THEN
      IF NOT privilegiada THEN
        RAISE EXCEPTION 'Conferência encerrada (%) não pode ser excluída. Somente um administrador pode excluí-la, informando o motivo.', OLD.status
          USING ERRCODE = 'CR002', HINT = 'Use a exclusão administrativa (excluir_conferencia).';
      END IF;
      PERFORM app_private.auditar_conferencia('conferencia_encerrada_excluida', 'administracao', OLD);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT privilegiada AND NEW.status NOT IN ('em_andamento', 'pausada') THEN
      RAISE EXCEPTION 'Uma conferência só pode ser criada em andamento.'
        USING ERRCODE = 'CR001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.unidade_id IS DISTINCT FROM OLD.unidade_id AND NOT privilegiada THEN
    RAISE EXCEPTION 'Não é permitido mover uma conferência para outra lista.'
      USING ERRCODE = 'CR001';
  END IF;

  IF app_private.conferencia_encerrada(OLD.status) THEN
    IF privilegiada THEN
      PERFORM app_private.auditar_conferencia(
        CASE WHEN app_private.conferencia_encerrada(NEW.status)
             THEN 'conferencia_encerrada_alterada' ELSE 'conferencia_reaberta' END,
        'administracao', OLD);
      RETURN NEW;
    END IF;
    -- Repetição da mesma finalização/cancelamento (duplo clique, reenvio offline):
    -- aceita sem alterar nada.
    IF NEW.status = OLD.status
       AND NEW.conferente IS NOT DISTINCT FROM OLD.conferente
       AND NEW.responsavel IS NOT DISTINCT FROM OLD.responsavel
       AND NEW.almoxarife IS NOT DISTINCT FROM OLD.almoxarife
       AND NEW.codigo_almoxarife IS NOT DISTINCT FROM OLD.codigo_almoxarife
       AND NEW.assinatura IS NOT DISTINCT FROM OLD.assinatura
       AND NEW.assinatura_gestor IS NOT DISTINCT FROM OLD.assinatura_gestor
       AND NEW.observacoes IS NOT DISTINCT FROM OLD.observacoes
       AND NEW.motivo_cancelamento IS NOT DISTINCT FROM OLD.motivo_cancelamento
       AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
       AND NEW.data IS NOT DISTINCT FROM OLD.data
       AND NEW.hora_inicio IS NOT DISTINCT FROM OLD.hora_inicio
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN
      RETURN OLD;
    END IF;
    IF OLD.status = 'cancelada' AND NEW.status = 'finalizada' THEN
      RAISE EXCEPTION 'Conferência cancelada não pode ser finalizada.'
        USING ERRCODE = 'CR006';
    END IF;
    RAISE EXCEPTION 'Conferência encerrada (%) não pode ser alterada. Somente um administrador pode reabri-la, informando o motivo.', OLD.status
      USING ERRCODE = 'CR002', HINT = 'Use a reabertura administrativa (reabrir_conferencia).';
  END IF;

  -- Conferência aberta: transições válidas.
  IF NOT privilegiada AND NEW.status NOT IN ('em_andamento', 'pausada', 'finalizada', 'cancelada') THEN
    RAISE EXCEPTION 'Status de conferência inválido: %', NEW.status USING ERRCODE = 'CR001';
  END IF;

  IF NEW.status = 'finalizada' THEN
    IF NOT privilegiada AND coalesce(btrim(NEW.assinatura), '') = '' THEN
      RAISE EXCEPTION 'A assinatura do conferente é obrigatória para finalizar.'
        USING ERRCODE = 'CR003';
    END IF;
    NEW.hora_fim := coalesce(NEW.hora_fim, now());
  ELSIF NEW.status = 'cancelada' THEN
    NEW.hora_fim := coalesce(NEW.hora_fim, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conferencias_00_integridade ON public.conferencias;
CREATE TRIGGER trg_conferencias_00_integridade
  BEFORE INSERT OR UPDATE OR DELETE ON public.conferencias
  FOR EACH ROW EXECUTE FUNCTION app_private.conferencias_integridade();


-- ---------------------------------------------------------------------------
-- Cálculo de tempo: igual à produção, mas não recalcula conferência encerrada
-- quando nada que afete o tempo mudou.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conferencias_tempo_pausa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  agora timestamptz := now();
  fim_pausa timestamptz;
BEGIN
  -- Conferência encerrada sem mudança de status nem dos horários: preserva o tempo
  -- registrado no encerramento (antes era recalculado a cada UPDATE, inclusive numa
  -- finalização repetida, alterando silenciosamente o histórico).
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
    -- Entrando em pausa: congela o cronômetro e abre um período de pausa.
    IF NEW.status = 'pausada' AND OLD.status <> 'pausada' THEN
      NEW.ultima_pausa := agora;
      NEW.quantidade_pausas := COALESCE(OLD.quantidade_pausas, 0) + 1;
      INSERT INTO public.conferencia_pausas (conferencia_id, pausada_em) VALUES (NEW.id, agora);

    -- Saindo da pausa: fecha o período e acumula o tempo pausado.
    ELSIF OLD.status = 'pausada' AND NEW.status <> 'pausada' THEN
      fim_pausa := COALESCE(OLD.ultima_pausa, agora);
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

  IF NEW.status IN ('finalizada','cancelada') THEN
    NEW.tempo_trabalhado := GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(NEW.hora_fim, agora) - NEW.hora_inicio))::int
        - COALESCE(NEW.total_tempo_pausado, 0)
    );
  ELSIF NEW.status = 'pausada' THEN
    -- Congelado no instante da pausa: nada é somado enquanto pausada.
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
-- Trigger: conferencia_itens — itens de conferência encerrada são imutáveis
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.conferencia_itens_integridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  alvo uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.conferencia_id ELSE NEW.conferencia_id END;
BEGIN
  IF app_private.alteracao_privilegiada() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.conferencia_id IS DISTINCT FROM OLD.conferencia_id THEN
    RAISE EXCEPTION 'Não é permitido mover um item para outra conferência.' USING ERRCODE = 'CR004';
  END IF;

  IF app_private.conferencia_encerrada(app_private.status_conferencia(alvo)) THEN
    RAISE EXCEPTION 'Os itens de uma conferência encerrada não podem ser alterados.'
      USING ERRCODE = 'CR004';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_conferencia_itens_00_integridade ON public.conferencia_itens;
CREATE TRIGGER trg_conferencia_itens_00_integridade
  BEFORE INSERT OR UPDATE OR DELETE ON public.conferencia_itens
  FOR EACH ROW EXECUTE FUNCTION app_private.conferencia_itens_integridade();

-- ---------------------------------------------------------------------------
-- Trigger: unidades — excluir uma lista apagaria (em cascata) conferências encerradas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.unidades_protege_historico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app_private'
AS $$
BEGIN
  IF NOT app_private.alteracao_privilegiada()
     AND app_private.unidade_tem_conferencia_encerrada(OLD.id) THEN
    RAISE EXCEPTION 'Esta lista possui conferências encerradas no histórico e não pode ser excluída. Somente um administrador pode excluí-la, informando o motivo.'
      USING ERRCODE = 'CR005', HINT = 'Use a exclusão administrativa (excluir_unidade).';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unidades_00_protege_historico ON public.unidades;
CREATE TRIGGER trg_unidades_00_protege_historico
  BEFORE DELETE ON public.unidades
  FOR EACH ROW EXECUTE FUNCTION app_private.unidades_protege_historico();

-- ---------------------------------------------------------------------------
-- Operações administrativas explícitas e auditadas (nível ≥ 4 com acesso à lista)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.exigir_admin_com_motivo(_unidade_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF NOT app_private.eh_administrador(auth.uid()) THEN
    RAISE EXCEPTION 'Somente administradores podem executar esta operação.' USING ERRCODE = '42501';
  END IF;
  IF _unidade_id IS NULL OR NOT app_private.pode_unidade(_unidade_id) THEN
    RAISE EXCEPTION 'Lista não encontrada ou sem acesso.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).' USING ERRCODE = 'CR007';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reabrir_conferencia(_conferencia_id uuid, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  c public.conferencias;
BEGIN
  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conferência não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM app_private.exigir_admin_com_motivo(c.unidade_id, _motivo);
  IF NOT app_private.conferencia_encerrada(c.status) THEN
    RAISE EXCEPTION 'A conferência não está encerrada.' USING ERRCODE = 'CR001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conferencias
              WHERE unidade_id = c.unidade_id AND status IN ('em_andamento', 'pausada')) THEN
    RAISE EXCEPTION 'Já existe uma conferência aberta nesta lista.' USING ERRCODE = 'CR014';
  END IF;
  PERFORM set_config('cr.motivo', btrim(_motivo), true);
  UPDATE public.conferencias SET status = 'em_andamento', hora_fim = NULL WHERE id = c.id;
  PERFORM set_config('cr.motivo', '', true);
  RETURN jsonb_build_object('conferencia_id', c.id, 'status', 'em_andamento', 'status_anterior', c.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_conferencia(_conferencia_id uuid, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  c public.conferencias;
BEGIN
  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conferência não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM app_private.exigir_admin_com_motivo(c.unidade_id, _motivo);
  PERFORM set_config('cr.motivo', btrim(_motivo), true);
  DELETE FROM public.conferencias WHERE id = c.id;
  PERFORM set_config('cr.motivo', '', true);
  RETURN jsonb_build_object('conferencia_id', c.id, 'excluida', true, 'status_anterior', c.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_unidade(_unidade_id uuid, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  nome_lista text;
BEGIN
  PERFORM app_private.exigir_admin_com_motivo(_unidade_id, _motivo);
  SELECT nome INTO nome_lista FROM public.unidades WHERE id = _unidade_id;
  PERFORM set_config('cr.motivo', btrim(_motivo), true);
  INSERT INTO public.auditoria (user_id, usuario, acao, detalhe, tipo_acao, resultado, lista)
  VALUES (auth.uid(), auth.email(), 'lista_excluida', 'Lista excluída com o histórico. Motivo: ' || btrim(_motivo),
          'administracao', 'sucesso', nome_lista);
  DELETE FROM public.unidades WHERE id = _unidade_id;
  PERFORM set_config('cr.motivo', '', true);
  RETURN jsonb_build_object('unidade_id', _unidade_id, 'excluida', true);
END;
$$;

REVOKE ALL ON FUNCTION app_private.exigir_admin_com_motivo(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reabrir_conferencia(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_conferencia(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_unidade(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reabrir_conferencia(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_conferencia(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_unidade(uuid, text) TO authenticated, service_role;
