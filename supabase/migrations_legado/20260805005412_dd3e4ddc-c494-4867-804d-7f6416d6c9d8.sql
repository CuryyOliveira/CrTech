CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE IF NOT EXISTS app_private.hook_secrets (
  nome text PRIMARY KEY,
  valor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON app_private.hook_secrets FROM PUBLIC;
GRANT SELECT ON app_private.hook_secrets TO service_role;

INSERT INTO app_private.hook_secrets (nome, valor)
VALUES ('monitor_conferencias', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (nome) DO UPDATE SET valor = encode(gen_random_bytes(32), 'hex');

CREATE OR REPLACE FUNCTION app_private.validar_hook(_nome text, _valor text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = app_private, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.hook_secrets
    WHERE nome = _nome AND valor = _valor
  )
$$;

REVOKE ALL ON FUNCTION app_private.validar_hook(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.validar_hook(text, text) TO service_role;

DO $$
DECLARE v text;
BEGIN
  SELECT valor INTO v FROM app_private.hook_secrets WHERE nome = 'monitor_conferencias';
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE command LIKE '%monitor-conferencias%';
  PERFORM cron.schedule(
    'monitor-conferencias',
    '*/5 * * * *',
    format($f$
  select net.http_post(
    url:='https://conferenciarapida.com.br/api/public/hooks/monitor-conferencias',
    headers:='{"Content-Type": "application/json", "x-hook-secret": "%s"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
$f$, v)
  );
END $$;