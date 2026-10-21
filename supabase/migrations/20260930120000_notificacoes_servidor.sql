-- Notificações de INÍCIO e TÉRMINO de conferência disparadas pelo SERVIDOR.
--
-- Antes: o aparelho gravava a notificação e chamava o envio do e-mail depois que a conferência
-- chegava ao servidor. Se o app fosse fechado logo após finalizar, o e-mail não saía.
-- Agora: o próprio banco cria a notificação no momento em que a criação/finalização da
-- conferência é CONFIRMADA (trigger de constraint adiado = executa no COMMIT) e pede o envio
-- ao servidor da aplicação (pg_net). Um agendamento (pg_cron) reenvia o que ficou pendente.
--
-- Idempotência:
--   * uma notificação por conferência e tipo (coluna `chave`, única);
--   * um envio por notificação e destinatário (app_private.envios_email, reserva atômica);
--   * gravações antigas do aparelho (versões anteriores do app) para estes tipos são ignoradas.
--
-- Migration aditiva: não altera nem remove dados existentes.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Estrutura
-- ---------------------------------------------------------------------------
ALTER TABLE public.notificacoes_conferencia ADD COLUMN IF NOT EXISTS chave text;
CREATE UNIQUE INDEX IF NOT EXISTS notificacoes_conferencia_chave_idx
  ON public.notificacoes_conferencia (chave) WHERE chave IS NOT NULL;
CREATE INDEX IF NOT EXISTS notificacoes_conferencia_servidor_pendentes_idx
  ON public.notificacoes_conferencia (created_at) WHERE chave IS NOT NULL
  AND email_status IN ('pendente', 'falha', 'enviando');

-- Envio de cada e-mail (notificação × destinatário): reserva antes de chamar o provedor.
CREATE TABLE IF NOT EXISTS app_private.envios_email (
  notificacao_id uuid NOT NULL REFERENCES public.notificacoes_conferencia(id) ON DELETE CASCADE,
  destinatario text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('reservado', 'enviado', 'falha')),
  tentativas integer NOT NULL DEFAULT 1,
  reservado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  erro text,
  PRIMARY KEY (notificacao_id, destinatario)
);
REVOKE ALL ON app_private.envios_email FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.envios_email TO service_role;

-- Endereço público da aplicação (destino das chamadas do banco). Não é segredo.
CREATE TABLE IF NOT EXISTS app_private.config_servidor (
  chave text PRIMARY KEY,
  valor text NOT NULL
);
REVOKE ALL ON app_private.config_servidor FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.config_servidor TO service_role;
INSERT INTO app_private.config_servidor (chave, valor)
VALUES ('app_url', 'https://conferenciarapida.com.br')
ON CONFLICT (chave) DO NOTHING;

