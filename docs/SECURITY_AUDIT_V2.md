# Conferência Rápida — Auditoria de segurança (Etapa 0 da V2)

> Somente leitura. Nenhum segredo é reproduzido neste documento: apenas nomes de variáveis.
> Nenhuma correção foi aplicada. As prioridades refletem apenas impacto técnico e risco
> operacional. Data: 29/09/2026.

## Resumo

| ID | Risco | Prioridade |
|---|---|---|
| S-01 | APK de release assinado com `debug.keystore` versionado no repositório | CRÍTICA |
| S-02 | Conferências encerradas podem ser alteradas ou excluídas por qualquer conferente (sem trava no banco) | ALTA |
| S-03 | Registro de auditoria forjável e apagável pelo próprio usuário | ALTA |
| S-04 | Sessão offline em texto claro (inclui tokens) e guarda de rota que aceita sessão local com o servidor acessível | ALTA |
| S-05 | Cache offline não é limpo no logout nem na troca de usuário (dados de outra conta no aparelho) | ALTA |
| S-06 | 11 funções SECURITY DEFINER expostas via `/rest/v1/rpc` para qualquer usuário logado | MÉDIA |
| S-07 | Proteção contra senhas vazadas desativada no Supabase Auth | MÉDIA |
| S-08 | Duas fontes de autorização (`user_roles` × `user_profiles.perfil`) e `perfil_atual()` que colapsa níveis | MÉDIA |
| S-09 | Regras de negócio da conferência só no cliente (qualquer usuário com a chave pública pode chamar o PostgREST diretamente) | MÉDIA |
| S-10 | IP do usuário obtido de serviço de terceiros (ipify) pelo navegador | BAIXA |
| S-11 | Logs de console detalhados do cofre offline em produção | BAIXA |
| S-12 | Resíduos da Lovable (`allowNavigation`, exceções no SW) e scripts `t*.tmp.mjs` versionados | BAIXA |
| S-13 | Identificação do Master por e-mail fixo no código | BAIXA |
| S-14 | Server function pública `registrarTentativaLogin` funciona como oráculo de senha, com limite de frequência ineficaz em Workers | ALTA |

---

## S-01 — APK assinado com chave de debug pública — CRÍTICA
- **Onde:** `mobile/android/app/debug.keystore` (versionado) e `android/app/build.gradle`. O release usa `signingConfigs.debug` quando `CR_KEYSTORE_FILE` não está definido, que é o que acontece hoje no CI.
- **Risco:** o repositório é público. Qualquer pessoa pode gerar um APK malicioso **com a mesma assinatura**. O Android o aceita como *atualização* do app instalado, com acesso aos dados locais (cofre, cache offline, sessão).
- **Recomendação:**
  - criar uma keystore de release fora do repositório e guardá-la como segredo do GitHub (`CR_KEYSTORE_FILE`, senha e alias);
  - fazer o build de release **falhar** sem ela.
  - Atenção: trocar a chave exige desinstalar a versão atual uma única vez. Planejar a comunicação com os usuários.

## S-02 — Conferência encerrada editável e excluível — ALTA
- **Onde:** policies `conferencias_update/delete` e `conferencia_itens_update/delete`. Exigem apenas `pode_unidade` + `user_roles ∈ {admin, conferente}`, sem restrição de `status`.
- **Risco:**
  - adulteração de quantidades, assinaturas e horários depois da finalização;
  - "Excluir histórico" apaga fisicamente a conferência, com cascata em itens, pausas, histórico e notificações;
  - não há confirmação na interface.
- **Recomendação:**
  - trigger que bloqueia update/delete em `finalizada`/`cancelada`, com exceção auditada para nível ≥ 4;
  - trocar a exclusão por arquivamento (soft delete).

## S-03 — Auditoria forjável e apagável — ALTA
- **Onde:**
  - `auditoria_insert` permite a qualquer usuário inserir qualquer `acao`/`detalhe`/`perfil`/`ip`, desde que `user_id = auth.uid()`;
  - os campos são preenchidos pelo cliente (`src/lib/audit.ts`);
  - `historico_update_own` permite ao dono alterar o próprio histórico operacional.
