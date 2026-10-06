# Baseline do banco de dados (Fase 0 da V2)

> Nenhuma migration foi executada na produção para produzir esta baseline.
> Todo o levantamento foi feito com consultas **somente leitura** ao catálogo do Postgres.
> Data: 29/09/2026.

## 1. Estado real atual (produção)

| Item | Valor |
|---|---|
| Projeto | Supabase `phixzybxehifndmukvte` |
| Postgres | 17.6 |
| Schemas do sistema | `public`, `app_private` |
| Tabelas | 35 em `public` + 1 em `app_private` (`hook_secrets`), todas com RLS |
| Funções próprias | 48 (`public` + `app_private`) |
| Triggers | 31, incluindo `on_auth_user_created` em `auth.users` |
| Policies | 110 |
| Extensões | `pgcrypto`, `uuid-ossp`, `pg_trgm`, `pg_stat_statements` (em `extensions`); `pg_cron`, `pg_net`, `supabase_vault` (plataforma) |
| Realtime | `conferencias`, `conferencia_itens`, `historico_conferencias`, `notificacoes_conferencia` |
| Agendamento | `pg_cron` job `monitor-conferencias` (a cada 5 min). O segredo fica só no banco e **não** está no repositório |

**Snapshot do catálogo:** `supabase/baseline/catalogo_producao_20260929.json`.
- **Conteúdo:** tabelas, colunas, restrições, índices, funções com ACL, triggers, RLS, policies e grants.
- **Sem dados e sem segredos.**
- **Gerado por:** `supabase/baseline/consultas_catalogo.sql`.

## 2. Histórico de migrations: repositório × banco

| Onde | O que existe |
|---|---|
| Repositório (antes da Fase 0) | **70 arquivos**: 68 gerados na Lovable + 2 criados na migração (`importar_dados_legados`, `diagnostico_perfil_real`). O número "72" citado na auditoria estava errado |
| `supabase_migrations.schema_migrations` (produção) | **5 registros**: `00_extensoes_agendamento`, `lote01_20260731_20260801a`, `lote02_20260801b`, `importar_dados_legados`, `diagnostico_perfil_real`. Os 68 arquivos foram aplicados em lotes, com nomes e versões diferentes dos arquivos |

**Comparação objeto por objeto** (script em `supabase/baseline/`):
- 228 objetos são criados pelos 70 arquivos (funções, tabelas, policies e triggers).
- **Todos existem na produção** ou foram removidos por um arquivo posterior (5 casos). Nenhum está pendente.
- **Nenhum** objeto da produção existe sem arquivo de origem.

**Classificação dos arquivos:**
- **Migrations aplicadas:** todas as 70, pelo conteúdo.
- **Não aplicadas:** nenhuma.
- **Duplicadas:** muitas recriam a mesma função ou policy várias vezes (`CREATE OR REPLACE`/`DROP`+`CREATE` sucessivos), típico da Lovable. O efeito final é o do último arquivo.
- **Incompatíveis:** não podem ser reaplicadas na produção. As versões registradas no banco não batem com os nomes dos arquivos, e vários arquivos não são idempotentes (ex.: `INSERT` de usuários legados, agendamento que **recria o segredo** do monitor).
- **Obsoletas:** todas, como histórico. Foram movidas **sem alteração** para `supabase/migrations_legado/` e não foram apagadas.

## 3. Schema de referência

`supabase/migrations/20260929120000_baseline_v2.sql`:
- gerado por `supabase/baseline/gerar_baseline.py` a partir do catálogo real;
- recria **exatamente** o schema de produção em um banco vazio, sem dados;
- não contém segredos: `hook_secrets` vai vazia, e o agendamento só é criado onde `pg_cron`/`pg_net` existem, com um segredo aleatório gerado no próprio banco.

**Prova de fidelidade**, executada localmente e no CI (`v2-ci.yml`, passo "Baseline idêntica à produção"):
1. aplica a baseline num Postgres vazio, com `supabase/tests/bootstrap.sql` simulando a plataforma;
2. lê o catálogo com as mesmas consultas usadas na produção;
3. compara com `comparar_catalogo.py`. Resultado: **idênticos** em tabelas, colunas, restrições, índices, funções (definição e ACL), triggers, RLS, policies e grants.

**Únicas diferenças aceitas:**
- privilégio `MAINTAIN`, que só existe no Postgres 17 e é aplicado condicionalmente;
- dono/ACL do schema `public`, que é da plataforma.

## 4. Migrations novas (a partir da baseline)

