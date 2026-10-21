-- FASE 0 — Limite persistente para o registro de tentativas de login inválidas.
--
-- O limite anterior ficava na memória do Worker (Cloudflare), que não é compartilhada
-- entre instâncias nem sobrevive a reinícios. Agora a contagem é atômica no banco.
-- Só o servidor (service_role) usa esta função. As chaves chegam já como HASH
-- (SHA-256 do e-mail/IP): nenhum e-mail, IP ou senha é gravado nesta tabela.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS app_private.limites_tentativa (
  chave text PRIMARY KEY,
  janela_inicio timestamptz NOT NULL,
  total integer NOT NULL
);
REVOKE ALL ON app_private.limites_tentativa FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.limites_tentativa TO service_role;

-- Consome uma unidade do limite. Retorna true se ainda está dentro do limite.
CREATE OR REPLACE FUNCTION public.consumir_limite_tentativa(_chave text, _maximo integer, _janela_segundos integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'app_private', 'public'
AS $$
DECLARE
  v_total integer;
  v_janela interval := make_interval(secs => greatest(_janela_segundos, 1));
BEGIN
  IF _chave IS NULL OR length(_chave) < 16 OR length(_chave) > 128 THEN
    RETURN false;
  END IF;

  INSERT INTO app_private.limites_tentativa AS l (chave, janela_inicio, total)
  VALUES (_chave, now(), 1)
  ON CONFLICT (chave) DO UPDATE SET
    total = CASE WHEN l.janela_inicio < now() - v_janela THEN 1 ELSE l.total + 1 END,
    janela_inicio = CASE WHEN l.janela_inicio < now() - v_janela THEN now() ELSE l.janela_inicio END
  RETURNING total INTO v_total;

  -- Limpeza oportunista de janelas antigas (mantém a tabela pequena).
  DELETE FROM app_private.limites_tentativa
   WHERE chave IN (SELECT chave FROM app_private.limites_tentativa
                    WHERE janela_inicio < now() - interval '1 day' LIMIT 100);

  RETURN v_total <= _maximo;
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_limite_tentativa(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_limite_tentativa(text, integer, integer) TO service_role;
