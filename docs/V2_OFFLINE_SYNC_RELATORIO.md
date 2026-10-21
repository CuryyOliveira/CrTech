# Conferência Rápida — V2.2 + V2.3: Offline e Sincronização Confiável

Branch: `v2-development` · Data: 29/09/2026 · **Nada foi aplicado na produção**: sem deploy, sem merge,
sem migration em banco real. Tudo foi validado em banco de teste descartável (Postgres local / CI).

---

## 1. Resumo

A sincronização da conferência deixou de ser "copiar linhas da tabela" e passou a ser **orientada a
eventos**:

- cada ação (iniciar, contar, incluir material, pausar, retomar, assinar, foto, finalizar, cancelar)
  vira um **evento com `event_id` gerado no aparelho**;
- o evento é gravado no IndexedDB **na mesma transação** que atualiza a tela: fechar o app logo depois
  não perde nada;
- o servidor aplica cada evento **uma única vez** (idempotência pelo `event_id`), mesmo com timeout,
  resposta perdida, reenvio, duplo toque ou dois envios simultâneos;
- o servidor devolve as alterações (inclusive exclusões) por um **cursor confiável** que nunca pula
  uma transação lenta;
- nada é descartado automaticamente: falhas repetidas vão para **NEEDS_ATTENTION** e conflitos para
  **CONFLICT**. Só uma decisão explícita do usuário tira um evento da fila, e a decisão fica registrada.

A V1 continua funcionando. As telas atuais de conferência seguem no motor V1 (agora endurecido,
seção 11) até a **V2.1 (conferência mobile)** trocar a interface para o motor V2. O motor V2 e o
indicador global já estão prontos e ligados por uma flag (`VITE_SYNC_V2=1`), desligada por padrão.

---

## 2. Arquitetura

```
 APARELHO (por usuário)                                   SERVIDOR (Supabase/Postgres)
 ┌──────────────────────────────────────────┐            ┌────────────────────────────────────────┐
 │ Tela ──ação──► MotorSync.registrar()      │            │ processar_eventos_conferencia(lote)    │
 │   uma transação IndexedDB:                │  push      │   por evento (subtransação):           │
 │   evento + fila(PENDING) + efeito na tela │──────────► │   lock por event_id → já existe?       │
 │                                           │  lote ≤50  │     sim: devolve o resultado gravado   │
 │ fila: PENDING→SYNCING→SYNCED              │            │     não: aplica regra do tipo,         │
 │        ↘ FAILED (backoff) ↘ NEEDS_ATTENTION│ ◄──────── │          grava conferencia_eventos      │
 │        ↘ CONFLICT (usuário decide)        │ resultados │          (aplicado/conflito/rejeitado) │
 │                                           │            │                                        │
 │ fotos: ArrayBuffer local → Storage → evento│──upload──►│ bucket "conferencias" (policies)        │
 │                                           │            │                                        │
 │ pull: cursor "txid:seq" ─────────────────►│  pull      │ alteracoes_sync (change log, triggers) │
 │   aplica upserts/tombstones + reaplica    │ ◄──────────│   só transações terminadas (watermark) │
 │   eventos locais ainda não refletidos     │            │   RLS: só o que o usuário pode ver     │
 └──────────────────────────────────────────┘            └────────────────────────────────────────┘
```

### 2.1 Servidor

