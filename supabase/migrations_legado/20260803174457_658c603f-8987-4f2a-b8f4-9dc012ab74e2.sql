ALTER TABLE public.conferencias REPLICA IDENTITY FULL;
ALTER TABLE public.conferencia_itens REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conferencias;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conferencia_itens;