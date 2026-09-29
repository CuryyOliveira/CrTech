-- FASE 0 — Fundação para operações idempotentes da conferência.
--
-- Cada operação crítica recebe um IDENTIFICADOR GERADO NO APARELHO (uuid). Repetir a
-- chamada com o mesmo identificador (duplo clique, resposta perdida, reenvio da fila
-- offline) devolve o MESMO resultado, sem criar nada em duplicidade.
--
-- Funções (SECURITY INVOKER: a RLS e os triggers de integridade continuam valendo):
--   iniciar_conferencia        — conferência + itens + histórico numa única transação
--   adicionar_item_conferencia — material adicional durante a conferência
--   finalizar_conferencia      — finalização (repetição devolve a finalização existente)
--   cancelar_conferencia       — cancelamento com motivo
--
-- A V1 NÃO usa estas funções ainda (continua gravando direto nas tabelas). Elas serão
-- adotadas pela fila offline da V2.2/V2.3.

SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS public.conferencia_operacoes (
  id uuid PRIMARY KEY,                               -- chave de idempotência (gerada no aparelho)
  conferencia_id uuid NOT NULL REFERENCES public.conferencias(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('iniciar', 'adicionar_item', 'finalizar', 'cancelar')),
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  ocorrido_em timestamptz,                           -- hora da ação no aparelho (informativa)
  recebido_em timestamptz NOT NULL DEFAULT now(),    -- hora em que o servidor aplicou
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS conferencia_operacoes_conferencia_idx
  ON public.conferencia_operacoes (conferencia_id, recebido_em);

ALTER TABLE public.conferencia_operacoes ENABLE ROW LEVEL SECURITY;
-- Registro imutável: apenas leitura e inserção (sem UPDATE/DELETE para usuários).
CREATE POLICY conferencia_operacoes_select ON public.conferencia_operacoes
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conferencias c
                  WHERE c.id = conferencia_operacoes.conferencia_id
                    AND app_private.pode_unidade(c.unidade_id)));
CREATE POLICY conferencia_operacoes_insert ON public.conferencia_operacoes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND app_private.pode_operar(auth.uid())
              AND EXISTS (SELECT 1 FROM public.conferencias c
                           WHERE c.id = conferencia_operacoes.conferencia_id
                             AND app_private.pode_unidade(c.unidade_id)));
REVOKE ALL ON public.conferencia_operacoes FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.conferencia_operacoes FROM authenticated;
GRANT SELECT, INSERT ON public.conferencia_operacoes TO authenticated;
GRANT ALL ON public.conferencia_operacoes TO service_role;