| Peça | O que faz |
|---|---|
| `conferencia_eventos` | Registro imutável e auditável de todos os eventos (event_id, conference_id, device_id, user_id, company_id, event_type, created_at_device, `hora_aplicada`, received_at_server, payload **sem imagens**, schema_version, status, resultado). Sem INSERT/UPDATE/DELETE para usuários: só a função definer grava. |
| `processar_evento_conferencia(jsonb)` / `processar_eventos_conferencia(jsonb)` | Idempotência (advisory lock por event_id + consulta ao registro), aplicação do evento numa subtransação, classificação do resultado, gravação do registro. Lote de até 200 eventos, na ordem. |
| Versionamento de itens | `conferencia_itens.versao / ultimo_dispositivo / ultimo_evento` (trigger). Base da detecção de conflito. |
| Pausas pela hora do evento | `conferencias_tempo_pausa` usa a hora do evento (ou a hora enviada pela V1), com limites: não antes da última retomada/início, não mais que 5 min no futuro. |
| `conferencia_fotos` + bucket `conferencias` | Metadados da foto (id gerado no aparelho, caminho único `<empresa>/<conferencia>/<foto>.<ext>`). Policies do Storage por empresa/lista; sem UPDATE/DELETE para usuários. |
| `alteracoes_sync` | Change log (upsert/delete) de `unidades`, `materiais`, `conferencias`, `conferencia_itens`, `conferencia_fotos`, preenchido por triggers. Guarda o escopo de acesso do momento da alteração (vale para exclusões). |
| `cursor_sync_inicial()`, `snapshot_sync()`, `alteracoes_sync()` | Carga inicial paginada + alterações incrementais com cursor `txid:seq` e marca d'água. |
| `limpar_alteracoes_sync(dias)` + cron diário | Limpeza do change log; aparelho com cursor mais antigo que a limpeza recebe `reset` e recarrega. |

### 2.2 Cliente (`src/lib/sync-v2/`)

| Arquivo | Papel |
|---|---|
| `tipos.ts` | Eventos, estados da fila, tipos locais, erros (`ErroRede`, `ErroServidor`, `ErroRegra`). |
| `banco-local.ts` | IndexedDB estruturado **um banco por usuário** (`cr-v2:<userId>`), stores: `sessao`, `usuario`, `empresa`, `unidades`, `materiais`, `conferencias`, `itens`, `eventos`, `fila`, `sincronizacao`, `fotos`, `logs`. Toda gravação espera o `oncomplete` da transação. Índices compostos. |
| `projecao.ts` | Tela = estado do servidor + eventos ainda não refletidos, reaplicados em ordem (mesmas regras do servidor, inclusive pausas). |
| `motor.ts` | Operações locais, fila, backoff, envio em lote, pull, conflitos, fotos, assinatura, estado global, logs. |
| `transporte.ts` | Única parte que fala com a rede (RPCs + Storage), com tempo-limite. |
| `log.ts` | Sanitização dos logs. |
| `index.ts` | Instância por usuário, id do aparelho, flag `VITE_SYNC_V2`. |
| `src/components/sync-v2/IndicadorSync.tsx` | Indicador global ONLINE/OFFLINE/SINCRONIZANDO/ERRO com progresso, botão **SINCRONIZAR AGORA** e painel **"Há alterações que precisam de atenção."** (Tentar novamente / Ver erro / Manter minha contagem / Usar a versão do servidor / Continuar trabalhando). |

---

## 3. Decisões

### 3.1 Eventos com id do aparelho (itens 1–4, 8)

- `event_id` = UUID gerado no aparelho **uma vez**; é a chave primária do evento no servidor. Reenviar
  nunca gera outro id.
- Campos: `event_id, conference_id, device_id, user_id, company_id, event_type, created_at_device,
  received_at_server, payload, schema_version` (+ `hora_aplicada`, `status`, `resultado`).
- Tipos: `CONFERENCE_CREATED, ITEM_COUNTED, MATERIAL_ADDED, CONFERENCE_PAUSED, CONFERENCE_RESUMED,
  SIGNATURE_ADDED, CONFERENCE_FINALIZED, CONFERENCE_CANCELLED, PHOTO_ADDED`.
  **ITEM_UPDATED** não virou um tipo separado: correção de contagem/observação é um novo
  `ITEM_COUNTED` (mesma regra de conflito, histórico completo).
- `user_id` e `company_id` enviados pelo aparelho **não são confiados**: o servidor usa `auth.uid()` e a
  empresa da lista da conferência.

### 3.2 O problema do timeout com dois caminhos (item 8)

Antes (V1): se o servidor demorava mais de 10 s, o app gravava pela fila local **com outro id** — e o
envio original podia chegar depois → duas linhas. Agora:

