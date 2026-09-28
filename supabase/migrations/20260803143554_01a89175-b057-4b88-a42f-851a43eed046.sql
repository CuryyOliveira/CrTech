CREATE TABLE public.conferencia_pausas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conferencia_id uuid NOT NULL REFERENCES public.conferencias(id) ON DELETE CASCADE,
  pausada_em timestamptz NOT NULL DEFAULT now(),
  retomada_em timestamptz,
  segundos integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.conferencia_pausas TO authenticated;
GRANT ALL ON public.conferencia_pausas TO service_role;

ALTER TABLE public.conferencia_pausas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pausas visiveis para admin ou dono da conferencia"
ON public.conferencia_pausas FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.conferencias c
    WHERE c.id = conferencia_pausas.conferencia_id
      AND c.created_by = auth.uid()
  )
);

CREATE INDEX idx_conferencia_pausas_conf ON public.conferencia_pausas (conferencia_id, pausada_em);

ALTER TABLE public.conferencias ADD COLUMN IF NOT EXISTS quantidade_pausas integer NOT NULL DEFAULT 0;
ALTER TABLE public.historico_conferencias ADD COLUMN IF NOT EXISTS quantidade_pausas integer NOT NULL DEFAULT 0;

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

CREATE OR REPLACE FUNCTION public.sync_historico_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.hora_fim IS DISTINCT FROM OLD.hora_fim
     OR NEW.total_tempo_pausado IS DISTINCT FROM OLD.total_tempo_pausado
     OR NEW.quantidade_pausas IS DISTINCT FROM OLD.quantidade_pausas
     OR NEW.ultima_pausa IS DISTINCT FROM OLD.ultima_pausa
     OR NEW.tempo_trabalhado IS DISTINCT FROM OLD.tempo_trabalhado THEN
    UPDATE public.historico_conferencias h
       SET status = NEW.status,
           hora_fim = CASE WHEN NEW.status IN ('finalizada','cancelada') THEN COALESCE(NEW.hora_fim, now()) ELSE NULL END,
           total_tempo_pausado = COALESCE(NEW.total_tempo_pausado, 0),
           quantidade_pausas = COALESCE(NEW.quantidade_pausas, 0),
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
$function$;

REVOKE EXECUTE ON FUNCTION public.conferencias_tempo_pausa() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_historico_status() FROM anon, authenticated;