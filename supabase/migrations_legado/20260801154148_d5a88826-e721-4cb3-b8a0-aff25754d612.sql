-- 1) Usuário precisa poder ler suas próprias linhas para conseguir atualizá-las
CREATE POLICY historico_select_own ON public.historico_conferencias
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 2) Sincronização garantida: conferencias -> historico_conferencias
CREATE OR REPLACE FUNCTION public.sync_historico_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.hora_fim IS DISTINCT FROM OLD.hora_fim THEN
    UPDATE public.historico_conferencias h
       SET status = NEW.status,
           hora_fim = CASE WHEN NEW.status IN ('finalizada','cancelada') THEN COALESCE(NEW.hora_fim, now()) ELSE NULL END,
           duracao_segundos = CASE
             WHEN NEW.status IN ('finalizada','cancelada')
               THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(NEW.hora_fim, now()) - h.hora_inicio))::int)
             ELSE h.duracao_segundos END,
           updated_at = now()
     WHERE h.conferencia_id = NEW.id
       AND (h.status IS DISTINCT FROM NEW.status OR h.hora_fim IS DISTINCT FROM NEW.hora_fim);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_historico_status ON public.conferencias;
CREATE TRIGGER trg_sync_historico_status
AFTER UPDATE ON public.conferencias
FOR EACH ROW EXECUTE FUNCTION public.sync_historico_status();

-- 3) Correção dos registros inconsistentes existentes
UPDATE public.historico_conferencias h
   SET status = c.status,
       hora_fim = COALESCE(h.hora_fim, c.hora_fim, now()),
       duracao_segundos = COALESCE(h.duracao_segundos,
         GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(c.hora_fim, now()) - h.hora_inicio))::int)),
       updated_at = now()
  FROM public.conferencias c
 WHERE c.id = h.conferencia_id
   AND h.status IN ('em_andamento','pausada')
   AND c.status IN ('finalizada','cancelada');