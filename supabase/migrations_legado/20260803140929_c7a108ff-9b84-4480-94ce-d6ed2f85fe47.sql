ALTER TABLE public.conferencias
  ADD COLUMN IF NOT EXISTS total_tempo_pausado integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_pausa timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_retomada timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_trabalhado integer;

ALTER TABLE public.historico_conferencias
  ADD COLUMN IF NOT EXISTS total_tempo_pausado integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_pausa timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_retomada timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_trabalhado integer;

CREATE OR REPLACE FUNCTION public.conferencias_tempo_pausa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  agora timestamptz := now();
BEGIN
  NEW.total_tempo_pausado := COALESCE(NEW.total_tempo_pausado, COALESCE(OLD.total_tempo_pausado, 0));

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'pausada' AND OLD.status <> 'pausada' THEN
      NEW.ultima_pausa := agora;
    ELSIF OLD.status = 'pausada' AND NEW.status <> 'pausada' THEN
      NEW.total_tempo_pausado := COALESCE(OLD.total_tempo_pausado, 0)
        + GREATEST(0, EXTRACT(EPOCH FROM (agora - COALESCE(OLD.ultima_pausa, agora)))::int);
      NEW.ultima_pausa := NULL;
      IF NEW.status = 'em_andamento' THEN
        NEW.ultima_retomada := agora;
      END IF;
    END IF;
  END IF;

  IF NEW.status IN ('finalizada','cancelada') THEN
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
$$;

DROP TRIGGER IF EXISTS trg_conferencias_tempo_pausa ON public.conferencias;
CREATE TRIGGER trg_conferencias_tempo_pausa
  BEFORE UPDATE ON public.conferencias
  FOR EACH ROW EXECUTE FUNCTION public.conferencias_tempo_pausa();

CREATE OR REPLACE FUNCTION public.sync_historico_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.hora_fim IS DISTINCT FROM OLD.hora_fim
     OR NEW.total_tempo_pausado IS DISTINCT FROM OLD.total_tempo_pausado
     OR NEW.tempo_trabalhado IS DISTINCT FROM OLD.tempo_trabalhado THEN
    UPDATE public.historico_conferencias h
       SET status = NEW.status,
           hora_fim = CASE WHEN NEW.status IN ('finalizada','cancelada') THEN COALESCE(NEW.hora_fim, now()) ELSE NULL END,
           total_tempo_pausado = COALESCE(NEW.total_tempo_pausado, 0),
           ultima_pausa = NEW.ultima_pausa,
           ultima_retomada = NEW.ultima_retomada,
           tempo_trabalhado = NEW.tempo_trabalhado,
           duracao_segundos = CASE
             WHEN NEW.status IN ('finalizada','cancelada') THEN NEW.tempo_trabalhado
             ELSE NULL END,
           updated_at = now()
     WHERE h.conferencia_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;