# Relatório da Fase 0 — Fundação, segurança e integridade

- **Branch:** `v2-development`, criada a partir de `35df1d5`, o commit em produção.
- **Situação:** concluída na branch e **aguardando revisão**.
- **O que não foi feito:** nenhum deploy, merge, APK publicado ou migration executada na produção.

## 1. Alterações realizadas

**Banco (arquivos de migration, NÃO executados na produção)**
- **Baseline:** schema de referência gerado do catálogo real da produção e comprovado **idêntico** por comparação automática.
- **Migrations antigas:** as 70 foram preservadas, sem alteração, em `supabase/migrations_legado/`.
- **Autorização com fonte única** (nível do perfil) e **isolamento por empresa** reforçado. Foram fechadas 2 brechas novas encontradas nesta fase:
  - **escalada para super_admin:** um administrador podia se promover pela API direta;
  - **acesso entre empresas:** administradores alcançavam dados de outras empresas e dados globais.
- **Conferência encerrada imutável** no banco:
  - não pode ser alterada, reaberta ou excluída por usuários;
  - seus itens também não;
  - repetir a mesma finalização é aceito sem efeito.
- **Transições válidas:**
  - cancelada não vira finalizada, e finalizada não vira cancelada;
  - finalizar exige assinatura;
  - encerrar sempre registra `hora_fim`.
- **Uma conferência aberta por lista** (índice único parcial). "Aberta" = `em_andamento` ou `pausada`.
- **Coerência dos itens:** CHECKs de status × quantidade, contagem não negativa, status e origem válidos.
- **Operações administrativas explícitas com motivo e auditoria:** `reabrir_conferencia`, `excluir_conferencia`, `excluir_unidade`. Alterações feitas pelo servidor em conferência encerrada também são auditadas automaticamente.
- **Fundação de idempotência:**
  - tabela `conferencia_operacoes`;
  - RPCs `iniciar_conferencia` (conferência + itens + histórico numa transação), `adicionar_item_conferencia`, `finalizar_conferencia` e `cancelar_conferencia`, com ids gerados no aparelho.
- **Limite persistente de tentativas de login** (`consumir_limite_tentativa`, só para o servidor, chaves em hash).
- **Tempo trabalhado de conferência encerrada** não é mais recalculado por uma atualização repetida.

**Aplicação web**
- `registrarTentativaLogin`:
  - não recebe nem testa mais a senha;
  - responde sempre igual;
  - aplica limite persistente por e-mail e por IP;
  - só registra e-mail com formato válido.
- Tela de login: mensagem única "E-mail ou senha inválidos." (não revela o motivo) e a senha não é mais enviada ao servidor.
- Correção do erro de tipagem pré-existente em `__root.tsx`: `npm run typecheck` agora passa sem erros.

**Android**
- APK distribuído verificado:
  - pacote `br.com.conferenciarapida.app`, versionCode 6;
  - assinatura v2 com a `debug.keystore` pública.
- Assinatura de produção preparada com **rotação de chave**, para os aparelhos atualizarem sem desinstalar:
  - scripts de assinatura, verificação e teste de instalação;
  - o Gradle nunca aplica a chave nova sozinho.
- Workflow da V2 (`android-v2-assinatura.yml`), que **não publica nada**:
  - confere o APK distribuído;
  - testa instalação e atualização em emulador (Android 8 e 11);
  - valida os secrets quando existirem.
- Workflow de publicação (`android-apk.yml`), para quando for integrado:
  - só usa a chave de produção com a variável `ANDROID_ROTACAO_APROVADA=true`;
  - sempre com rotação;
  - bloqueia a publicação de APK incompatível com o app instalado.

**Testes e CI**
- 119 testes automatizados (vitest):
  - unitários;
  - banco: RLS, isolamento, integridade, idempotência, regressão da V1 e limite de login.
- CI da V2 (`v2-ci.yml`), **sem deploy**, com Postgres 17 igual à produção:
  - typecheck, lint dos arquivos novos e testes;
  - prova da baseline;
  - build web.

## 2. Arquivos