- **Risco:** a trilha de auditoria não é confiável como evidência.
- **Recomendação:**
  - gerar os eventos críticos no servidor (triggers ou RPC SECURITY DEFINER), com perfil e horário vindos do banco;
  - tornar a auditoria *append-only*, sem update/delete para nenhum papel de aplicação.

## S-04 — Sessão offline em texto claro e fallback permissivo — ALTA
- **Onde:** `src/lib/offline/cofre.ts`. `abrirSessaoOffline()` grava o `DadosCofre` inteiro (inclui `token` e `refreshToken`) **sem criptografia** em `localStorage` e `sessionStorage` (`cr:sessao-offline`). O cofre criptografado perde o sentido depois do primeiro login offline.
- **Guarda de rota:** `src/routes/_authenticated/route.tsx`. Online, se `getUser()` falhar (inclusive por usuário **bloqueado, excluído ou com sessão revogada**), aceita a sessão offline local.
  - A RLS continua barrando o acesso aos dados do servidor.
  - Mas a interface abre e as operações vão para a fila local.
- **Recomendação:**
  - guardar na sessão offline só identificadores (sem tokens);
  - usar o fallback apenas quando o erro for de rede;
  - em erro 401/403, limpar a sessão local.

## S-05 — Cache offline compartilhado entre contas — ALTA
- **Onde:** o IndexedDB `conferencia-offline` e a chave `cr:acesso` não são particionados por usuário, e **não são limpos no logout**. `esquecerAcesso()` existe, mas nunca é chamada.
- **Risco:** em aparelho compartilhado, o próximo usuário, inclusive de outra empresa, vê offline dados baixados pela conta anterior. Pendências da fila de um usuário podem ser enviadas com o token de outro, e a RLS as rejeita, o que gera a perda descrita em R-02.
- **Recomendação:**
  - particionar o banco local por `user_id`;
  - no logout, limpar o cache (preservando e avisando sobre pendências não enviadas).

## S-06 — Funções SECURITY DEFINER expostas — MÉDIA
- **Linter do Supabase:** `assinatura_ativa_empresa`, `criar_empresa_onboarding`, `criar_modulos_iniciais`, `criar_setores_iniciais`, `diagnostico_permissoes`, `eh_usuario_legado`, `empresa_do_usuario`, `has_role`, `modulos_ativos_empresa`, `plano_da_empresa`, `usuarios_ativos_empresa`.
- **Pontos específicos:**
  - `diagnostico_permissoes` tem um comentário no código dizendo que "não é executável por usuários logados", mas é. Ela limita o retorno a si mesmo, ao global ou ao admin da mesma empresa.
  - `criar_modulos_iniciais` e `criar_setores_iniciais` recebem `_empresa_id` arbitrário. **É preciso verificar** se validam que o chamador pertence à empresa. Não foi possível confirmar sem ler cada corpo; fica para a V2.4.
- **Recomendação:**
  - revogar `EXECUTE` de `authenticated` nas que só o servidor usa;
  - mover as auxiliares para `app_private`;
  - validar a posse da empresa em todas as que recebem `_empresa_id`.

## S-07 — Proteção contra senhas vazadas desativada — MÉDIA
Ativar em Supabase → Authentication → Password security (HaveIBeenPwned). A mudança é de configuração, sem código.

## S-08 — Autorização duplicada — MÉDIA
- **Conferências e materiais:** a RLS usa `user_roles` (`admin/conferente/visualizador`).
- **Resto do sistema:** usa `user_profiles.perfil` (níveis 1–6).
- **`perfil_atual()`:** devolve `'administrador'` para proprietário e super_admin. É usada em `auditoria_read` e `historico_select_admin`.
- **Risco:** divergência entre o que a interface mostra e o que o banco permite. Um perfil alterado sem ajustar o `user_roles` mantém (ou perde) o poder de escrita.
- **Recomendação:** uma única função de nível no banco para todas as policies.