| Versão | Arquivo | Conteúdo |
|---|---|---|
| 20260929120100 | `fase0_autorizacao_isolamento.sql` | Autorização por nível (fonte única), isolamento por empresa, proteção da hierarquia de perfis |
| 20260929120200 | `fase0_integridade_conferencias.sql` | Conferência encerrada imutável, uma aberta por lista, CHECKs, operações administrativas auditadas |
| 20260929120300 | `fase0_operacoes_idempotentes.sql` | `conferencia_operacoes` + RPCs idempotentes (iniciar, adicionar item, finalizar, cancelar) |
| 20260929120400 | `fase0_limite_tentativas_login.sql` | Limite persistente para o registro de tentativas de login |

**Todas são aditivas:**
- não removem tabelas, colunas ou dados;
- a única coluna nova é `conferencias.motivo_cancelamento`, anulável.

**Validação:**
- aplicadas e testadas em bancos de teste descartáveis (Postgres 16 local e 17 no CI): 119 testes;
- **nenhuma foi executada na produção.**

## 5. Estratégia de baseline para a produção (NÃO executada)

Quando a Fase 0 for aprovada, o schema de produção **não** é recriado. Só o registro do histórico é ajustado. Ordem sugerida:

1. **Backup:** exportar o banco, pelo painel do Supabase ou com `pg_dump`.
2. **Conferir a produção:** rodar `consultas_catalogo.sql` e comparar com o snapshot (`comparar_catalogo.py`). Se algo mudou desde 29/09, gerar a baseline de novo **antes** de continuar.
3. **Ajustar o histórico** (só a tabela de histórico, sem tocar no schema):
   ```
   supabase migration repair --status reverted 20260928222955 20260928223147 20260928223344 20260929003722 20260929011138
   supabase migration repair --status applied  20260929120000
   ```
4. **Aplicar as migrations da Fase 0:**
   - `supabase db push` aplica só as versões `2026092912010x` em diante;
   - aplicar **antes** de publicar o novo código web (o `registrarTentativaLogin` novo depende de `consumir_limite_tentativa`);
   - sem a migration, o registro de tentativas apenas não grava, e o login não é afetado.
5. **Conferir de novo o catálogo** após a aplicação.

**Regra daqui em diante:**
- toda alteração de banco é uma nova migration em `supabase/migrations/`, posterior à baseline;
- a migration é testada antes em banco descartável (`npm run test:db`);
- **nunca** alterar o banco de produção direto pelo painel ou pelo SQL editor.

## 6. Como rodar os testes de banco

```bash
scripts/db-teste.sh iniciar      # Postgres local descartável (porta 54329)
export PG_ADMIN_URL=postgresql://supabase_admin:supabase_admin@127.0.0.1:54329/postgres
npm run test:db                  # cria um banco-modelo: bootstrap + migrations + dados de teste
CR_MIGRATIONS_ATE=20260929120000 npm run test:db   # mesmos testes contra o schema ATUAL da produção
```
A URL é recusada se apontar para `supabase.co`/`supabase.com`.

## 7. Fotos e assinaturas (item 15 — somente documentação)

**Estrutura atual:** base64 (data-URL) dentro de colunas de texto ou JSON, sem Supabase Storage.

| Onde | Formato | Volume em produção (29/09) |
|---|---|---|
| `conferencia_itens.fotos` (jsonb) | lista de data-URLs JPEG (700px, qualidade 0,7) | 0 fotos (7.013 itens, 35 KB de `[]`) |
| `conferencias.assinatura` / `assinatura_gestor` | data-URL PNG | 35 assinaturas, ~880 KB, maior 40 KB |
| `materiais.imagem_principal` | data-URL JPEG (900px) | 0 |
| `material_imagens.url_imagem` | data-URL | 0 |
| `user_profiles.foto_url` / `assinatura` | texto | 1 |

**Impacto:**
- cada linha fica pesada;
- o cache offline guarda tabelas inteiras, então as imagens vão para a memória e o IndexedDB do celular;
- `select *` de conferências traz as assinaturas;
- a Realtime replica linhas com `REPLICA IDENTITY FULL`, incluindo as imagens.

Com o volume atual o impacto é pequeno, mas cresce rápido com fotos de divergência.

**Plano de migração (V2.2/V2.3, não executado):**
1. Bucket privado `conferencias` no Supabase Storage, com policies por empresa/lista (mesma regra de `pode_unidade`).
2. Colunas novas anuláveis `assinatura_path`, `assinatura_gestor_path`; tabela `conferencia_item_fotos (id, item_id, path, criado_em)`.
3. Novas fotos e assinaturas enviadas ao Storage por uma fila de upload retomável; o registro guarda só o caminho.
4. Migração gradual dos dados existentes por uma rotina do servidor, conferência por conferência, sem apagar o base64 até a conferência completa.
5. Leitura com URL assinada de curta duração; relatórios PDF passam a buscar a imagem pelo caminho.
6. Só depois de validado: remover o base64 (migration separada, com backup).