-- Segredo exclusivo do hook de notificações (gerado no próprio banco, nunca versionado).
INSERT INTO app_private.hook_secrets (nome, valor)
VALUES ('notificacoes', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (nome) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Relatório da conferência (fonte única do conteúdo do e-mail)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.relatorio_conferencia(_conferencia_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  WITH c AS (
    SELECT * FROM public.conferencias WHERE id = _conferencia_id
  ), u AS (
    SELECT u.* FROM public.unidades u JOIN c ON c.unidade_id = u.id
  ), itens AS (
    SELECT i.* FROM public.conferencia_itens i WHERE i.conferencia_id = _conferencia_id
  ), totais AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'conferido')::int AS conferidos,
           count(*) FILTER (WHERE status = 'divergencia')::int AS divergentes,
           count(*) FILTER (WHERE status = 'pendente')::int AS pendentes,
           count(*) FILTER (WHERE quantidade_contada IS NOT NULL)::int AS contados,
           count(*) FILTER (WHERE quantidade_contada < quantidade_esperada)::int AS faltantes,
           count(*) FILTER (WHERE quantidade_contada > quantidade_esperada)::int AS sobras
      FROM itens
  ), divs AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'codigo', codigo, 'descricao', descricao,
             'esperada', quantidade_esperada, 'encontrada', quantidade_contada)
             ORDER BY codigo), '[]'::jsonb) AS lista
      FROM (SELECT * FROM itens WHERE status = 'divergencia' ORDER BY codigo LIMIT 300) d
  )
  SELECT jsonb_build_object(
    'conferencia_id', c.id,
    'status', c.status,
    'responsavel', nullif(btrim(c.responsavel), ''),
    'conferente', coalesce(nullif(btrim(c.conferente), ''), nullif(btrim(c.almoxarife), '')),
    'matricula', coalesce(nullif(btrim(c.codigo_almoxarife), ''), nullif(btrim(u.matricula), '')),
    'lista', u.nome,
    'unidade_nome', u.nome,
    'modulo_nome', (SELECT m.nome FROM public.empresa_modulos m WHERE m.id = u.modulo_id),
    'empresa_nome', (SELECT e.nome FROM public.empresas e WHERE e.id = u.empresa_id),
    'setor', nullif(btrim(u.setor), ''),
    'frota', nullif(btrim(u.frota), ''),
    'placa', nullif(btrim(u.placa), ''),
    'modelo', nullif(btrim(u.modelo), ''),
    'tipo_lista', u.tipo,
    'inicio', to_char(c.hora_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    'fim', to_char(c.hora_fim AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
    'duracao_segundos', CASE WHEN c.status IN ('finalizada', 'cancelada', 'concluida')
                             THEN c.tempo_trabalhado END,
    'previstos', t.total,
    'itens', t.total,
    'corretos', t.conferidos,
    'divergentes', t.divergentes,
    'pendentes', t.pendentes,
    'contados', t.contados,
    'faltantes', t.faltantes,
    'sobras', t.sobras,
    'percentual', CASE WHEN t.total > 0 THEN round(t.conferidos * 100.0 / t.total, 1) ELSE 0 END,
    'divergencias', divs.lista
  )
  FROM c LEFT JOIN u ON true CROSS JOIN totais t CROSS JOIN divs
$$;
REVOKE ALL ON FUNCTION app_private.relatorio_conferencia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.relatorio_conferencia(uuid) TO service_role;

-- Para o servidor da aplicação (service_role), que só enxerga o schema public pela API.
CREATE OR REPLACE FUNCTION public.relatorio_notificacao(_conferencia_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
  SELECT app_private.relatorio_conferencia(_conferencia_id)
$$;
REVOKE ALL ON FUNCTION public.relatorio_notificacao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relatorio_notificacao(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Pedido de envio ao servidor da aplicação (assíncrono, só depois do COMMIT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.pedir_envio_notificacao(_notificacao_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'extensions'
AS $$
DECLARE
  v_url text;
  v_segredo text;
BEGIN
  -- Sem pg_net (ex.: banco de testes) o agendamento/servidor processa a fila depois.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;
  SELECT valor INTO v_url FROM app_private.config_servidor WHERE chave = 'app_url';
  SELECT valor INTO v_segredo FROM app_private.hook_secrets WHERE nome = 'notificacoes';
  IF v_url IS NULL OR v_segredo IS NULL THEN
    RETURN;
  END IF;
  -- A fila do pg_net é transacional: se a transação for desfeita, nada é enviado.
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    USING rtrim(v_url, '/') || '/api/public/hooks/notificacoes',
          jsonb_build_object('id', _notificacao_id),
          jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', v_segredo);
EXCEPTION WHEN others THEN
  -- Nunca impede a conferência: o agendamento reenvia o que ficar pendente.
  RAISE WARNING 'pedir_envio_notificacao: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION app_private.pedir_envio_notificacao(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Criação da notificação pelo banco (uma por conferência e tipo)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.criar_notificacao_servidor(_conferencia_id uuid, _tipo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  c public.conferencias;
  u public.unidades;
  r jsonb;
  v_id uuid;
  v_quando timestamptz;
  v_assunto text;
  v_gravidade text;
  v_mensagem text;
  v_status text;
  v_nome text;
  v_email text;
BEGIN
  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id;
  IF NOT FOUND OR c.created_by IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO u FROM public.unidades WHERE id = c.unidade_id;
  r := app_private.relatorio_conferencia(_conferencia_id);
  SELECT p.nome INTO v_nome FROM public.user_profiles p WHERE p.user_id = c.created_by;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = c.created_by;

  CASE _tipo
    WHEN 'conferencia_iniciada' THEN
      v_quando := c.hora_inicio;
      v_assunto := 'NOVA CONFERÊNCIA INICIADA';
      v_gravidade := 'info';
      v_status := 'em_andamento';
      v_mensagem := format('Conferência iniciada com %s itens previstos.', r->>'previstos');
    WHEN 'conferencia_concluida' THEN
      v_quando := coalesce(c.hora_fim, now());
      v_assunto := 'CONFERÊNCIA CONCLUÍDA';
      v_gravidade := 'sucesso';
      v_status := 'finalizada';
      v_mensagem := format('Conferência concluída com %s itens corretos e %s divergências.',
                           r->>'corretos', r->>'divergentes');
    WHEN 'divergencia_estoque' THEN
      v_quando := coalesce(c.hora_fim, now());
      v_assunto := 'ALERTA DE DIVERGÊNCIA DE ESTOQUE';
      v_gravidade := 'critica';
      v_status := 'divergencia';
      v_mensagem := format('%s divergência(s) de estoque identificada(s).', r->>'divergentes');
    ELSE
      RAISE EXCEPTION 'Tipo de notificação não suportado: %', _tipo;
  END CASE;

  INSERT INTO public.notificacoes_conferencia
    (conferencia_id, unidade_id, tipo, user_id, usuario_nome, usuario_email, matricula, frota,
     local, modulo, tipo_conferencia, data, hora, status, email_status, assunto, mensagem,
     gravidade, payload, chave, empresa_id, modulo_id)
  VALUES (
    c.id, c.unidade_id, _tipo, c.created_by, coalesce(v_nome, split_part(v_email, '@', 1)), v_email,
    r->>'matricula', r->>'frota', u.nome,
    CASE u.tipo WHEN 'caminhao' THEN 'FROTA' WHEN 'caixa' THEN 'FERRAMENTAS_AGRICOLA'
                WHEN 'prateleira' THEN 'ESTOQUE_AGRICOLA' WHEN 'caixa_industria' THEN 'FERRAMENTAS_INDUSTRIA'
                WHEN 'prateleira_industria' THEN 'ESTOQUE_INDUSTRIA' END,
    coalesce(c.tipo, u.tipo),
    (v_quando AT TIME ZONE 'America/Sao_Paulo')::date,
    to_char(v_quando AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'),
    v_status, 'pendente', v_assunto, v_mensagem, v_gravidade,
    r || jsonb_build_object('origem', 'servidor'),
    'srv:' || c.id || ':' || _tipo,
    u.empresa_id, u.modulo_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    PERFORM app_private.pedir_envio_notificacao(v_id);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.criar_notificacao_servidor(uuid, text) FROM PUBLIC, anon, authenticated;

-- Trigger (constraint, adiado para o COMMIT): a conferência e os itens já estão gravados e a
-- criação/finalização está confirmada. Se a transação for desfeita, nada é criado nem enviado.
CREATE OR REPLACE FUNCTION app_private.notificar_conferencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  atual public.conferencias;
BEGIN
  SELECT * INTO atual FROM public.conferencias WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL; -- excluída na mesma transação
  END IF;
  -- Cargas de dados antigos (restauração/importação) não geram avisos.
  IF atual.hora_inicio < now() - interval '7 days' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('em_andamento', 'pausada') THEN
      PERFORM app_private.criar_notificacao_servidor(NEW.id, 'conferencia_iniciada');
    END IF;
  ELSIF atual.status = 'finalizada' THEN
    PERFORM app_private.criar_notificacao_servidor(NEW.id, 'conferencia_concluida');
    IF EXISTS (SELECT 1 FROM public.conferencia_itens
                WHERE conferencia_id = NEW.id AND status = 'divergencia') THEN
      PERFORM app_private.criar_notificacao_servidor(NEW.id, 'divergencia_estoque');
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Aviso nunca desfaz a conferência; o erro fica registrado no log do banco.
  RAISE WARNING 'notificar_conferencia(%): %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.notificar_conferencia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conferencias_zz_notificar_inicio ON public.conferencias;
CREATE CONSTRAINT TRIGGER trg_conferencias_zz_notificar_inicio
  AFTER INSERT ON public.conferencias
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.notificar_conferencia();

DROP TRIGGER IF EXISTS trg_conferencias_zz_notificar_fim ON public.conferencias;
CREATE CONSTRAINT TRIGGER trg_conferencias_zz_notificar_fim
  AFTER UPDATE OF status ON public.conferencias
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'finalizada' AND OLD.status IS DISTINCT FROM 'finalizada')
  EXECUTE FUNCTION app_private.notificar_conferencia();

-- ---------------------------------------------------------------------------
-- 5. Versões antigas do app: não gravam mais início/conclusão/divergência pelo aparelho
--    (o servidor já cria). A gravação é ignorada sem erro, para não travar filas offline.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.notificacoes_somente_servidor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.tipo IN ('conferencia_iniciada', 'conferencia_concluida', 'divergencia_estoque') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notificacoes_00_somente_servidor ON public.notificacoes_conferencia;
CREATE TRIGGER trg_notificacoes_00_somente_servidor
  BEFORE INSERT ON public.notificacoes_conferencia
  FOR EACH ROW EXECUTE FUNCTION app_private.notificacoes_somente_servidor();

-- ---------------------------------------------------------------------------
-- 6. Reserva atômica de cada e-mail (notificação × destinatário)
--    true  = este chamador deve enviar agora;
--    false = já enviado, em envio por outra chamada, ou tentativas esgotadas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservar_envio_email(_notificacao_id uuid, _destinatario text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app_private.envios_email AS e (notificacao_id, destinatario, estado)
  VALUES (_notificacao_id, lower(btrim(_destinatario)), 'reservado')
  ON CONFLICT (notificacao_id, destinatario) DO UPDATE
    SET estado = 'reservado', tentativas = e.tentativas + 1, reservado_em = now(),
        concluido_em = NULL, erro = NULL
    WHERE (e.estado = 'falha' AND e.tentativas < 5)
       OR (e.estado = 'reservado' AND e.reservado_em < now() - interval '10 minutes');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.concluir_envio_email(
  _notificacao_id uuid, _destinatario text, _enviado boolean, _erro text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  UPDATE app_private.envios_email
     SET estado = CASE WHEN _enviado THEN 'enviado' ELSE 'falha' END,
         concluido_em = now(), erro = left(_erro, 500)
   WHERE notificacao_id = _notificacao_id AND destinatario = lower(btrim(_destinatario))
$$;

-- Estado dos envios de uma notificação (para o status geral).
CREATE OR REPLACE FUNCTION public.estado_envios_email(_notificacao_id uuid)
RETURNS TABLE (destinatario text, estado text, tentativas integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  SELECT destinatario, estado, tentativas FROM app_private.envios_email
   WHERE notificacao_id = _notificacao_id
$$;

REVOKE ALL ON FUNCTION public.reservar_envio_email(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_envio_email(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.estado_envios_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_envio_email(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.concluir_envio_email(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.estado_envios_email(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Agendamento: a cada 2 minutos processa o que ficou pendente (queda, timeout, erro).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_segredo text; v_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN;
  END IF;
  SELECT valor INTO v_segredo FROM app_private.hook_secrets WHERE nome = 'notificacoes';
  SELECT valor INTO v_url FROM app_private.config_servidor WHERE chave = 'app_url';
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notificacoes-pendentes';
  PERFORM cron.schedule('notificacoes-pendentes', '*/2 * * * *', format($f$
  select net.http_post(
    url:=%L,
    headers:=jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', %L),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  ) as request_id;
$f$, rtrim(v_url, '/') || '/api/public/hooks/notificacoes', v_segredo));
END $$;