- **V2**: o reenvio usa o mesmo `event_id`; o servidor responde `duplicado: true` com o resultado
  original. O estado do envio é persistido (`SYNCING`); se o app fechar no meio, volta para
  `PENDING` na abertura e o reenvio é seguro.
- **V1** (endurecida): o id da linha é gerado **antes** da chamada ao servidor, então a fila local
  reenvia a mesma linha (upsert pelo mesmo id).

### 3.3 Fila e estados (itens 5–7)

| Estado | Significado | Sai como |
|---|---|---|
| PENDING | aguardando envio | envio |
| SYNCING | em envio (persistido) | resultado; ao reabrir o app volta a PENDING |
| SYNCED | aplicado (ou reconhecido como já aplicado) | é podado quando o pull confirma que o efeito chegou (marca d'água) — a cópia de auditoria fica no store `eventos` |
| FAILED | falhou; nova tentativa agendada (backoff exponencial 2 s → 5 min, com jitter) | nova tentativa |
| NEEDS_ATTENTION | recusado pelo servidor ou 8 falhas de servidor | **só** decisão do usuário |
| CONFLICT | o servidor tem outra versão / estado incompatível | **só** decisão do usuário |
| RESOLVED | decisão explícita registrada (`resolucao: {decisao, em, novo_evento}`) | auditoria |

- Campos da fila: `event_id, status, tentativas, falhas_rede, created_at, last_attempt_at,
  next_attempt_at, error_code, error_message, payload, alvo_k, resposta, txid, refletido,
  aguarda_foto, resolucao`.
- **Falta de internet não conta como falha** (`falhas_rede` separado). Sem rede o motor nem tenta.
- **Ordem por conferência**: um evento parado (FAILED aguardando, CONFLICT, NEEDS_ATTENTION) segura os
  seguintes da mesma conferência; outras conferências continuam.
- **Barreiras**: FINALIZED, CANCELLED e fotos só são enviados quando tudo o que veio antes na
  conferência já foi confirmado.

### 3.4 Pausas (item 11)

A duração é calculada pelas horas dos eventos (não pela hora de chegada ao servidor), valendo para
várias pausas, pausas offline, app fechado e sincronização horas depois. Limites de segurança no
servidor: a pausa não começa antes da última retomada/início e nenhuma hora passa de 5 min no futuro
(relógio adiantado). Finalizar pausada encerra a pausa na hora da finalização.

### 3.5 Sincronização servidor → aparelho, cursor e exclusões (itens 12–14)

**Decisão: change log com tombstones** (`alteracoes_sync`), em vez de `deleted_at` em todas as tabelas.

- não muda como a V1 exclui (DELETE continua) nem exige filtrar `deleted_at` em todas as consultas;
- captura criação, atualização, exclusão e mudança de status venham de onde vierem (V1, V2, painel,
  servidor);
- exclusão = linha `operacao = delete` (tombstone) **ou** registro que sumiu/deixou de ser visível
  pela RLS (perda de acesso também remove do aparelho);
- mudança de lista/empresa de uma unidade gera exclusão no escopo antigo.

**Cursor confiável**: posição `txid:seq` + marca d'água `pg_snapshot_xmin`. Só saem alterações de
transações **já terminadas**, em ordem `(txid, seq)`; uma transação lenta não é pulada — ela só atrasa
a entrega. A resposta também traz `ate` (marca d'água) para o aparelho saber quando o efeito dos seus
eventos já chegou pelo pull, evitando que a tela "volte" para o valor antigo.

Carga inicial: `cursor_sync_inicial()` **antes** do `snapshot_sync()` (nada se perde entre os dois).
O snapshot remove imagens e traz conferências abertas ou dos últimos 30 dias.

### 3.6 Conflitos (itens 15–18)

O conflito fica guardado com evento local, estado do servidor, horários, usuário e aparelho
(`resposta.estado_servidor`, `ultimo_dispositivo`, `atualizado_em`).

| Situação | Regra |
|---|---|
| Contagem | conflito se o item mudou no servidor **por outro aparelho** depois da versão que este aparelho viu (`versao > versao_base` e `ultimo_dispositivo ≠ aparelho`). Contagens sequenciais do mesmo aparelho não conflitam. Decisão: **manter minha contagem** (novo evento com `forcar`) ou **usar a do servidor**. |
| Material adicional | id do item gerado no aparelho → idempotente. Mesmo material/código já incluído por outro caminho → conflito CR013. |
| Pausa/retomada | já no estado pedido → sem efeito (idempotente). Conferência encerrada → conflito CR002. |
| Finalização | idempotente (já finalizada = sem efeito, sem duplicar histórico/operação). Cancelada → conflito CR006. Transacional (uma subtransação) e auditável (`conferencia_eventos` + `conferencia_operacoes`). |
| Cancelamento | idempotente; finalizada → conflito CR008; motivo ≥ 3 caracteres. |
| Criação | outra conferência aberta na lista (outro aparelho) → conflito CR015 (não "reaproveita" em silêncio). |
| Conferência excluída no servidor com eventos locais pendentes | conflito CR016; a conferência continua visível no aparelho até a decisão. |
| Conferência ainda não criada no servidor | CR010: **não é registrado**; o evento volta para a fila. |

### 3.7 Fotos e assinatura (itens 22–23)

- Foto: guardada como `ArrayBuffer` no store `fotos` (funciona em todos os WebViews). Sobe para o
  Storage **só depois** de a conferência existir no servidor; depois vai o `PHOTO_ADDED`. O arquivo
  local só é liberado quando o servidor confirma o evento. Upload repetido do mesmo caminho é tratado
  como sucesso (resposta perdida).
- Assinatura: evento `SIGNATURE_ADDED` na fila como qualquer operação crítica (máx. ~512 KB). O
  servidor guarda a imagem na conferência; o registro de eventos e a auditoria local guardam só hash e
  tamanho. Finalizar exige assinatura (no aparelho e no servidor).

### 3.8 Sessão, isolamento e segurança (itens 20–21, 25)

- **Um banco IndexedDB por usuário** (`cr-v2:<userId>`). Outro usuário abre outro banco; não há como
  ler o cache de A com a sessão de B.
- Logout: o banco do usuário é apagado **se não houver nada pendente**; com pendências ele é mantido
  (nada é perdido) e só o próprio usuário o reabre.
- A sessão local do motor guarda só `userId`, `empresaId`, `deviceId`. **Nenhum token** no IndexedDB do
  motor.
- Logs (`logs`, máx. 1.000): conexão, sincronização, erro, conflito, retry, evento processado,
  duplicado, falha de upload — **sem** senha, token, segredo, assinatura ou imagem (chaves proibidas
  removidas, JWT e data URLs mascarados).

**Limites do WebView/PWA (documentados, não resolvíveis só com código):**

- O cliente do Supabase guarda a sessão (access/refresh token) no `localStorage` do WebView — é o
  mecanismo padrão do supabase-js. Proteção depende do sandbox do app Android.
- IndexedDB/`localStorage` não são criptografados pelo navegador; quem tem acesso físico ao aparelho
  desbloqueado com depuração pode ler. Mitigação: nada de token no banco do motor, dados por usuário,
  limpeza no logout.
- O navegador pode apagar o armazenamento sob pressão de espaço (PWA). No app Android (Capacitor)
  isso não ocorre sem ação do usuário; na V2.1 avaliar `navigator.storage.persist()`.

---

## 4. Migrations

Criadas somente as necessárias, aditivas, **não executadas na produção**. Executadas apenas no banco
de teste (local e CI).

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20260929130000_v22_eventos_conferencia.sql` | colunas de versão em `conferencia_itens` + trigger; nova `conferencias_tempo_pausa` (hora do evento / hora da V1, limites); `conferencia_eventos` (+RLS); `conferencia_fotos` (+RLS, trigger de integridade); bucket e policies do Storage (condicional: só onde existe o schema `storage`); funções `app_private.*` de aplicação dos eventos; `processar_evento_conferencia` e `processar_eventos_conferencia`. |
| `supabase/migrations/20260929130100_v23_alteracoes_sync.sql` | `alteracoes_sync` (+RLS, índices); `app_private.sync_controle`; triggers de registro nas 5 tabelas; `cursor_sync_inicial`, `snapshot_sync`, `alteracoes_sync`, `limpar_alteracoes_sync`; job diário no pg_cron (condicional). |

Ambiente de teste: `supabase/tests/bootstrap.sql` ganhou um stub do schema `storage` (buckets/objects
com RLS) para testar as policies.

Para aplicar no futuro (quando autorizado): na ordem, depois das migrations da Fase 0, primeiro num
branch/projeto de homologação do Supabase.

---

## 5. Testes

Todos contra Postgres real (mesmas migrations) e, no cliente, o motor real sobre IndexedDB
(`fake-indexeddb`). Comandos: `npm run test:unit`, `npm run test:db`, estresse com `CR_ESTRESSE=1`.

| Arquivo | Testes | Cobertura |
|---|---|---|
| `tests/db/eventos-sincronizacao.test.ts` | 29 | servidor: idempotência (A, B, D, E, concorrência), pausas (F), conflitos (G), finalizar/cancelar/material idempotentes, assinatura/fotos/Storage, cursor, tombstone (H), transação lenta, paginação, isolamento, snapshot, reset |
| `tests/db/motor-falhas.test.ts` | 18 | aparelho + servidor: testes A–H, exclusão de conferência e de item com pendência local, mesmo material incluído em dois aparelhos, NEEDS_ATTENTION sem descarte, recusa com mensagem, foto offline com falha de upload, assinatura, finalizar/cancelar repetidos, isolamento por usuário (2), sessão/logs sem segredos |
| `tests/db/motor-fluxo-completo.test.ts` | 1 | item 30 completo |
| `tests/db/motor-estresse.test.ts` | 3 | 500 / 1.000 / 5.000 eventos |
| `tests/unit/sync-v2.test.ts` | 7 | projeção de pausas/itens, logs sanitizados |
| `tests/unit/regressao-v1.test.ts` | 11 | V1 (atualizado: sem deduplicação por conteúdo — R-03 corrigido) |
| Fase 0 (regressão, banco) | 98 | RLS, isolamento, integridade, idempotência, limite de login, regressão V1 |
| Fase 0 (unidade) | 10 | limite de tentativas de login |

**Resultado:** `npx vitest run` → **174 aprovados**, 0 falhas (executado 2 vezes seguidas com a versão final,
em paralelo, sem instabilidade); estresse → **3 aprovados**. `npm run typecheck` sem erros; lint dos
arquivos novos sem erros; `npm run build` concluído (sem deploy). O CI da branch roda tudo isso,
incluindo o estresse em passo próprio (resultado em artefato `estresse-sync`).

---

## 6. Testes de falha (item 26)

| Teste | Cenário | Resultado |
|---|---|---|
| A | servidor demora 300 ms; usuário continua contando e toca "sincronizar" de novo | uma sincronização por vez; 2 eventos, 2 aplicações, nada duplicado |
| B | servidor aplica e a resposta se perde (timeout) | fila fica FAILED/TIMEOUT sem contar tentativa; reenvio com o mesmo id → `duplicado`, 1 aplicação |
| C | app fecha com lote em envio (SYNCING) | ao abrir, SYNCING → PENDING; reenvio → 2 eventos, 2 aplicações, valores corretos |
| D | mesmo evento enviado 10 vezes (9 respostas perdidas) | 1 aplicação, versão do item = 1 |
| E | duas contagens do mesmo item | 2 aplicações, na ordem (valor final = última, versão 2) |
| F | pausar/retomar/pausar offline, sincronizar 1 h depois, retomar | 420 s → 420 + 65 min; pausa começa exatamente aos 40 min |
| G | contagem offline + contagem de outro aparelho | CONFLICT com estado do servidor e aparelho; tela mantém valor local; "manter minha" e "usar do servidor" funcionam |
| H | material e conferência excluídos no servidor | removidos do aparelho |

---

## 7. Estresse (item 27)

| Eventos | Gravação local (total / por evento) | Sincronização total | Tempo no servidor (envio / pull) | Requisições de envio | Reenvios | Presos no fechamento | Fila antes → depois | Duplicados | Heap (Δ / final) |
|---:|---|---:|---|---:|---:|---:|---|---:|---|
| 500 | 283 ms / 0,57 ms | 7,8 s | 5,5 s / 1,2 s | 11 | 50 | 50 | 500 → 0 | **0** | +20 MB / 39 MB |
| 1.000 | 605 ms / 0,60 ms | 17,6 s | 9,8 s / 2,2 s | 21 | 50 | 50 | 1.000 → 0 | **0** | +17 MB / 55 MB |
| 5.000 | 6,4 s / 1,27 ms | 200,6 s | 48,2 s / 9,9 s | 101 | 50 | 50 | 5.000 → 0 | **0** | +117 MB / 181 MB |

"Reenvios" = eventos do lote cuja resposta se perdeu no fechamento do app e foram reenviados com o
mesmo `event_id` (o servidor respondeu `duplicado`, sem aplicar de novo).

Em cada rodada: todos os eventos gerados offline, internet volta, **queda de rede no 3º lote** e
**app fechado sem receber a resposta do 6º lote** (o servidor tinha aplicado), reabertura e
sincronização até o fim. Verificado: fila vazia ao final, `conferencia_eventos` com exatamente N
registros e N ids distintos (0 duplicados), 0 falhas, valores finais iguais no servidor e no aparelho.

Observações:

- **Tempo do servidor** ≈ 10 ms por evento no Postgres de teste (triggers da V1 + change log +
  versionamento). Em lotes de 50, ≈ 0,5 s por requisição.
- **Tempo do cliente** medido com `fake-indexeddb` (biblioteca de teste), que varre o índice inteiro a
  cada atualização; navegadores reais (Chromium/WebView) atualizam índices em O(log n). Os índices
  foram trocados por índices compostos e as gravações redundantes eliminadas: a gravação local ficou
  linear (≈ 0,6 ms por evento).
- **5.000 eventos**: dos 200 s, ~58 s são servidor; o restante é a manutenção de índices da biblioteca
  de teste (cresce com o tamanho da fila). Num aparelho real espera-se bem menos; medir na V2.1.
- **Memória**: a `fake-indexeddb` mantém o banco inteiro no heap do Node, por isso o heap cresce com
  o número de eventos (181 MB com 5.000). No navegador o IndexedDB fica em disco. O motor lê a fila
  uma vez por sincronização e os eventos confirmados saem da fila operacional assim que o pull confirma
  o efeito (a cópia de auditoria sem imagens fica no store `eventos`).

---

## 8. Critério de sucesso (item 31)

- [x] nenhuma operação é descartada (NEEDS_ATTENTION/CONFLICT; descarte só por decisão explícita, registrada)
- [x] operações repetidas não duplicam (TESTE D, estresse: 0 duplicados)
- [x] timeout não gera duplicidade (TESTE B, estresse com resposta perdida)
- [x] fechamento não perde dados (TESTE C, item 30, estresse)
- [x] pausas offline são corretas (TESTE F, item 30)
- [x] sincronização recebe alterações do servidor (cursor + snapshot; TESTE G, item 30)
- [x] exclusões sincronizam (TESTE H, tombstones)
- [x] conflitos são detectados (TESTE G, CR013/CR015/CR016/CR017)
- [x] cache é separado por usuário (banco por usuário; teste A sai → B entra; V1 também)
- [x] fotos possuem fila (upload → evento; arquivo só liberado após confirmação)
- [x] assinatura possui fila (SIGNATURE_ADDED)
- [x] finalização é idempotente
- [x] cancelamento é idempotente
- [x] material adicional é idempotente
- [x] testes de falha passam (A–H)
- [x] testes de estresse passam (500 / 1.000 / 5.000)
- [x] teste completo (item 30) passa
- [x] V1 continua funcionando (119 testes da Fase 0/regressão aprovados, build ok)
- [x] nenhuma migration executada na produção; sem deploy; sem merge

---

## 9. Compatibilidade com a V1 (item 29)

- Login, materiais, unidades, conferências, relatórios e administração: **sem mudança de API**. As
  migrations são aditivas; as triggers novas não mudam o que a V1 grava.
- `conferencias_tempo_pausa` continua aceitando o UPDATE da V1 e agora também usa `ultima_pausa` /
  `ultima_retomada` enviadas pela V1 (hora do aparelho).
- Os 119 testes da Fase 0 (incluindo regressão da V1) continuam passando.
- Compatibilidade temporária: a V1 continua usando `src/lib/offline` (fila de linhas) até a V2.1. As
  duas filas não se misturam.

## 10. Impacto na V1 — endurecimento aplicado

| Item | Correção |
|---|---|
| R-01 timeout com dois caminhos | id gerado no aparelho **antes** de chamar o servidor (`db.ts`): o caminho local reenvia a mesma linha. |
| R-02 descarte após 8 tentativas | removido. Após 8 falhas a operação fica "em atenção" na fila. Recusa definitiva por regra do servidor (CR0xx) move a operação **completa** para a lista de conflitos (reenfileirável). Conflito "servidor mais recente" também guarda a operação completa. |
| R-03 deduplicação por conteúdo | removida (pausar→retomar→pausar perdia a 2ª pausa). Só chave explícita deduplica. Teste atualizado. |
| R-05 hora da pausa | a V1 envia `ultima_pausa` / `ultima_retomada` com a hora do aparelho. |
| S-04 sessão offline em texto puro com tokens | cofre e sessão offline **sem tokens** (removidos também de cofres antigos ao ler). Rota protegida só usa a sessão offline quando o servidor **não pôde ser consultado**; sessão inválida/revogada → volta ao login. |
| S-05 cache da V1 visível a outro usuário | ao entrar outro usuário (online ou offline), o cache `cr:cache:*` e o contexto `cr:acesso` do anterior são apagados. A fila da V1 só envia operações do usuário da sessão atual. |
| S-11 logs do cofre | removidos os logs com dados do cofre (e-mail, perfil, unidades, presença de token). |

## 11. Riscos restantes e limitações

1. **Telas da V1 ainda usam o motor V1** até a V2.1. O motor V1 foi endurecido, mas continua sendo
   sincronização por linha (sem eventos). Os ganhos completos (idempotência por evento, pausas por
   evento, conflitos por versão) valem para quem usa o motor V2.
2. **Marca d'água global**: uma transação muito longa em qualquer parte do banco atrasa a entrega de
   alterações a todos os aparelhos (nunca as perde). Mitigação: statement_timeout nas rotinas longas.
3. **Carga no servidor**: ≈ 10 ms por evento no banco de teste. Medir em homologação no Supabase.
4. **Change log** cresce com o uso; limpeza diária de 30 dias (aparelho com cursor mais antigo
   recarrega tudo). Cron só é agendado onde há pg_cron.
5. **Relógio do aparelho** atrasado pode encurtar pausas (limitado a nunca ficar negativo); adiantado é
   limitado a 5 min.
6. **Fotos**: limite de 5 MB por foto; o espaço do aparelho não é monitorado ainda (V2.1).
7. **Armazenamento do WebView/PWA** não é criptografado (seção 3.8).
8. **Tempos do cliente** foram medidos com IndexedDB simulado; validar num aparelho real na V2.1.

## 12. Próxima etapa

**PARADO — aguardando autorização.** A próxima etapa é a **V2.1: Conferência mobile** (telas usando o
motor V2, indicador global ligado, validação em aparelho real).
