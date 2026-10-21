ALTER TABLE public.notificacoes_conferencia
  DROP CONSTRAINT notificacoes_conferencia_conferencia_id_fkey,
  ADD CONSTRAINT notificacoes_conferencia_conferencia_id_fkey
    FOREIGN KEY (conferencia_id) REFERENCES public.conferencias(id) ON DELETE CASCADE;

ALTER TABLE public.historico_conferencias
  DROP CONSTRAINT historico_conferencias_conferencia_id_fkey,
  ADD CONSTRAINT historico_conferencias_conferencia_id_fkey
    FOREIGN KEY (conferencia_id) REFERENCES public.conferencias(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.historico_cascade_notificacoes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.conferencia_id IS NOT NULL THEN
    DELETE FROM public.notificacoes_conferencia n
     WHERE n.conferencia_id = OLD.conferencia_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_historico_cascade_notificacoes ON public.historico_conferencias;
CREATE TRIGGER trg_historico_cascade_notificacoes
AFTER DELETE ON public.historico_conferencias
FOR EACH ROW EXECUTE FUNCTION public.historico_cascade_notificacoes();