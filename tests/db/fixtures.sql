-- Dados de TESTE (nunca aplicar em produção). Executado como "postgres" no banco-modelo.
-- IDs fixos: ver tests/db/fixtures.ts.

-- Usuários (o trigger on_auth_user_created cria profiles, user_roles e user_profiles).
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-00000000d0e0', 'dono@teste.local',    '{"nome":"Dono"}'),
  ('00000000-0000-4000-8000-00000000a001', 'admin.a@teste.local', '{"nome":"Admin A"}'),
  ('00000000-0000-4000-8000-00000000a002', 'estq.a@teste.local',  '{"nome":"Estoquista A"}'),
  ('00000000-0000-4000-8000-00000000a003', 'gestor.a@teste.local','{"nome":"Gestor A"}'),
  ('00000000-0000-4000-8000-00000000a004', 'visu.a@teste.local',  '{"nome":"Visualizador A"}'),
  ('00000000-0000-4000-8000-00000000a005', 'bloq.a@teste.local',  '{"nome":"Bloqueado A"}'),
  ('00000000-0000-4000-8000-00000000b001', 'admin.b@teste.local', '{"nome":"Admin B"}'),
  ('00000000-0000-4000-8000-00000000b002', 'estq.b@teste.local',  '{"nome":"Estoquista B"}'),
  ('00000000-0000-4000-8000-00000000c001', 'legado@teste.local',  '{"nome":"Legado"}');

UPDATE public.user_profiles SET perfil = 'proprietario' WHERE user_id = '00000000-0000-4000-8000-00000000d0e0';
UPDATE public.user_profiles SET perfil = 'administrador', created_at = '2026-07-01T00:00:00Z'
 WHERE user_id = '00000000-0000-4000-8000-00000000a001';
UPDATE public.user_profiles SET perfil = 'gestor' WHERE user_id = '00000000-0000-4000-8000-00000000a003';
UPDATE public.user_profiles SET perfil = 'usuario' WHERE user_id = '00000000-0000-4000-8000-00000000a004';
UPDATE public.user_profiles SET bloqueado = true WHERE user_id = '00000000-0000-4000-8000-00000000a005';
UPDATE public.user_profiles SET perfil = 'administrador' WHERE user_id = '00000000-0000-4000-8000-00000000b001';

INSERT INTO public.usuarios_legados (user_id, email) VALUES
  ('00000000-0000-4000-8000-00000000d0e0', 'dono@teste.local'),
  ('00000000-0000-4000-8000-00000000c001', 'legado@teste.local');

INSERT INTO public.empresas (id, nome) VALUES
  ('00000000-0000-4000-8000-000000000e0a', 'Empresa A'),
  ('00000000-0000-4000-8000-000000000e0b', 'Empresa B');

INSERT INTO public.empresa_usuarios (empresa_id, user_id, papel) VALUES
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000d0e0', 'proprietario'),
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000a001', 'administrador'),
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000a002', 'membro'),
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000a003', 'membro'),
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000a004', 'membro'),
  ('00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-00000000a005', 'membro'),
  ('00000000-0000-4000-8000-000000000e0b', '00000000-0000-4000-8000-00000000b001', 'administrador'),
  ('00000000-0000-4000-8000-000000000e0b', '00000000-0000-4000-8000-00000000b002', 'membro');

INSERT INTO public.empresa_modulos (id, empresa_id, codigo, nome, tipo) VALUES
  ('00000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000e0a', 'ALMOX', 'Almoxarifado A', 'lista'),
  ('00000000-0000-4000-8000-000000000f0b', '00000000-0000-4000-8000-000000000e0b', 'ALMOX', 'Almoxarifado B', 'lista');

INSERT INTO public.unidades (id, tipo, nome, empresa_id, modulo_id, gestor) VALUES
  ('00000000-0000-4000-8000-0000000001a1', 'caminhao', 'Caminhão A1', '00000000-0000-4000-8000-000000000e0a', NULL, 'Gestor A'),
  ('00000000-0000-4000-8000-0000000001a2', 'caminhao', 'Caminhão A2', '00000000-0000-4000-8000-000000000e0a', NULL, NULL),
  ('00000000-0000-4000-8000-0000000001a3', 'lista',    'Prateleira módulo A', '00000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000f0a', NULL),
  ('00000000-0000-4000-8000-0000000001a4', 'caixa_industria', 'Caixa indústria A', '00000000-0000-4000-8000-000000000e0a', NULL, NULL),
  ('00000000-0000-4000-8000-0000000001a5', 'caminhao', 'Caminhão vazio A', '00000000-0000-4000-8000-000000000e0a', NULL, NULL),
  ('00000000-0000-4000-8000-0000000001b1', 'caminhao', 'Caminhão B1', '00000000-0000-4000-8000-000000000e0b', NULL, NULL),
  ('00000000-0000-4000-8000-0000000001c1', 'caminhao', 'Lista sem empresa', NULL, NULL, NULL);

