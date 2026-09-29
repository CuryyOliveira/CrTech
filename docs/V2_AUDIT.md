# Conferência Rápida — Auditoria técnica da V1 (Etapa 0 da V2)

> Somente leitura. Nenhum código, migration, deploy ou configuração de produção foi alterado
> para produzir este documento. Data da auditoria: 29/09/2026.
> Riscos de segurança estão em [`SECURITY_AUDIT_V2.md`](./SECURITY_AUDIT_V2.md) e o plano de
> melhorias em [`V2_ROADMAP.md`](./V2_ROADMAP.md).

---

## 1. Versão atual em produção

| Item | Valor |
|---|---|
| Commit publicado | `35df1d5` — branch `claude/app-to-android-apk-irx1ru` (é ela que o workflow `deploy-web.yml` publica; `main` também dispara deploy) |
| Branch da V2 | `v2-development` (criada a partir de `35df1d5`). **Não dispara nenhum workflow** de deploy nem de APK |
| Versão do sistema | Não há versão semântica: `package.json` não tem campo `version`. Identificação real = hash do commit |
| Versão do APK | `versionName 1.0.3`; `versionCode` vem de `CR_VERSION_CODE` (número da execução do GitHub Actions) |
| Versão do banco | Projeto Supabase novo. Em `supabase_migrations` constam **5 registros** (migrations consolidadas em lotes na migração da Lovable) enquanto o repositório tem **70 arquivos** em `supabase/migrations/` (68 da Lovable + 2 da migração). Ver §8.5 (drift) e `DATABASE_BASELINE.md` |
| Tamanho do código | ~39 mil linhas TS/TSX em `src/` |

---

## 2. Arquitetura atual

```
 Android (Capacitor 8, WebView)          Navegador / PWA
        │ loadUrl(https://conferenciarapida.com.br)   │
        └───────────────┬─────────────────────────────┘
                        ▼
      Cloudflare Workers  (Worker "conferencia-rapida", domínio próprio)
      TanStack Start SSR + server functions (createServerFn) + rotas /api/*
      Service Worker (Workbox, gerado pelo vite-plugin-pwa)
                        │
          ┌─────────────┼───────────────────────────┐
          ▼             ▼                           ▼
   Supabase (Postgres, Auth, Realtime,     Brevo (e-mail)     WhatsApp Cloud API
   pg_cron + pg_net)                       Mercado Pago (cobrança)   ipify (IP do usuário)
```

### 2.1 Frontend
- **Framework:** TanStack Start (React 19, Vite 8, TanStack Router + React Query), Tailwind + shadcn/ui.
- **Rotas:** `src/routes/`, com a árvore gerada em `src/routeTree.gen.ts`.
  - Públicas: `/`, `/entrar`, `/redefinir-senha`, `/precos`, páginas legais e páginas de SEO.
  - Autenticadas, sob o layout `_authenticated` (`ssr: false`):
    - `/menu`
    - `/unidade/$id` (**tela da conferência**)
    - `/m/$modulo`, as páginas de estoque, ferramentas e frota
    - `/conferencia-unica`
    - `/admin/$secao`, `/master/*`
    - as páginas de assinatura e faturas
- **Acesso a dados:** o cliente fala **direto com o Supabase** (PostgREST + RLS) por meio do wrapper `db` (`src/lib/app.ts` → `src/lib/offline/db.ts`), que adiciona o modo offline.
- **Permissões no cliente:** `src/lib/permissions.ts` (perfis e níveis 1–6) e `src/hooks/usePermissoes.ts`. A decisão real de acesso é da RLS.

### 2.2 Backend
- **Onde roda:** Worker Cloudflare (Nitro preset `cloudflare-module`, `nodeCompat`). O build fica em `dist/` e o deploy é feito com `wrangler`.
- **Server functions (51):** ficam em `src/lib/*.functions.ts`. Os grupos principais:
  - usuários/admin (`admin-users.functions.ts`);
  - painel Master (`master.functions.ts`);
  - assinaturas e pagamentos (`assinatura-gestao`, `assinaturas`, `pagamentos`, `pagamentos-status`, `faturas`, `planos-publicos`);
  - notificações (`notificacoes-conferencia.functions.ts`, `whatsapp.functions.ts`);
  - empresa (`empresa.functions.ts`);
  - acesso (`acesso.functions.ts`);
  - diagnóstico, auditoria e limpeza.
- **Autenticação das functions:** usam o middleware `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`) e, quando precisam, o `supabaseAdmin` (service role) de `client.server.ts`.
- **Rotas HTTP:**
  - `POST /api/public/hooks/monitor-conferencias`: chamado pelo pg_cron via pg_net, autenticado pelo header `x-hook-secret`.
  - `POST /api/public/payments/mercadopago`: webhook de cobrança.
  - `/sitemap.xml`.

### 2.3 Banco (Supabase)
35 tabelas em `public`, todas com RLS habilitada. Detalhes em §8.

### 2.4 Autenticação
- Supabase Auth com e-mail e senha. O login Google fica oculto (`VITE_LOGIN_GOOGLE`). A recuperação de senha usa `resetPasswordForEmail` → `/redefinir-senha`.
- **Login offline:** "cofre" local em `src/lib/offline/cofre.ts`.
  - Guarda um hash PBKDF2-SHA256 (210 mil iterações) da senha e os dados do usuário cifrados com AES-GCM, em `localStorage` (`cr:cofre:<email>`).
  - Depois do login offline, a sessão fica em `cr:sessao-offline`.