| Tipo | Arquivos |
|---|---|
| Novos — banco | `supabase/migrations/20260929120000_baseline_v2.sql`, `…120100_fase0_autorizacao_isolamento.sql`, `…120200_fase0_integridade_conferencias.sql`, `…120300_fase0_operacoes_idempotentes.sql`, `…120400_fase0_limite_tentativas_login.sql`; `supabase/baseline/*` (gerador, consultas, comparação, snapshot do catálogo); `supabase/tests/bootstrap.sql`; `supabase/migrations_legado/LEIA-ME.md` |
| Movidos (sem alteração) | 70 arquivos `supabase/migrations/*.sql` → `supabase/migrations_legado/` |
| Novos — app | `src/lib/tentativas-login.server.ts`, `vitest.config.ts` |
| Alterados — app | `src/lib/audit.functions.ts`, `src/routes/entrar.tsx`, `src/routes/__root.tsx`, `package.json`, `package-lock.json` (só dependências de teste: vitest, pg, @types/pg), `.gitignore` |
| Testes | `tests/db/*` (ambiente, dados de teste, 5 suítes), `tests/unit/*` (2 suítes) |
| Android | `mobile/android/app/build.gradle`, `scripts/android/*.sh`, `.github/workflows/android-v2-assinatura.yml`, `.github/workflows/android-apk.yml` |
| CI | `.github/workflows/v2-ci.yml`, `scripts/db-teste.sh` |
| Documentação | `docs/DATABASE_BASELINE.md`, `docs/AUTHORIZATION_MODEL.md`, `docs/ANDROID_SIGNING.md`, este relatório; atualizados `docs/SECURITY_AUDIT_V2.md`, `docs/V2_AUDIT.md`, `docs/V2_ROADMAP.md` |

## 3. Migrations criadas

| Versão | Nome |
|---|---|
| 20260929120000 | `baseline_v2`: schema atual (só **marcar** como aplicada na produção) |
| 20260929120100 | `fase0_autorizacao_isolamento` |
| 20260929120200 | `fase0_integridade_conferencias` |
| 20260929120300 | `fase0_operacoes_idempotentes` |
| 20260929120400 | `fase0_limite_tentativas_login` |

## 4. Migrations que NÃO foram executadas

**Todas as cinco acima** estão sem execução na produção. Elas só rodaram em bancos de teste descartáveis: Postgres 16 local e Postgres 17 no CI.

Também não foi feito o ajuste do histórico (`supabase migration repair`), descrito em `DATABASE_BASELINE.md` §5.

## 5. Testes realizados

| Suíte | Testes | Resultado (local) |
|---|---|---|
| `tests/db/integridade-conferencia` | 31 | ✅ todos passam |
| `tests/db/rls-isolamento` (ADMIN, ESTOQUISTA, VISUALIZADOR, GESTOR, BLOQUEADO, Empresa A × B, anônimo, global) | 32 | ✅ |
| `tests/db/idempotencia` (inclui corrida real entre duas sessões) | 15 | ✅ |
| `tests/db/regressao-v1` (fluxo completo da V1 com as mesmas gravações da tela) | 15 | ✅ |
| `tests/db/limite-login` | 5 | ✅ |
| `tests/unit/tentativas-login` (resposta uniforme, sem senha, limite) | 10 | ✅ |
| `tests/unit/regressao-v1` (níveis frontend = banco, importação, login offline, fila offline) | 11 | ✅ |
| **Total** | **119** | **119 ✅** |

**Contraprova:** as mesmas suítes de banco rodaram contra a **baseline**, que é o schema atual da produção.
- **38 testes falham** ali, e são exatamente as brechas corrigidas.
- Na regressão da V1, **os 11 fluxos da V1 passam antes e depois**. Só os 4 comportamentos alterados de propósito diferem.

**Demais verificações:**
- baseline × produção: catálogos idênticos;
- `npm run typecheck`: sem erros;
- lint dos arquivos novos: sem erros. O repositório tem 3.285 apontamentos de formatação **anteriores** à V2, não alterados;
- `npm run build`: passou, sem deploy.