-- Resultado já registrado para esta chave de idempotência?
CREATE OR REPLACE FUNCTION app_private.resultado_operacao(_operacao_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT resultado || jsonb_build_object('repetida', true)
    FROM public.conferencia_operacoes WHERE id = _operacao_id
$$;

-- ---------------------------------------------------------------------------
-- iniciar_conferencia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_conferencia(
  _conferencia_id uuid,
  _unidade_id uuid,
  _dados jsonb DEFAULT '{}'::jsonb,
  _operacao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_op uuid := coalesce(_operacao_id, _conferencia_id);
  v_res jsonb;
  v_unidade public.unidades;
  v_existente uuid;
  v_itens integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF _conferencia_id IS NULL OR _unidade_id IS NULL THEN
    RAISE EXCEPTION 'Conferência e lista são obrigatórias' USING ERRCODE = '22023';
  END IF;
  _dados := coalesce(_dados, '{}'::jsonb);

  v_res := app_private.resultado_operacao(v_op);
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;

  -- A conferência já foi criada por esta mesma chamada (resposta perdida no caminho).
  IF EXISTS (SELECT 1 FROM public.conferencias WHERE id = _conferencia_id) THEN
    RETURN jsonb_build_object('conferencia_id', _conferencia_id, 'criada', false, 'repetida', true);
  END IF;

  SELECT * INTO v_unidade FROM public.unidades WHERE id = _unidade_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lista não encontrada ou sem acesso.' USING ERRCODE = '42501';
  END IF;

  -- Já existe conferência aberta na lista: retoma em vez de duplicar (regra da V1).
  SELECT id INTO v_existente FROM public.conferencias
   WHERE unidade_id = _unidade_id AND status IN ('em_andamento', 'pausada') LIMIT 1;
  IF v_existente IS NOT NULL THEN
    RETURN jsonb_build_object('conferencia_id', v_existente, 'criada', false, 'reaproveitada', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.materiais WHERE unidade_id = _unidade_id) THEN
    RAISE EXCEPTION 'Cadastre materiais antes de iniciar.' USING ERRCODE = 'CR011';
  END IF;

  BEGIN
    INSERT INTO public.conferencias
      (id, unidade_id, tipo, data, hora_inicio, conferente, responsavel, almoxarife,
       codigo_almoxarife, created_by)
    VALUES (
      _conferencia_id,
      _unidade_id,
      coalesce(nullif(_dados->>'tipo', ''), v_unidade.tipo),
      coalesce((_dados->>'data')::date, ((now() AT TIME ZONE 'America/Sao_Paulo'))::date),
      coalesce((_dados->>'hora_inicio')::timestamptz, now()),
      nullif(_dados->>'conferente', ''),
      coalesce(nullif(_dados->>'responsavel', ''), v_unidade.gestor),
      nullif(_dados->>'almoxarife', ''),
      nullif(_dados->>'codigo_almoxarife', ''),
      auth.uid()
    );
  EXCEPTION WHEN unique_violation THEN
    -- Corrida: outro aparelho abriu uma conferência nesta lista no mesmo instante,
    -- ou este mesmo id já foi gravado. Devolve a conferência que ficou valendo.
    SELECT id INTO v_existente FROM public.conferencias
     WHERE id = _conferencia_id
        OR (unidade_id = _unidade_id AND status IN ('em_andamento', 'pausada'))
     ORDER BY (id = _conferencia_id) DESC LIMIT 1;
    RETURN jsonb_build_object('conferencia_id', v_existente, 'criada', false,
                              'reaproveitada', v_existente IS DISTINCT FROM _conferencia_id);
  END;

  -- Itens: retrato (snapshot) da lista no momento do início.
  INSERT INTO public.conferencia_itens
    (conferencia_id, material_id, codigo, descricao, locacao, quantidade_esperada)
  SELECT _conferencia_id, m.id, m.codigo, m.descricao, m.locacao, m.quantidade_esperada
    FROM public.materiais m WHERE m.unidade_id = _unidade_id;
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  INSERT INTO public.historico_conferencias
    (conferencia_id, unidade_id, user_id, lista, data, hora_inicio, quantidade_prevista, status)
  SELECT c.id, c.unidade_id, auth.uid(), v_unidade.nome, c.data, c.hora_inicio, v_itens, c.status
    FROM public.conferencias c WHERE c.id = _conferencia_id
  ON CONFLICT (conferencia_id) DO NOTHING;

  v_res := jsonb_build_object('conferencia_id', _conferencia_id, 'criada', true, 'itens', v_itens);
  INSERT INTO public.conferencia_operacoes (id, conferencia_id, tipo, ocorrido_em, resultado)
  VALUES (v_op, _conferencia_id, 'iniciar', (_dados->>'ocorrido_em')::timestamptz, v_res);
  RETURN v_res;
END;
$$;

-- ---------------------------------------------------------------------------
-- adicionar_item_conferencia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adicionar_item_conferencia(
  _item_id uuid,
  _conferencia_id uuid,
  _dados jsonb,
  _operacao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_op uuid := coalesce(_operacao_id, _item_id);
  v_res jsonb;
  v_status text;
  v_material public.materiais;
  v_material_id uuid := nullif(_dados->>'material_id', '')::uuid;
  v_codigo text := btrim(coalesce(_dados->>'codigo', ''));
  v_descricao text := btrim(coalesce(_dados->>'descricao', ''));
  v_motivo text := btrim(coalesce(_dados->>'motivo', ''));
  v_qtd numeric := (_dados->>'quantidade')::numeric;
  v_esperada numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF _item_id IS NULL OR _conferencia_id IS NULL THEN
    RAISE EXCEPTION 'Item e conferência são obrigatórios' USING ERRCODE = '22023';
  END IF;

  v_res := app_private.resultado_operacao(v_op);
  IF v_res IS NOT NULL THEN
    RETURN v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM public.conferencia_itens WHERE id = _item_id) THEN
    RETURN jsonb_build_object('item_id', _item_id, 'criado', false, 'repetida', true);
  END IF;

  -- Trava a conferência para serializar inclusões simultâneas.
  SELECT status INTO v_status FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conferência não encontrada ou sem acesso.' USING ERRCODE = '42501';
  END IF;
  IF app_private.conferencia_encerrada(v_status) THEN
    RAISE EXCEPTION 'Os itens de uma conferência encerrada não podem ser alterados.' USING ERRCODE = 'CR004';
  END IF;
  IF v_status = 'pausada' THEN
    RAISE EXCEPTION 'Conferência pausada: retome para incluir materiais.' USING ERRCODE = 'CR012';
  END IF;

  IF v_codigo = '' THEN RAISE EXCEPTION 'Informe o código do material' USING ERRCODE = '22023'; END IF;
  IF v_descricao = '' THEN RAISE EXCEPTION 'Informe a descrição do material' USING ERRCODE = '22023'; END IF;
  IF v_motivo = '' THEN RAISE EXCEPTION 'Informe o motivo da inclusão' USING ERRCODE = '22023'; END IF;
  IF v_qtd IS NULL OR v_qtd <= 0 THEN
    RAISE EXCEPTION 'Informe a quantidade encontrada' USING ERRCODE = '22023';
  END IF;

  IF v_material_id IS NOT NULL THEN
    SELECT * INTO v_material FROM public.materiais WHERE id = v_material_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Material não encontrado ou sem acesso.' USING ERRCODE = '42501';
    END IF;
    v_esperada := coalesce(v_material.quantidade_esperada, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conferencia_itens i
     WHERE i.conferencia_id = _conferencia_id
       AND ((v_material_id IS NOT NULL AND i.material_id = v_material_id)
            OR upper(btrim(coalesce(i.codigo, ''))) = upper(v_codigo))
  ) THEN
    RAISE EXCEPTION 'Este material já faz parte desta conferência.' USING ERRCODE = 'CR013';
  END IF;

  INSERT INTO public.conferencia_itens
    (id, conferencia_id, material_id, codigo, descricao, locacao, quantidade_esperada,
     quantidade_contada, status, observacoes, origem, motivo_inclusao, incluido_por,
     incluido_por_nome, incluido_em)
  VALUES (
    _item_id, _conferencia_id, v_material_id, v_codigo, v_descricao, v_material.locacao,
    v_esperada, v_qtd,
    CASE WHEN v_qtd = v_esperada THEN 'conferido' ELSE 'divergencia' END,
    CASE WHEN v_material_id IS NULL
         THEN 'Material encontrado na prateleira e ausente na lista original da conferência.' END,
    'adicionado', v_motivo, auth.uid(), nullif(_dados->>'incluido_por_nome', ''),
    coalesce((_dados->>'ocorrido_em')::timestamptz, now())
  );

  v_res := jsonb_build_object('item_id', _item_id, 'criado', true,
                              'status', CASE WHEN v_qtd = v_esperada THEN 'conferido' ELSE 'divergencia' END);
  INSERT INTO public.conferencia_operacoes (id, conferencia_id, tipo, ocorrido_em, resultado)
  VALUES (v_op, _conferencia_id, 'adicionar_item', (_dados->>'ocorrido_em')::timestamptz, v_res);
  RETURN v_res;
END;
$$;

-- ---------------------------------------------------------------------------
-- finalizar_conferencia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_conferencia(
  _conferencia_id uuid,
  _dados jsonb,
  _operacao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_res jsonb;
  c public.conferencias;
  v_tempo integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  _dados := coalesce(_dados, '{}'::jsonb);

  IF _operacao_id IS NOT NULL THEN
    v_res := app_private.resultado_operacao(_operacao_id);
    IF v_res IS NOT NULL THEN
      RETURN v_res;
    END IF;
  END IF;

  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conferência não encontrada ou sem acesso.' USING ERRCODE = '42501';
  END IF;
  IF c.status = 'finalizada' THEN
    -- Finalização repetida: devolve a que já existe, sem produzir uma segunda.
    RETURN jsonb_build_object('conferencia_id', c.id, 'status', 'finalizada', 'repetida', true,
                              'hora_fim', c.hora_fim, 'tempo_trabalhado', c.tempo_trabalhado);
  END IF;
  IF app_private.conferencia_encerrada(c.status) THEN
    RAISE EXCEPTION 'Conferência cancelada não pode ser finalizada.' USING ERRCODE = 'CR006';
  END IF;
  IF coalesce(btrim(_dados->>'assinatura'), '') = '' THEN
    RAISE EXCEPTION 'A assinatura do conferente é obrigatória para finalizar.' USING ERRCODE = 'CR003';
  END IF;

  UPDATE public.conferencias SET
    status = 'finalizada',
    assinatura = _dados->>'assinatura',
    assinatura_gestor = nullif(_dados->>'assinatura_gestor', ''),
    conferente = coalesce(nullif(_dados->>'conferente', ''), conferente),
    responsavel = coalesce(nullif(_dados->>'responsavel', ''), responsavel),
    observacoes = coalesce(_dados->>'observacoes', observacoes),
    hora_fim = coalesce((_dados->>'hora_fim')::timestamptz, now())
  WHERE id = c.id
  RETURNING tempo_trabalhado INTO v_tempo;

  v_res := jsonb_build_object('conferencia_id', c.id, 'status', 'finalizada', 'repetida', false,
                              'tempo_trabalhado', v_tempo);
  INSERT INTO public.conferencia_operacoes (id, conferencia_id, tipo, ocorrido_em, resultado)
  VALUES (coalesce(_operacao_id, gen_random_uuid()), c.id, 'finalizar',
          (_dados->>'ocorrido_em')::timestamptz, v_res);
  RETURN v_res;
END;
$$;

-- ---------------------------------------------------------------------------
-- cancelar_conferencia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_conferencia(
  _conferencia_id uuid,
  _motivo text,
  _operacao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'app_private'
AS $$
DECLARE
  v_res jsonb;
  c public.conferencias;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF _operacao_id IS NOT NULL THEN
    v_res := app_private.resultado_operacao(_operacao_id);
    IF v_res IS NOT NULL THEN
      RETURN v_res;
    END IF;
  END IF;

  SELECT * INTO c FROM public.conferencias WHERE id = _conferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conferência não encontrada ou sem acesso.' USING ERRCODE = '42501';
  END IF;
  IF c.status = 'cancelada' THEN
    RETURN jsonb_build_object('conferencia_id', c.id, 'status', 'cancelada', 'repetida', true);
  END IF;
  IF app_private.conferencia_encerrada(c.status) THEN
    RAISE EXCEPTION 'Conferência finalizada não pode ser cancelada.' USING ERRCODE = 'CR008';
  END IF;
  IF length(btrim(coalesce(_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = 'CR007';
  END IF;

  UPDATE public.conferencias
     SET status = 'cancelada', hora_fim = now(), motivo_cancelamento = btrim(_motivo)
   WHERE id = c.id;

  v_res := jsonb_build_object('conferencia_id', c.id, 'status', 'cancelada', 'repetida', false);
  INSERT INTO public.conferencia_operacoes (id, conferencia_id, tipo, resultado)
  VALUES (coalesce(_operacao_id, gen_random_uuid()), c.id, 'cancelar', v_res);
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION app_private.resultado_operacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.resultado_operacao(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.iniciar_conferencia(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adicionar_item_conferencia(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_conferencia(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_conferencia(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_conferencia(uuid, uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adicionar_item_conferencia(uuid, uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_conferencia(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_conferencia(uuid, text, uuid) TO authenticated, service_role;
