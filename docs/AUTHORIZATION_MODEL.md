# Modelo de autorização (Fase 0 da V2)

## 1. Fonte única de verdade

**O nível do perfil** (`user_profiles.perfil`) é a fonte única, calculado no banco por `app_private.nivel(user_id)`:
- nível **0** para usuário bloqueado ou sem perfil;
- **o banco decide:** a RLS e os triggers aplicam as regras;
- **o frontend repete as regras só para a interface** (`src/lib/permissions.ts`). O teste `tests/unit/regressao-v1.test.ts` garante que a tabela de níveis do frontend é idêntica à do banco.

| Nível | Perfil | Papel nos testes | Pode |
|---|---|---|---|
| 6 | `proprietario` | GLOBAL | Tudo, em todas as empresas; único no sistema |
| 5 | `super_admin` | GLOBAL | Tudo, em todas as empresas (dados globais: planos, avisos, cadastros-mestre, matriz de permissões, configurações e integrações) |
| 4 | `administrador` | ADMIN | Administra **a própria empresa**: usuários (até o próprio nível), metas, relatórios, histórico, auditoria da empresa, reabrir/excluir conferência com motivo |
| 3 | `gestor` | — | Vê todas as listas e o histórico da empresa; opera conferências |
| 2 | `agricola` / `industria` | ESTOQUISTA | Opera listas, materiais e conferências dos tipos do seu setor (listas legadas) ou de módulos da empresa |
| 1 | `usuario` | VISUALIZADOR | Não vê listas nem grava dados operacionais (igual à V1) |
| 0 | bloqueado | — | Nenhum acesso |

**Isolamento por empresa (`empresa_usuarios`):** todo dado operacional pertence a uma empresa, e o usuário só o alcança se for membro ativo dela. A exceção é o acesso global (nível ≥ 5).

**Funções-base:**
- `pertence_empresa`, `mesma_empresa`, `pode_unidade` e `acesso_unidade`;
- `pode_operar` (nível ≥ 2), criada na Fase 0.

## 2. Estrutura antiga: `user_roles` (enum `app_role`)

**Uso encontrado (mapeamento completo):**

| Onde | Uso |
|---|---|
| `handle_new_user` (trigger no cadastro) | Insere `conferente` para **todo** usuário novo |
| 16 policies | `conferencias`, `conferencia_itens`, `materiais`, `unidades` (insert/update/delete) e `material_imagens` (insert/update/delete) exigiam papel `admin`/`conferente` |
| `public.has_role` / `app_private.has_role` | Função de consulta; `public.has_role` era exposta via API e não é usada pelo código |
| policy de `usuarios_legados` | `has_role(uid, 'admin')` |
| Frontend | Nenhum uso. Só aparece nos tipos gerados e na lista de tabelas da restauração |

**Na produção:** os 2 usuários têm apenas `conferente`, e nenhum tem `admin`.

**Por que havia dois sistemas:** o `user_roles` veio da primeira versão (Lovable); os níveis de perfil vieram depois. Como **todo** usuário recebe `conferente` no cadastro, a exigência de `user_roles` era, na prática, "ter conta". O controle real já era o nível do perfil, por meio de `pode_unidade`/`pode_tipo`.

## 3. Migração das regras (feita na Fase 0, sem apagar a estrutura antiga)

| Antes | Depois (migration `20260929120100`) |
|---|---|
| `EXISTS user_roles IN (admin, conferente)` | `app_private.pode_operar(auth.uid())` (nível ≥ 2) |
| `perfil_atual() = 'administrador'` (proprietário/super_admin/admin, **mesmo bloqueados**) | `eh_administrador` (nível ≥ 4, bloqueado não passa) |
| `pode_tipo` por `perfil_atual()` | Pelo nível + perfil, respeitando bloqueio |
| `has_role(uid,'admin')` em `usuarios_legados` | `eh_global` |

**Equivalência com os dados atuais da produção:**
- quem tem `conferente` (todos) e passa em `pode_unidade` já tem nível ≥ 2, porque `pode_unidade` exige isso;
- portanto, para os usuários existentes, o resultado é o mesmo;
- a única diferença é que usuários **bloqueados** passam a ser barrados em todos os pontos.

**Mantidos, sem remoção:**
- **tabela e enum:** `user_roles`, `app_role`;
- **funções e trigger:** `app_private.has_role`, e `handle_new_user`, que continua gravando `conferente`.

**Remoção futura**, em migration separada, depois de a Fase 0 estar em produção e estável:
1. confirmar em produção que nenhuma policy ou função usa `user_roles`: `SELECT ... FROM pg_policies WHERE qual ILIKE '%user_roles%'` deve retornar vazio;
2. remover o `INSERT` de `handle_new_user`;
3. dropar `public.has_role`, `app_private.has_role`, `user_roles` e `app_role`;
4. regerar `src/integrations/supabase/types.ts`.

## 4. Brechas corrigidas na Fase 0

Todas são cobertas por testes. As que falhavam na baseline (a produção atual) estão marcadas com ✗.

| Brecha | Antes | Agora |
|---|---|---|
| Administrador se promove a `super_admin` (nível 5, global) pela API | ✗ permitido | Recusado (trigger `proteger_hierarquia`) |
| Administrador atribui perfil acima do próprio nível ou altera usuário de nível superior | ✗ permitido | Recusado |
| Administrador criado antes de 10/08/2026 vê e altera usuários de **todas** as empresas | ✗ permitido | Só a própria empresa |
| Lista sem empresa visível para qualquer usuário | ✗ | Só acesso global |
| Imagem de material de outra empresa pode ser anexada/excluída | ✗ | Recusado |
| Administrador de qualquer empresa altera planos, avisos para todos, cadastros-mestre, matriz de permissões, configurações e integrações globais | ✗ | Só acesso global |
| Administrador vê pausas, e-mails enviados, sessões, auditoria e pagamentos de outras empresas | ✗ | Só da própria empresa |
| Usuário bloqueado mantém acesso via `perfil_atual()` | ✗ | Barrado |
| `public.has_role` executável pela API | ✗ | Revogado |

`perfil_atual()` permanece em uso só para **público-alvo** (`avisos_sistema.destino_perfil` e leitura de `permissoes_perfil`), não para autorização.

## 5. Operações administrativas explícitas

| RPC | Quem | Regra |
|---|---|---|
| `reabrir_conferencia(id, motivo)` | Nível ≥ 4 com acesso à lista | Motivo ≥ 5 caracteres; não reabre se já houver conferência aberta; auditada |
| `excluir_conferencia(id, motivo)` | Nível ≥ 4 com acesso à lista | Auditada, com status, data e motivo |
| `excluir_unidade(id, motivo)` | Nível ≥ 4 com acesso à lista | Lista com histórico; auditada |

**Rotinas do servidor (`service_role`):** podem corrigir dados, e **toda** alteração em conferência encerrada gera um registro de auditoria automático.

## 6. Testes

`tests/db/rls-isolamento.test.ts`:
- matriz ADMIN, ESTOQUISTA, VISUALIZADOR, GESTOR, BLOQUEADO, Empresa A × Empresa B, anônimo e global;
- SELECT, INSERT, UPDATE e DELETE em listas, materiais, conferências, itens, usuários, empresas, histórico, auditoria, sessões e permissões;
- hierarquia e funções expostas.

**Como rodar:** ver `docs/DATABASE_BASELINE.md` §6.