## S-09 — Regras só no cliente — MÉDIA
- **Regras hoje:** "não contar pausada", "assinatura obrigatória", "motivo obrigatório para material adicional", "não duplicar conferência aberta". Todas vivem só no navegador.
- **Risco:** um usuário com a chave pública (que é pública por natureza) e um token válido pode violar essas regras chamando o PostgREST diretamente.
- **Recomendação:** RPCs transacionais + constraints e triggers (ver `V2_AUDIT.md` §8.6).

## S-10 — IP via terceiros — BAIXA
- **Onde:** `src/lib/audit.ts` chama `https://api.ipify.org` pelo navegador.
- **Risco:**
  - expõe a um terceiro que o usuário está usando o sistema;
  - o valor pode ser forjado pelo cliente.
- **Recomendação:** obter o IP no Worker (`CF-Connecting-IP`).

## S-11 — Logs verbosos — BAIXA
`cofre.ts` registra no console o perfil, o setor e a quantidade de unidades a cada login. Remover em produção.

## S-12 — Resíduos — BAIXA
- **Domínios:** `capacitor.config.json/allowNavigation` inclui `*.lovable.app`, `oauth.lovable.app` e `lovable.dev`, que não são mais usados. Deixam o WebView navegar para esses domínios dentro do app.
- **Código morto:** `src/lib/offline/sw.ts` ainda tem exceções da Lovable, e `public/sw.js` não é usado.
- **Scripts:** `t1..t4.tmp.mjs` (raiz) são scripts de teste que usam `SUPABASE_SERVICE_ROLE_KEY` **via variável de ambiente**, sem segredo embutido. Remover para não serem executados por engano.

## S-13 — Master por e-mail fixo — BAIXA
- **Onde:** `EMAIL_MASTER` em `master.server.ts` e `app_private.eh_master()`.
- **Risco:** trocar o e-mail do proprietário exige deploy e migration.
- **Recomendação:** papel dedicado em tabela.

## S-14 — Oráculo de senha em `registrarTentativaLogin` — ALTA
- **Onde:** `src/lib/audit.functions.ts`. A server function não exige autenticação: recebe e-mail e senha, testa a credencial com `signInWithPassword` a partir do Worker e devolve:
  - `{ok:false}` quando a senha está **correta**;
  - `{ok:true}` quando está errada.
- **Risco:**
  - qualquer pessoa pode testar senhas por esse endpoint;
  - as tentativas saem dos IPs da Cloudflare, e não do IP do atacante, o que dilui o limite por IP do Supabase Auth;
  - o limite próprio (5 por e-mail/IP em 5 min) fica num `Map` em memória. No Cloudflare Workers ele não é compartilhado entre isolates e é zerado a cada reinício, então é praticamente ineficaz;
  - cada chamada ainda cria e descarta uma sessão real.
- **Recomendação:**
  - não retestar a credencial no servidor;
  - registrar a falha a partir do erro que o próprio cliente recebeu, sem receber a senha;
  - limitar a frequência de forma persistente (Durable Object, KV ou tabela com janela);
  - resposta sempre idêntica, independentemente do resultado.

---

## Pontos verificados sem problema relevante
- **RLS e segredos:**
  - RLS habilitada em todas as 35 tabelas de `public`;
  - `SUPABASE_SERVICE_ROLE_KEY`, Brevo, Mercado Pago, WhatsApp e `MONITOR_HOOK_SECRET` existem só como segredos do Worker/GitHub. Nenhum aparece no bundle nem no repositório;
  - o `.env` versionado contém apenas URL, ID do projeto e chave **publicável** (públicas por design).
- **Endpoints e funções do servidor:**
  - `/api/public/hooks/monitor-conferencias` exige `x-hook-secret` (env ou `validar_hook` no banco);
  - server functions administrativas usam `requireSupabaseAuth`, e as do Master também `exigirMaster`;
  - `importar_dados_legados` é executável apenas por `service_role`.
- **WebView:**
  - sem cleartext, sem mixed content, depuração desativada;
  - ponte JS restrita às origens do sistema;
  - `FileProvider` não exportado.
- **Senhas:** o cofre offline usa PBKDF2 com 210 mil iterações + AES-GCM, e a senha nunca é armazenada.