- **Guarda de rota** (`src/routes/_authenticated/route.tsx`):
  - offline: aceita a sessão do cofre ou a sessão Supabase salva no aparelho;
  - online: `getUser()` com timeout de 6s; se falhar, volta para a sessão offline.
- **Sessões e acesso:**
  - `sessoes_usuario` registra dispositivo, navegador e IP, com ping periódico. Se a sessão for encerrada remotamente, o usuário é deslogado (`src/hooks/useSessao.ts`).
  - Níveis: proprietário 6, super_admin 5, administrador 4, gestor 3, agrícola/indústria 2, usuário 1 (`app_private.nivel_perfil`).
  - **Segunda camada paralela:** `user_roles` (enum `admin | conferente | visualizador`), que a RLS de conferências e materiais usa (§8.3).

### 2.5 Storage
- **Não há Supabase Storage em uso.** Todos os binários são gravados como texto no banco:
  - fotos dos itens: `conferencia_itens.fotos` (jsonb com data-URLs JPEG, compressão 700px);
  - imagem do material: `materiais.imagem_principal` (data-URL, 900px) e `material_imagens.url_imagem`;
  - assinaturas: `conferencias.assinatura` e `assinatura_gestor` (data-URL PNG do `SignaturePad`).
- **Consequência:** as linhas ficam pesadas. Como o cache offline guarda tabelas inteiras, essas imagens também vão para o IndexedDB e para a memória (§5).

### 2.6 PWA / Service Worker
- **SW efetivo:** gerado pelo `vite-plugin-pwa` (Workbox) em `dist/client/sw.js`.
  - precache de `js, css, html, ico, png, svg, webmanifest, woff2`;
  - navegações `NetworkFirst` com timeout de 5s (cache `paginas`, 60 entradas);
  - estáticos `CacheFirst` (cache `recursos`, 300 entradas);
  - `skipWaiting` + `clientsClaim`.
- **Código morto:** `public/sw.js`, um SW manual `cr-v1`, é **sobrescrito** pelo gerado no build e não chega à produção.
- **Registro:** `src/lib/offline/sw.ts`. Só roda em produção e não em iframe. Ainda contém exceções para domínios da Lovable (resíduo), e `?sw=off` remove o SW.
- **Manifest:** `public/manifest.webmanifest`.

### 2.7 Android
Detalhado em §7.

### 2.8 Integrações e serviços externos

| Serviço | Uso | Onde |
|---|---|---|
| Supabase | Banco, Auth, Realtime (`channel`), pg_cron/pg_net | cliente e servidor |
| Cloudflare Workers | Hospedagem SSR + functions, domínio `conferenciarapida.com.br` | `deploy-web.yml` |
| Brevo | E-mails transacionais (remetente `nao-responda@conferenciarapida.com.br`) | `send-email.ts`, `notificacoes-email.server.ts` |
| WhatsApp Cloud API | Avisos de início/conclusão | `whatsapp-envio.server.ts` |
| Mercado Pago | Assinaturas, checkout e webhook | `mercadopago.server.ts`, `assinatura-mp.server.ts` |
| ipify.org | IP público gravado na auditoria (chamado pelo navegador) | `src/lib/audit.ts` |
| GitHub Actions | Build/deploy do site e build do APK (Release) | `.github/workflows/` |

### 2.9 Variáveis de ambiente (somente nomes)

