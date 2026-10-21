-- Notificações também pelo Microsoft Teams (fluxo do Power Automate / Workflows).
--
-- O servidor da aplicação envia ao fluxo um card adaptativo com o mesmo conteúdo do e-mail e a
-- lista de destinatários; o fluxo posta o card no chat de cada destinatário (Flow bot).
--
-- Duas tabelas novas, somente servidor (schema app_private, sem acesso para anon/authenticated):
--   * app_private.teams_config  — endereço do fluxo (segredo), destinatários e validação;
--   * app_private.teams_envios  — histórico e controle de duplicidade (um envio por notificação).
-- O acesso é feito apenas pelas funções abaixo, executáveis só pelo service_role.
--
-- Migration aditiva: não altera nem remove tabelas, colunas ou dados existentes.

SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Configuração (linha única)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.teams_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  webhook_url text,
  destinatarios text[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  validado_em timestamptz,
  validado_por text,
  -- Primeira validação após a configuração do endereço: notificações anteriores não vão ao Teams.
  liberado_em timestamptz,
  ultimo_erro text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.teams_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.teams_config TO service_role;
INSERT INTO app_private.teams_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Envios (histórico + idempotência)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_private.teams_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid REFERENCES public.notificacoes_conferencia(id) ON DELETE CASCADE,
  teste boolean NOT NULL DEFAULT false,
  destinatarios text[] NOT NULL DEFAULT '{}',
  estado text NOT NULL CHECK (estado IN ('reservado', 'enviado', 'falha')),
  tentativas integer NOT NULL DEFAULT 1,
  reservado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  erro text,
  CHECK (teste OR notificacao_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_envios_notificacao_idx
  ON app_private.teams_envios (notificacao_id) WHERE notificacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS teams_envios_recentes_idx
  ON app_private.teams_envios (reservado_em DESC);
REVOKE ALL ON app_private.teams_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.teams_envios TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Funções (somente service_role)
-- ---------------------------------------------------------------------------

-- Configuração completa (inclui o endereço do fluxo; nunca exposta ao navegador).
CREATE OR REPLACE FUNCTION public.teams_config_obter()
RETURNS TABLE (
  webhook_url text, destinatarios text[], ativo boolean, validado_em timestamptz,
  validado_por text, liberado_em timestamptz, ultimo_erro text, atualizado_em timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  SELECT webhook_url, destinatarios, ativo, validado_em, validado_por, liberado_em,
         ultimo_erro, atualizado_em
    FROM app_private.teams_config WHERE id
$$;

-- Atualiza apenas as chaves presentes em _patch. Trocar o endereço do fluxo invalida a
-- validação (o teste precisa ser aprovado de novo antes de qualquer disparo).
CREATE OR REPLACE FUNCTION public.teams_config_salvar(_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
DECLARE
  atual app_private.teams_config;
  nova_url text;
BEGIN
  INSERT INTO app_private.teams_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO atual FROM app_private.teams_config WHERE id FOR UPDATE;
  nova_url := CASE WHEN _patch ? 'webhook_url' THEN NULLIF(btrim(_patch->>'webhook_url'), '')
                   ELSE atual.webhook_url END;

  UPDATE app_private.teams_config SET
    webhook_url = nova_url,
    destinatarios = CASE WHEN _patch ? 'destinatarios'
      THEN ARRAY(SELECT jsonb_array_elements_text(_patch->'destinatarios'))
      ELSE atual.destinatarios END,
    ativo = CASE WHEN _patch ? 'ativo' THEN (_patch->>'ativo')::boolean ELSE atual.ativo END,
    validado_em = CASE
      WHEN nova_url IS DISTINCT FROM atual.webhook_url THEN NULL
      WHEN _patch ? 'validado_em' THEN (_patch->>'validado_em')::timestamptz
      ELSE atual.validado_em END,
    validado_por = CASE
      WHEN nova_url IS DISTINCT FROM atual.webhook_url THEN NULL
      WHEN _patch ? 'validado_por' THEN _patch->>'validado_por'
      ELSE atual.validado_por END,
    liberado_em = CASE
      WHEN nova_url IS DISTINCT FROM atual.webhook_url THEN NULL
      WHEN _patch ? 'liberado_em' THEN (_patch->>'liberado_em')::timestamptz
      ELSE atual.liberado_em END,
    ultimo_erro = CASE WHEN _patch ? 'ultimo_erro' THEN left(_patch->>'ultimo_erro', 500)
      ELSE atual.ultimo_erro END,
    atualizado_em = now()
  WHERE id;
END;
$$;

-- Reserva atômica do envio de uma notificação ao Teams.
--   true  = este chamador deve enviar agora;
--   false = já enviado, em envio por outra chamada ou tentativas esgotadas.
CREATE OR REPLACE FUNCTION public.reservar_envio_teams(_notificacao_id uuid, _destinatarios text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app_private.teams_envios AS e (notificacao_id, destinatarios, estado)
  VALUES (_notificacao_id, coalesce(_destinatarios, '{}'), 'reservado')
  ON CONFLICT (notificacao_id) WHERE notificacao_id IS NOT NULL DO UPDATE
    SET estado = 'reservado', tentativas = e.tentativas + 1, reservado_em = now(),
        concluido_em = NULL, erro = NULL, destinatarios = coalesce(_destinatarios, '{}')
    WHERE (e.estado = 'falha' AND e.tentativas < 5)
       OR (e.estado = 'reservado' AND e.reservado_em < now() - interval '10 minutes');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.concluir_envio_teams(
  _notificacao_id uuid, _enviado boolean, _erro text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  UPDATE app_private.teams_envios
     SET estado = CASE WHEN _enviado THEN 'enviado' ELSE 'falha' END,
         concluido_em = now(), erro = left(_erro, 500)
   WHERE notificacao_id = _notificacao_id
$$;

-- Registro do envio de teste (botão "Validar conexão").
CREATE OR REPLACE FUNCTION public.registrar_teste_teams(
  _destinatarios text[], _enviado boolean, _erro text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  INSERT INTO app_private.teams_envios (teste, destinatarios, estado, concluido_em, erro)
  VALUES (true, coalesce(_destinatarios, '{}'),
          CASE WHEN _enviado THEN 'enviado' ELSE 'falha' END, now(), left(_erro, 500))
$$;

-- Histórico recente (aba Microsoft Teams da Administração do Sistema).
CREATE OR REPLACE FUNCTION public.teams_envios_recentes(_limite integer DEFAULT 20)
RETURNS TABLE (
  id uuid, notificacao_id uuid, tipo text, teste boolean, destinatarios text[], estado text,
  tentativas integer, reservado_em timestamptz, concluido_em timestamptz, erro text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  SELECT e.id, e.notificacao_id, n.tipo, e.teste, e.destinatarios, e.estado, e.tentativas,
         e.reservado_em, e.concluido_em, e.erro
    FROM app_private.teams_envios e
    LEFT JOIN public.notificacoes_conferencia n ON n.id = e.notificacao_id
   ORDER BY e.reservado_em DESC
   LIMIT least(greatest(coalesce(_limite, 20), 1), 100)
$$;

-- Notificações cujo envio ao Teams falhou ou travou (reprocessadas pelo agendador).
CREATE OR REPLACE FUNCTION public.teams_envios_pendentes()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
  SELECT notificacao_id FROM app_private.teams_envios
   WHERE notificacao_id IS NOT NULL
     AND reservado_em > now() - interval '48 hours'
     AND ((estado = 'falha' AND tentativas < 5)
       OR (estado = 'reservado' AND reservado_em < now() - interval '10 minutes'))
   ORDER BY reservado_em
   LIMIT 20
$$;

REVOKE ALL ON FUNCTION public.teams_config_obter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teams_config_salvar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_envio_teams(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_envio_teams(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_teste_teams(text[], boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teams_envios_recentes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teams_envios_pendentes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teams_config_obter() TO service_role;
GRANT EXECUTE ON FUNCTION public.teams_config_salvar(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reservar_envio_teams(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.concluir_envio_teams(uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_teste_teams(text[], boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.teams_envios_recentes(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.teams_envios_pendentes() TO service_role;