INSERT INTO public.materiais (id, unidade_id, codigo, descricao, quantidade_esperada, locacao) VALUES
  ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000001a1', 'P-001', 'Parafuso', 10, 'A-01'),
  ('00000000-0000-4000-8000-0000000002a2', '00000000-0000-4000-8000-0000000001a1', 'P-002', 'Porca', 5, 'A-02'),
  ('00000000-0000-4000-8000-0000000002a3', '00000000-0000-4000-8000-0000000001a1', 'P-003', 'Arruela', 0, 'A-03'),
  ('00000000-0000-4000-8000-0000000002a4', '00000000-0000-4000-8000-0000000001a2', 'Q-001', 'Chave', 2, NULL),
  ('00000000-0000-4000-8000-0000000002a5', '00000000-0000-4000-8000-0000000001a3', 'M-001', 'Luva', 4, NULL),
  ('00000000-0000-4000-8000-0000000002a6', '00000000-0000-4000-8000-0000000001a4', 'I-001', 'Motor', 1, NULL),
  ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000001b1', 'B-001', 'Material B', 7, NULL),
  ('00000000-0000-4000-8000-0000000002c1', '00000000-0000-4000-8000-0000000001c1', 'S-001', 'Sem empresa', 1, NULL);

INSERT INTO public.conferencias (id, unidade_id, tipo, status, hora_inicio, hora_fim, assinatura, conferente, created_by) VALUES
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000001a1', 'caminhao', 'finalizada',
   now() - interval '3 hours', now() - interval '2 hours', 'data:image/png;base64,QUJD', 'Estoquista A', '00000000-0000-4000-8000-00000000a002'),
  ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-4000-8000-0000000001a1', 'caminhao', 'cancelada',
   now() - interval '5 hours', now() - interval '4 hours', NULL, 'Estoquista A', '00000000-0000-4000-8000-00000000a002'),
  ('00000000-0000-4000-8000-0000000003a3', '00000000-0000-4000-8000-0000000001a2', 'caminhao', 'em_andamento',
   now() - interval '10 minutes', NULL, NULL, 'Estoquista A', '00000000-0000-4000-8000-00000000a002'),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000001b1', 'caminhao', 'finalizada',
   now() - interval '3 hours', now() - interval '2 hours', 'data:image/png;base64,QkJC', 'Estoquista B', '00000000-0000-4000-8000-00000000b002');

INSERT INTO public.conferencia_itens (id, conferencia_id, material_id, codigo, descricao, quantidade_esperada, quantidade_contada, status) VALUES
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000002a1', 'P-001', 'Parafuso', 10, 10, 'conferido'),
  ('00000000-0000-4000-8000-0000000004a2', '00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000002a2', 'P-002', 'Porca', 5, 3, 'divergencia'),
  ('00000000-0000-4000-8000-0000000004a3', '00000000-0000-4000-8000-0000000003a3', '00000000-0000-4000-8000-0000000002a4', 'Q-001', 'Chave', 2, NULL, 'pendente'),
  ('00000000-0000-4000-8000-0000000004b1', '00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000002b1', 'B-001', 'Material B', 7, 7, 'conferido');

INSERT INTO public.historico_conferencias (conferencia_id, unidade_id, user_id, lista, status) VALUES
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000a002', 'Caminhão A1', 'finalizada'),
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-00000000b002', 'Caminhão B1', 'finalizada');

INSERT INTO public.notificacoes_conferencia (conferencia_id, unidade_id, user_id, tipo, empresa_id) VALUES
  ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-0000000001b1', '00000000-0000-4000-8000-00000000b002', 'conferencia_concluida', '00000000-0000-4000-8000-000000000e0b');

INSERT INTO public.auditoria (user_id, usuario, acao, detalhe) VALUES
  ('00000000-0000-4000-8000-00000000a002', 'estq.a@teste.local', 'login', 'Acesso A'),
  ('00000000-0000-4000-8000-00000000b002', 'estq.b@teste.local', 'login', 'Acesso B');

INSERT INTO public.sessoes_usuario (user_id, dispositivo) VALUES
  ('00000000-0000-4000-8000-00000000b002', 'Celular B');

INSERT INTO public.planos (codigo, nome, ambiente) VALUES ('basico', 'Básico', 'live');
INSERT INTO public.configuracoes_sistema (chave, valor) VALUES ('emails_conferencia', '{"destinatarios":["gestor@a.local"]}');

-- A carga acima cria conferências abertas: o banco gera avisos de início (servidor) no COMMIT.
-- Os testes partem sem esses avisos: executa os triggers adiados agora e remove o que geraram.
SET CONSTRAINTS ALL IMMEDIATE;
DELETE FROM public.notificacoes_conferencia WHERE chave IS NOT NULL;