| Nome | Tipo | Onde |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | pública (vai no bundle) | `.env` versionado |
| `VITE_LOGIN_GOOGLE`, `VITE_COBRANCA_AMBIENTE` | pública | build |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_URL` | vars do Worker (não secretas) | `wrangler.json` gerado no deploy |
| `SUPABASE_SERVICE_ROLE_KEY` | **secreta** | segredo do Worker |
| `BREVO_API_KEY` | **secreta** | idem |
| `MONITOR_HOOK_SECRET` | **secreta** | idem (também validado via `validar_hook` no banco) |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_TEST_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_TEST_WEBHOOK_SECRET`, `MERCADOPAGO_TEST_PAYER_EMAIL` | **secretas** | idem |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_*` | **secretas** | idem |
| `EMAIL_FROM_DOMAIN`, `EMAIL_FROM_NAME` | opcionais | e-mail |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | **secretas** do GitHub | apenas no CI |
| `CR_KEYSTORE_*`, `CR_VERSION_CODE` | CI do APK | `android/app/build.gradle` |

---

## 3. Mapa da conferência

Quase todo o fluxo está em **um único componente**: `UnidadeDetalhe`, em `src/routes/_authenticated/unidade.$id.tsx` (1.683 linhas). Todas as gravações passam por `db` (`dbOffline`) direto do navegador para o PostgREST. **Nenhuma etapa da conferência usa server function**; as regras de negócio vivem no cliente, com a RLS e dois triggers no banco.

| # | Etapa | Função / trecho (linha) | Tabelas | API | Regra de negócio |
|---|---|---|---|---|---|
| 1 | **Criação** da lista (unidade) e dos materiais | `UnidadesPage.tsx` (insert `unidades`); `salvarMaterial` (287), `importarMateriais` (329) → `salvarMateriais()` em `lib/app.ts` | `unidades`, `materiais` | PostgREST insert/update/upsert | Material único por (unidade, código, locação) — índice `materiais_unico_codigo_locacao`. A importação exige a coluna "Quantidade Esperada" e ignora linhas sem quantidade. O trigger `trg_materiais_normalizar` normaliza os textos. |
| 2 | **Início** | `iniciarConferencia` (383) | `conferencias`, `conferencia_itens`, `historico_conferencias`, `auditoria`, `notificacoes_conferencia` | insert ×2 + `abrirHistorico` + `registrarAuditoria` + `registrarInicioConferencia` → server fn `enviarEmailNotificacao` / `dispararWhatsappNotificacao` | Exige ≥1 material. Antes de criar, procura uma conferência aberta na lista e a reaproveita (proteção contra duplo clique; só funciona com dados já sincronizados). Data e hora vêm **do relógio do aparelho** (`agoraLocalISO`). Os itens são um **snapshot** dos materiais (código, descrição, locação, qtd esperada). RLS: exige `user_roles` admin/conferente e `pode_unidade`. |
| 3 | **Carregamento dos itens** | queries `["itens", ativa.id]` (209) e `["materiais", id]` (149) | `conferencia_itens`, `materiais` | select | A conferência ativa é a primeira com status `em_andamento` ou `pausada`. Ordenação natural por locação (`ordenarPorLocacao`). |
| 4 | **Pesquisa** | `listaItens` (787): filtro local por código/descrição + abas Todos/Pendentes/Conferidos/Divergências. Busca no cadastro geral: query `cadastro-materiais` (630–653), com debounce de 400ms e `ilike` em código, descrição e matrícula, limite 50 | `materiais` | select `or(...ilike...)` | A busca do cadastro exige ≥2 caracteres. Offline, o `ilike` é emulado por regex sobre o cache. |
| 5 | **Conferência do item** | toque no item → diálogo (≈ linha 1400+) → `salvarItem` (512) | `conferencia_itens` | update por `id` | Bloqueado se a conferência estiver pausada. |
| 6 | **Quantidade** | `salvarItem` | `conferencia_itens.quantidade_contada` | update | Vazio = `pendente`; igual à esperada = `conferido`; diferente = `divergencia`. Aceita vírgula decimal. `updated_at` é gravado **pelo cliente** (não há trigger nessa tabela). |
| 7 | **Divergência** | mesmo diálogo: quando há divergência, oferece anexar fotos (`compressImage(f, 700)`); a lista de divergências é enviada em `registrarDivergencias` ao finalizar | `conferencia_itens.fotos`, `observacoes`; `notificacoes_conferencia` | update; server fn de e-mail | Foto opcional. Não há motivo/justificativa obrigatória para a divergência. |
| 8 | **Material adicional** | `adicionarItem` (656); validação `podeAdicionarItem` (746) | `conferencia_itens` (`origem='adicionado'`, `motivo_inclusao`, `incluido_por*`), `historico_conferencias`, `auditoria` | insert | Exige código, descrição, motivo e qtd > 0. Bloqueia duplicado por `material_id` ou código normalizado (checagem no cliente + índice único parcial `(conferencia_id, material_id)`). Qtd esperada = a do cadastro, ou 0 se manual. |
| 9 | **Pausa** | `alternarPausa` (479) | `conferencias.status='pausada'`; o trigger `conferencias_tempo_pausa` grava `ultima_pausa`, `quantidade_pausas` e insere em `conferencia_pausas`; o trigger `sync_historico_status` atualiza `historico_conferencias` | update | **O tempo da pausa é medido com o `now()` do servidor**, no momento em que o update chega (ver risco R-05 no offline). |
| 10 | **Retomada** | `alternarPausa` | idem (`status='em_andamento'`; o trigger fecha a pausa e soma `total_tempo_pausado`) | update | idem |
| 11 | **Finalização** | `finalizarConferencia` (544) | `conferencias` (`status='finalizada'`, `hora_fim`, assinaturas, observações), `historico_conferencias`, `auditoria`, `notificacoes_conferencia` | update + `select tempo_trabalhado`; server fns de e-mail/WhatsApp | Botão desabilitado quando pausada. Assinatura do conferente obrigatória; a do gestor só quando a família do módulo é `caixa`. `tempo_trabalhado` é calculado pelo trigger. **Não exige que todos os itens estejam conferidos.** |
| 12 | **Assinatura** | `SignaturePad` (`src/components/SignaturePad.tsx`) → `toDataURL('image/png')` | `conferencias.assinatura`, `assinatura_gestor` | parte do update de finalização | Imagem base64 gravada em coluna texto. |
| 13 | **Cancelamento** | `cancelarConferencia` (457) | `conferencias.status='cancelada'`, `historico_conferencias`, `auditoria` | update | **Sem diálogo de confirmação** e sem motivo. Um toque encerra a conferência. |
| 14 | **Histórico** | botão Histórico; lista `finalizadas` + `statsHist` (184); `baixar()` PDF/Excel (771, `lib/export.ts`); `excluirConferencia` (755). No admin: `HistoricoOperacional.tsx`, `MonitorTempoReal`/`useConferenciasAoVivo` (Realtime) | `conferencias`, `conferencia_itens`, `historico_conferencias` | select; **delete** | **Excluir histórico apaga a conferência de verdade**, com cascata em itens, pausas, histórico e notificações. Sem confirmação; RLS exige `user_roles` admin/conferente. |
| 15 | **Auditoria** | `registrarAuditoria` (`src/lib/audit.ts`) chamada em cada etapa; `log()` em `lib/app.ts` | `auditoria` | insert (via `dbOffline`) | Grava usuário, perfil, setor, módulo, lista, IP (via ipify) e dispositivo. É *best effort*: falhas são engolidas. Offline, entra na fila como qualquer outra escrita. |

**Conferência Única** (`/conferencia-unica`): cria (ou reaproveita) uma unidade "avulsa" por módulo e insere a conferência e os itens escolhidos de várias listas. Depois navega para `/unidade/$id`, onde o fluxo acima se repete.

**Monitor de atraso:**
1. O pg_cron chama `/api/public/hooks/monitor-conferencias`.
2. O endpoint procura conferências abertas há mais de 30 minutos (tempo líquido).
3. Para cada uma, cria uma notificação e envia e-mail.

---

## 4. Mapa do offline

### 4.1 O que fica armazenado no aparelho

| Onde | Chave | Conteúdo | Quando grava | Quando atualiza |
|---|---|---|---|---|
| IndexedDB `conferencia-offline`, store `dados` | `cr:cache:<tabela>` | **Um array com a tabela inteira** por chave (17 tabelas da pré-carga + tudo o que for lido online) | A cada leitura online bem-sucedida (`guardarLinhas`) e a cada escrita offline (`aplicarInsercao`/`Atualizacao`/`Remocao`) | Pré-carga (`precarregar.ts`) ao abrir o app online, ao reconectar e a cada 30s se houver pendências |
| idem | `cr:fila` | Fila de operações pendentes (tabela, tipo, payload, filtros, escopo, tentativas, erro) | A cada escrita feita offline | Na sincronização |
| idem | `cr:conflitos` | Últimos 200 conflitos (servidor preservado) | Na sincronização | — |
| idem | `cr:precarga`, `cr:precarga:marcas` | Data da última pré-carga e marca d'água por tabela | Fim da pré-carga | — |
| idem | envios pendentes (`notificacoes-pendentes.ts`) | IDs de notificações criadas offline | Notificação criada offline | Removido após envio |
| localStorage | `cr:cofre:<email>` | Cofre criptografado (login offline) | Login online bem-sucedido | Próximo login online |
| localStorage + sessionStorage | `cr:sessao-offline` | Dados do usuário **em texto claro**, incluindo tokens (ver SECURITY) | Login offline | Removido no logout pelo menu |
| localStorage | `cr:acesso` | Contexto de acesso (empresa, plano, módulos) | Consulta `contextoAcesso` | Idem |
| localStorage | sessão Supabase (`sb-*-auth-token`) | Sessão padrão do supabase-js | Login | Refresh automático |
| Cache Storage (SW) | `paginas`, `recursos`, precache | HTML das páginas visitadas, JS, CSS e ícones | Navegação/instalação | NetworkFirst / CacheFirst |

**Pré-carga** (`precarregar.ts`):
- tabelas baixadas: perfis, permissões, configurações, cadastros, empresa(s), setores, módulos, planos, **unidades**, **materiais (até 50 mil)**, imagens (8 mil), **conferências (4 mil)**, **itens (40 mil)**, avisos e histórico (2 mil);
- páginas de 400 linhas, com delta por `updated_at` ou `created_at`.

**Limitações da pré-carga:**
- `unidades`, `materiais` e `conferencias` usam **`created_at`** como delta. Edições (ex.: conferência finalizada em outro aparelho, material com quantidade alterada) **nunca chegam** ao cache depois da primeira carga, a não ser que a tela leia o registro online.
- **Exclusões no servidor nunca são propagadas** para o cache.

### 4.2 Como o Service Worker funciona
- Navegação: rede primeiro (5s). Sem rede, usa a página HTML em cache **se ela já tiver sido visitada**. Rota nunca visitada = erro do navegador; no APK, tela `offline.html`.
- JS/CSS: cache primeiro. Com `skipWaiting` + `clientsClaim`, uma versão nova assume na próxima navegação sem aviso ao usuário.
- Nenhuma chamada a Supabase ou server function passa pelo cache do SW. Os dados offline vêm só do IndexedDB.

### 4.3 O que acontece sem internet

**Detecção** (`estado.ts`), por qualquer um destes sinais:
- `navigator.onLine === false`;
- evento `offline`;
- erro de rede em requisição;
- **timeout de 10s** em qualquer consulta (`db.ts`, `executar()`).

**Enquanto está offline**, o `dbOffline`:
- **leituras:** filtra o cache em memória, emulando `eq/in/ilike/or/order/limit/range`;
- **insert/upsert:** gera UUID no cliente, preenche padrões (`PADROES`, como `status='em_andamento'`) e aplica ao cache. Enfileira como `upsert`;
- **update:** aplica ao cache e enfileira um `update` **por linha afetada**, filtrado por PK;
- **delete:** remove do cache e enfileira;
- mostra o toast "Salvo offline…".

**Server functions não funcionam offline:**
- e-mail e WhatsApp: a notificação é gravada e o envio fica pendente;
- painel admin, assinatura, Master: indisponíveis.

### 4.4 Sincronização
Detalhada em §5.

### 4.5 Erros
- **Erro de rede:** a operação fica na fila e a sincronização para (`marcarQueda`).
- **Erro de coluna inexistente:** remove a coluna do payload e reenvia (até 5 vezes).
- **Outros erros:** backoff (30s, 60s, 120s… até 7,5min). **Depois de 8 tentativas a operação é descartada** (`MAX_TENTATIVAS`), sem aviso ao usuário, e o dado se perde.
- **Delete** com `PGRST116`/`23503`: considerado resolvido.

### 4.6 Conflitos
- Só para `conferencia_itens`, `historico_conferencias` e `notificacoes_conferencia`.
- Antes de aplicar, lê o `updated_at` do servidor. Se for mais novo que o `criado_em` da operação, **descarta a alteração offline** e grava em `cr:conflitos` (visível em Admin → Dados offline).
- **Comparação frágil:** os dois lados vêm de relógios de aparelhos, porque `conferencia_itens.updated_at` é enviado pelo cliente.
- `conferencias` **não tem** controle de conflito: último a escrever vence.

### 4.7 Aplicativo fechado durante uma conferência
- **O que é preservado:** o estado da conferência está no servidor (online) ou no cache e na fila (offline). Ao reabrir, a conferência ativa é recalculada (status `em_andamento`/`pausada`) e retomada.
- **O que se perde:**
  - o diálogo aberto (quantidade digitada e não salva, fotos ainda não salvas, assinatura desenhada);
  - os filtros.
- **Janela de perda:** `gravarLocal` escreve no IndexedDB em segundo plano, sem aguardar a transação. Se o app for morto logo após uma escrita offline, a última operação pode não ter sido persistida.
- **Cronômetro:** continua correndo pelo servidor (`hora_inicio` + `now()`). Fechar o app **não pausa**.

---

## 5. Mapa da sincronização

**Motor:** `src/lib/offline/sync.ts`. É disparado por `useConexao` nestes momentos:
- ao abrir o app online;
- no evento `online`;
- a cada 30s, se houver pendências;
- manualmente, pelo indicador de conexão.

**Ordem ao reconectar:**
1. `refreshSession`;
2. `sincronizar()`;
3. `despacharNotificacoesPendentes()`;
4. `precarregarDadosOffline()`;
5. `invalidateQueries`.

| Operação | Como vai para a fila | Como é enviada | Risco |
|---|---|---|---|
| CREATE conferência | `upsert` com UUID do cliente | `upsert onConflict id` | **Duplicidade:** a) dois aparelhos (ou online + offline) podem abrir conferências na mesma lista, porque não existe índice único de "conferência aberta por unidade"; b) **timeout de 10s online** (ver R-01) |
| CREATE itens (snapshot) | 1 operação `upsert` com N linhas | 1 upsert em lote | Se a conferência falhar (RLS), os itens falham por FK e seguem tentando independentemente. Depois de 8 tentativas são **descartados** |
| UPDATE item (contagem) | `update` filtrado por id; payload inclui `updated_at` | `update().eq(id)` | Pode ser descartado como "conflito" se outro aparelho alterou o item depois. Relógio divergente ⇒ decisões erradas |
| PAUSE / RESUME | `update {status}` | idem | **Deduplicação por assinatura** (`tabela+tipo+filtros+payload`): pausar → retomar → pausar offline gera a 3ª operação **idêntica** à 1ª, que é descartada ⇒ o servidor fica "em andamento" enquanto o aparelho mostra "pausada". **Tempo das pausas errado:** o trigger usa `now()` do servidor na hora do sync, então pausas feitas offline viram pausas de ~0s |
| FINALIZE | `update {status, hora_fim, assinaturas…}` | idem | `tempo_trabalhado` é calculado com o `hora_fim` do cliente, mas as pausas foram medidas no sync, então fica inconsistente. **Sem trava no banco:** conferência finalizada pode ser alterada ou reaberta por qualquer update posterior |
| CANCEL | `update {status:'cancelada'}` | idem | idem; sem confirmação |
| ADD MATERIAL | `upsert` de 1 item `origem='adicionado'` | upsert | Duplicado de material cadastrado é barrado pelo índice único (vira erro e, após 8 tentativas, é descartado). Item manual (sem `material_id`) duplicado não é barrado no banco |
| UPLOAD FOTO | não existe upload: a foto é base64 dentro do `update` do item | idem | Payloads grandes; o cache inteiro de `conferencia_itens` é regravado a cada alteração (custo de CPU e memória) |
| DELETE conferência / material | `delete` por id | `delete().eq(id)` | Exclusão offline de algo alterado no servidor não é verificada |
| Histórico operacional | `upsert` / `update` por `conferencia_id` | idem | Dois caminhos atualizam o mesmo registro: o cliente (`fecharHistorico`) e o trigger `sync_historico_status` |
| Auditoria / notificações | `upsert` | idem | E-mails de conferências feitas offline saem com atraso. Envio **sem idempotência forte** se o despacho for interrompido |

### 5.1 Riscos identificados
- **R-01 — CRÍTICO — Duplicidade por timeout (online).** `executar()` faz `Promise.race(remoto, 10s)`. Se o servidor demora mais de 10s, a operação vai para o caminho offline **e a requisição original continua em voo**. Em `insert` sem `id` (o caso do início de conferência online e dos itens), o servidor cria um registro com UUID do servidor e a fila cria outro com UUID do cliente ⇒ **duas conferências** e itens duplicados. Em update, o reenvio é idempotente, mas pode marcar um conflito falso.
- **R-02 — CRÍTICO — Perda silenciosa.** Operações descartadas após 8 falhas e alterações descartadas por "conflito" (servidor preservado) não geram aviso ao usuário. O registro fica só em `cr:conflitos` local.
- **R-03 — ALTO — Deduplicação de fila incorreta.** Operações iguais em momentos diferentes (pausa/retomada/pausa; contagem 5→6→5 sem `updated_at`) são consideradas repetidas.
- **R-04 — ALTO — Ordem e dependência não garantidas.** A fila é FIFO, mas uma operação com erro não bloqueia as dependentes (itens antes da conferência, updates antes do insert).
- **R-05 — ALTO — Tempos de pausa e trabalho incorretos em offline** (o trigger usa `now()` do servidor).
- **R-06 — ALTO — Cache sem propagação de edições e exclusões** (delta por `created_at`, sem tombstones).
- **R-07 — MÉDIO — Relógio do aparelho** define `data`, `hora_inicio`, `hora_fim`, `updated_at` e a decisão de conflito.
- **R-08 — MÉDIO — Escrita no IndexedDB sem confirmação** (janela de perda se o app for morto).
- **R-09 — MÉDIO — Operação parcialmente enviada.** O início da conferência são 2 requisições (conferência + itens) + histórico + auditoria + notificação, sem transação. Se a segunda falhar online, fica uma conferência aberta **sem itens**.

---

## 6. Mapa do banco

Detalhes em §8. Resumo:
- **Núcleo da conferência:**
  - `unidades` (lista/frota/local; `empresa_id`, `modulo_id`) 1—N `materiais`;
  - `unidades` 1—N `conferencias` 1—N `conferencia_itens` (FK `material_id` ON DELETE SET NULL);
  - `conferencias` 1—N `conferencia_pausas`;
  - `conferencias` 1—1 `historico_conferencias` (UNIQUE `conferencia_id`);
  - `conferencias` 1—N `notificacoes_conferencia` 1—N `notificacao_emails`.
- **SaaS:** `empresas`, `empresa_usuarios`, `empresa_modulos`, `empresa_setores`, `planos`, `assinaturas`, `assinatura_pagamentos`, `webhook_eventos_pagamento`.
- **Acesso:** `user_profiles` (perfil/nível), `user_roles` (enum legado), `permissoes_perfil`, `permissoes_usuario`, `profiles`, `usuarios_legados`, `sessoes_usuario`.
- **Operação:** `auditoria`, `avisos_sistema`, `aviso_leituras`, `notificacao_leituras`, `metas`, `cadastros_mestres`, `configuracoes_sistema`, `integracoes`, `relatorios_agendados`, `empresa_whatsapp_destinatarios`, `whatsapp_notificacoes`, `material_imagens`.

---

## 7. Mapa do Android

| Item | Situação atual |
|---|---|
| Projeto | `mobile/` — Capacitor 8, `appId br.com.conferenciarapida.app`, minSdk 24, targetSdk 36, `versionName 1.0.3` |
| Carregamento | `MainActivity.loadUrl("https://conferenciarapida.com.br/")` direto (sem `server.url`). O conteúdo local `www/` só serve a `offline.html` |
| WebView | Cliente próprio (`WebClient extends BridgeWebViewClient`). Mostra `offline.html` **somente** em erro de rede do frame principal do domínio. `webContentsDebuggingEnabled=false`, sem cleartext, sem mixed content |
| Ponte JS | `cr-android.js` injetado com `addDocumentStartJavaScript` + `WebMessageListener`, **restritos às origens em `ORIGENS`** |
| Câmera / galeria | `onShowFileChooser`: para `accept=image/*` oferece câmera (`ACTION_IMAGE_CAPTURE` via `FileProvider`) ou galeria. Permissão `CAMERA` pedida em tempo de execução |
| Arquivos / downloads | `DownloadListener` + interceptação de `blob:` pela ponte, salvando em Downloads (PDF/Excel dos relatórios). Se falhar, abre no navegador externo |
| Impressão | `PrintManager` com WebView auxiliar (JS desativado) |
| Links externos | Domínios fora de `allowNavigation` abrem no navegador (`ACTION_VIEW` + `BROWSABLE`) |
| Botão voltar | `webView.goBack()` se houver histórico; senão `moveTaskToBack`. **Não confirma a saída** de uma conferência com diálogo aberto |
| Status de conexão | Permissão `ACCESS_NETWORK_STATE`. O status real vem do JS (`navigator.onLine` + falhas de requisição); não há plugin nativo `@capacitor/network` |
| APK | Gerado no GitHub Actions (`android-apk.yml`) e publicado como Release `android-claude-app-to-android-apk-irx1ru`. **Assinado com `debug.keystore` versionado no repositório** quando não há `CR_KEYSTORE_FILE` (ver SECURITY) |
| Domínio | `conferenciarapida.com.br`. `allowNavigation` ainda contém `conferenciamat.lovable.app`, `oauth.lovable.app`, `lovable.dev` (resíduos) |
| Atualização | Como o app carrega o site, **toda mudança web chega ao APK na hora**. Só mudanças nativas exigem novo APK. Consequência para a V2: nenhum deploy web pode quebrar a ponte `cr-android.js` |

---

## 8. Banco — detalhamento

### 8.1 Tabelas e volume (estimativas do Postgres)

| Tabela | Linhas (aprox.) | Tamanho | Observação |
|---|---|---|---|
| `materiais` | 7.718 | 8,4 MB | Maior tabela (imagens base64) |
| `conferencia_itens` | 7.013 | 2,4 MB | |
| `auditoria` | 1.794 | 1,1 MB | 10 índices |
| `conferencias` | — | 1,1 MB | Assinaturas base64 |
| `notificacao_emails` / `notificacao_leituras` / `notificacoes_conferencia` | ~480 / ~478 / ~164 | | |
| `unidades` | 121 | | |

### 8.2 Triggers relevantes

| Trigger | Tabela | Função |
|---|---|---|
| `trg_conferencias_tempo_pausa` | `conferencias` (BEFORE UPDATE) | Pausas, tempo pausado e tempo trabalhado com `now()` do servidor. Insere e fecha `conferencia_pausas` |
| `trg_sync_historico_status` | `conferencias` | Replica status e tempos em `historico_conferencias` |
| `historico_escopo_empresa`, `notificacoes_escopo_empresa`, `unidades_escopo_empresa` | | Preenchem `empresa_id`/`modulo_id` |
| `trg_historico_cascade_notificacoes` | `historico_conferencias` | Apaga as notificações ao apagar o histórico |
| `trg_materiais_normalizar` | `materiais` | Normalização de campos |
| `trg_proteger_proprietario` | `user_profiles` | Impede rebaixar ou alterar o proprietário |
| `empresa_modulos_limite_plano`, `whatsapp_destinatarios_limite` | | Limites do plano |
| `*_updated_at` | várias | `updated_at = now()` — **ausente em `conferencia_itens` e `conferencias`** |

### 8.3 Funções e RLS
- Funções em `app_private`:
  - `nivel`, `nivel_perfil`, `eh_global` (nível ≥5), `eh_administrador`, `eh_gestor`;
  - `pode_unidade`, `acesso_unidade`, `mesma_empresa`, `mesma_empresa_ou_legado`, `pertence_empresa`;
  - `perfil_atual` (colapsa proprietário e super_admin para `'administrador'`; usada em policies de `auditoria` e `historico_conferencias`);
  - `eh_master`.
- Funções públicas SECURITY DEFINER executáveis por `authenticated` (11, apontadas pelo linter): `assinatura_ativa_empresa`, `criar_empresa_onboarding`, `criar_modulos_iniciais`, `criar_setores_iniciais`, `diagnostico_permissoes`, `eh_usuario_legado`, `empresa_do_usuario`, `has_role`, `modulos_ativos_empresa`, `plano_da_empresa`, `usuarios_ativos_empresa`.
- `importar_dados_legados` (restauração): apenas service_role.
- **RLS de conferências:**
  - `conferencias`, `conferencia_itens` e `materiais` exigem `pode_unidade(unidade_id)` **e** `user_roles.role ∈ {admin, conferente}` para escrever;
  - leitura: só `pode_unidade`;
  - **não há restrição por status.** Uma conferência finalizada (e seus itens) continua editável e excluível por qualquer conferente com acesso à unidade.
- **Duas fontes de autorização** convivem: `user_profiles.perfil` (níveis) e `user_roles` (enum). Um usuário com perfil alto mas sem `user_roles` adequado não consegue conferir.

### 8.4 Índices e constraints (conferência)
- `conferencias`:
  - pk;
  - `unidade_id`;
  - `created_at`;
  - parcial `idx_conferencias_abertas (status, hora_inicio) WHERE status IN (em_andamento, pausada)`, que **não é único**;
  - **sem CHECK de status**.
- `conferencia_itens`:
  - pk;
  - `conferencia_id`;
  - `(conferencia_id, origem)`;
  - único parcial `(conferencia_id, material_id)`;
  - `updated_at`.
- `materiais`:
  - único `(unidade_id, upper(codigo), upper(locacao))`;
  - índices trigram em código, descrição e `funcionario_codigo`.
- Linter de performance:
  - 90 avisos `auth_rls_initplan` (policies chamando `auth.uid()` por linha; trocar por `(select auth.uid())`);
  - 10 FKs sem índice;
  - 40 índices nunca usados;
  - 4 tabelas com policies permissivas duplicadas.

### 8.5 Drift de migrations
O banco registra 5 migrations consolidadas e o repositório tem 70 arquivos. **Resolvido na Fase 0:** ver `DATABASE_BASELINE.md`.
- **Risco:** um `supabase db push` aplicaria de novo arquivos antigos.
- **Para a V2:** gerar uma *baseline* (dump do schema atual) e passar a versionar só a partir dela.

### 8.6 Alterações de banco que a V2 provavelmente exigirá (NÃO executadas)
1. Índice **único parcial** `conferencias (unidade_id) WHERE status IN ('em_andamento','pausada')`.
2. `CHECK` de status em `conferencias` e `conferencia_itens`.
3. **Trava de conferência encerrada:** trigger que rejeita update/delete em conferência `finalizada`/`cancelada` e em seus itens (exceto reabertura por papel autorizado, auditada).
4. `updated_at` + trigger em `conferencias` e `conferencia_itens` (hora do servidor) e coluna `versao int` para controle otimista.
5. Tabela de **eventos da conferência** (`conferencia_eventos`: `id` do cliente, tipo, `ocorrido_em` do aparelho, `recebido_em` do servidor, payload) para sincronização idempotente e cálculo correto de pausas feitas offline.
6. RPC transacional `iniciar_conferencia(_id uuid, _unidade uuid, ...)` que cria a conferência, os itens e o histórico numa transação só, idempotente pelo `_id`.
7. Colunas `motivo_cancelamento`, `cancelada_por`; motivo de divergência.
8. **Supabase Storage** (bucket privado) para fotos e assinaturas, com colunas de caminho no lugar do base64 e migração gradual.
9. Tombstones (`excluido_em`) ou tabela de exclusões para o delta sync.
10. Unificar `user_roles` e `user_profiles.perfil` nas policies.
11. Corrigir os avisos do linter (initplan, índices de FK).
12. `ativo`/soft delete em vez de `DELETE` físico no histórico.

---

## 9. Problemas encontrados (não relacionados diretamente à segurança)

| # | Problema | Onde | Prioridade |
|---|---|---|---|
| P-01 | Duplicidade de conferência por timeout de 10s + insert sem id (R-01) | `lib/offline/db.ts`, `unidade.$id.tsx` | CRÍTICA |
| P-02 | Perda silenciosa na fila (descarte após 8 falhas / conflito) (R-02) | `lib/offline/sync.ts` | CRÍTICA |
| P-03 | Deduplicação da fila junta operações legítimas (R-03) | `lib/offline/fila.ts` (`assinatura`) | ALTA |
| P-04 | Pausas e tempo trabalhado errados quando feitos offline (R-05) | trigger `conferencias_tempo_pausa` | ALTA |
| P-05 | Conferência finalizada editável e excluível no banco | RLS / sem trigger de trava | ALTA |
| P-06 | Início de conferência não transacional (conferência sem itens) (R-09) | `iniciarConferencia` | ALTA |
| P-07 | Cancelar e excluir histórico sem confirmação | `unidade.$id.tsx` 457/755 | ALTA |
| P-08 | Cache offline não recebe edições e exclusões (R-06) | `precarregar.ts` | ALTA |
| P-09 | Tabela inteira por chave no IndexedDB; imagens base64 no cache (memória e lentidão em aparelhos fracos) | `idb.ts`, `fila.ts` | ALTA |
| P-10 | Conferência inteira num componente de 1.683 linhas, regras no cliente | `unidade.$id.tsx` | MÉDIA |
| P-11 | Fotos e assinaturas como base64 no banco | várias | MÉDIA |
| P-12 | Relógio do aparelho define datas e conflitos (R-07) | `datas.ts` | MÉDIA |
| P-13 | Rota nunca visitada não abre offline (SW sem fallback de navegação) | `vite.config.ts` | MÉDIA |
| P-14 | `public/sw.js` morto; exceções da Lovable em `sw.ts`; `allowNavigation` com domínios da Lovable | | BAIXA |
| P-15 | Arquivos `t1..t4.tmp.mjs` versionados na raiz (scripts de teste que usam service role por env) | raiz | BAIXA |
| P-16 | Drift das migrations (§8.5) | `supabase/migrations` | MÉDIA |
| P-17 | Sem versão semântica do sistema; erro TS pré-existente em `__root.tsx` | | BAIXA |
| P-18 | Duas fontes de autorização (`user_roles` × `perfil`) | RLS | MÉDIA |
| P-19 | Histórico operacional atualizado por dois caminhos (cliente + trigger) | `audit.ts` + trigger | BAIXA |
| P-20 | Finalizar não avisa sobre itens pendentes | `finalizarConferencia` | MÉDIA |

---

## 10. Proposta de arquitetura V2 (sem implementar)

1. **Separar a conferência em camadas:**
   - `features/conferencia/` com um *domínio* puro: estados, transições e cálculo de status e tempo, testável;
   - um *repositório* (online/offline);
   - *componentes* mobile-first (lista, item, teclado numérico, scanner futuro).
2. **Eventos em vez de patches.** Cada ação vira um evento imutável com `id` do cliente e `ocorrido_em` do aparelho:
   - `iniciada`, `item_contado`, `item_adicionado`, `pausada`, `retomada`, `finalizada`, `cancelada`, `foto_anexada`.
   - O servidor aplica os eventos por RPC idempotente (`ON CONFLICT (id) DO NOTHING`) e recalcula o estado.
   - Isso resolve duplicidade, ordem, pausas offline e auditoria de uma vez.
3. **Outbox local robusta:**
   - IndexedDB com um *object store* por entidade, com índices e escrita aguardada (transação confirmada antes do "salvo");
   - fila ordenada por conferência, bloqueando dependentes;
   - **nunca descartar:** falhas permanentes vão para "precisa de atenção", com ação do usuário.
4. **Sem timeout que duplica:** toda criação usa **UUID gerado no cliente**, também online. O timeout só muda a UI; a reconciliação acontece pelo id.
5. **Servidor como autoridade das regras:**
   - RPCs `iniciar_conferencia`, `finalizar_conferencia`, `cancelar_conferencia` (transacionais, com validação de status);
   - trigger de trava;
   - índice único de conferência aberta.
6. **Arquivos no Storage:** upload separado e retomável (fila própria), com o item referenciando o caminho.
7. **Delta sync correto:** `updated_at` do servidor + tombstones, particionado por empresa e usuário. O cache é limpo no logout e na troca de usuário.
8. **Android:**
   - plugin Network nativo;
   - voltar com confirmação durante a conferência;
   - scanner via câmera nativa (fase posterior);
   - keystore de release fora do repositório;
   - `allowNavigation` limpo.
9. **Observabilidade:** painel de saúde da sincronização por aparelho (pendências, erros, conflitos) enviado ao servidor.

O plano de fases está em [`V2_ROADMAP.md`](./V2_ROADMAP.md).