**CI no GitHub (Postgres 17, igual à produção):** `v2-ci.yml` ✅ — baseline idêntica, 119 testes, typecheck, lint e build.

**Android (CI):** conferência do APK distribuído ✅; testes unitários e lint Android ✅; emuladores Android 8 e Android 11 ✅ (0 falhas): instalação, **atualização com rotação preservando os dados**, atualização com a mesma chave, recusa de APK com outra chave e, no Android 11, recusa de APK só com a chave antiga após a rotação (`ANDROID_SIGNING.md` §3).

## 6. Riscos restantes

- **Chave Android pública** continua em uso até a chave de produção ser criada e a transição executada (`ANDROID_SIGNING.md` §5).
  - Aparelhos Android 7/8 continuarão aceitando a chave antiga mesmo após a rotação.
  - **Não cadastrar `ANDROID_KEYSTORE_BASE64` antes da integração** (o workflow atual de produção o usaria sem rotação).
- **Offline e sincronização da V1 inalterados** (R-01 a R-09 da auditoria), a tratar na V2.2/V2.3. A Fase 0 impede que esses defeitos corrompam conferências encerradas ou criem conferências abertas duplicadas.
  - Porém uma operação offline que agora for **recusada** pelo banco (ex.: contagem enviada depois da finalização) cai na regra da V1 de descartar após 8 tentativas (R-02).
- **Sessão offline em texto claro** e cache não particionado por usuário (S-04, S-05): V2.2.
- **Proteção contra senhas vazadas desativada** no Supabase Auth (S-07): ação no painel.
- **Auditoria ainda gravável pelo cliente** para eventos comuns (S-03, parcial): V2.4.
- **Usuário legado sem empresa** (conta "aprendiz") continua acessando a empresa legada por regra de legado. Recomendado vinculá-lo formalmente à empresa, o que é uma alteração de dados e depende da sua decisão.
- **Base64 de assinaturas no banco:** plano de migração em `DATABASE_BASELINE.md` §7.

## 7. Impacto na V1

Nenhum hoje: nada foi aplicado na produção. **Quando as migrations forem aplicadas:**
- **Fluxos iguais:** login, usuários, empresas, listas, materiais, importação, início, contagem, divergência, material adicional, pausa, retomada, finalização (inclusive duplo clique), cancelamento, histórico, auditoria, Conferência Única e fila offline. Tudo isso é coberto pela regressão.
- **Mudanças intencionais**, visíveis como mensagem de erro na tela atual:
  1. **"Excluir" no histórico** de conferência finalizada/cancelada é recusado. O administrador usa `excluir_conferencia`, com motivo; a V1 não tem esse botão ainda.
  2. **Excluir uma lista que tem histórico** é recusado (usar `excluir_unidade`).
  3. **Segunda conferência aberta na mesma lista** é recusada (antes duplicava).
  4. **Contagem negativa** é recusada.
  5. **Usuário bloqueado** perde acesso também nos pontos em que a V1 ainda o deixava passar.
  6. **Administradores de empresa (nível 4)** deixam de alterar dados **globais** e de ver dados de outras empresas. Hoje só o proprietário é administrador, então não há impacto para os usuários atuais.
- **Ordem de publicação:** aplicar as migrations **antes** do código web novo.

## 8. Próximos passos recomendados

1. **Revisar** esta Fase 0 e os resultados do CI na `v2-development`.
2. **Criar a chave Android de produção** com backup (`ANDROID_SIGNING.md` §4). **Não** cadastrar os secrets antes da integração.
3. **Ativar a proteção contra senhas vazadas** no Supabase (Authentication → Password security).
4. **Decidir sobre o vínculo** da conta legada "aprendiz" com a empresa.
5. **Aplicar a Fase 0 em produção**, quando aprovada: backup → conferência do catálogo → `migration repair` → migrations → código web. Nessa mesma entrega, incluir na V1 as mensagens e o botão administrativo para os itens 1 e 2 do §7.
6. **Autorizar a V2.2/V2.3** (offline e sincronização), que passarão a usar as RPCs idempotentes criadas aqui.
