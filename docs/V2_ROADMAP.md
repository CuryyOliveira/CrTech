# Conferência Rápida — Roadmap da V2

> Proposta baseada em [`V2_AUDIT.md`](./V2_AUDIT.md) e [`SECURITY_AUDIT_V2.md`](./SECURITY_AUDIT_V2.md).
> Nada aqui foi implementado. Cada fase depende de autorização separada.
> Prioridade = impacto técnico e risco operacional: **CRÍTICA / ALTA / MÉDIA / BAIXA**.

## Regras para todas as fases
1. **Desenvolvimento e publicação:**
   - desenvolver na branch `v2-development`, que não dispara deploy;
   - produção continua publicada a partir de `claude/app-to-android-apk-irx1ru`, até que se decida mover para `main`;
   - cada fase termina com uma revisão sua antes de qualquer merge.
2. **Compatibilidade:** o APK carrega o site ao vivo, então toda mudança web precisa manter a ponte `cr-android.js` e as rotas atuais.
3. **Banco:**
   - migrations só **aditivas** até a V1 ser desligada: novas colunas anuláveis, novas tabelas, RPCs novas;
   - nada de remover ou renomear o que a V1 usa;
   - antes da primeira migration, gerar a *baseline* do schema (resolver o drift, `V2_AUDIT.md` §8.5).
4. **Rollout:** atrás de um sinalizador por empresa (ex.: `empresas.config.v2`), para ativar só na sua empresa primeiro.
5. **Fila offline:** nenhuma fase pode descartar dados da fila da V1. A migração da fila antiga para a nova precisa ser automática e testada.

---

## Pré-requisito — Fase 0 (antes da V2.1)

> **Status (29/09/2026): implementada na `v2-development`, aguardando revisão. Nada aplicado em produção.**
> Relatório: [`FASE0_RELATORIO.md`](./FASE0_RELATORIO.md).

| Item | Prioridade | Motivo |
|---|---|---|
| Keystore de release fora do repositório; build de release falha sem ela (S-01) | CRÍTICA | APK pode ser substituído por versão maliciosa |
| Baseline das migrations (resolver o drift) | ALTA | Evita reaplicar migrations antigas |
| Corrigir `registrarTentativaLogin` (S-14) | ALTA | Oráculo de senha público |
| Ativar proteção contra senhas vazadas (S-07) | MÉDIA | Só configuração |
| Suíte mínima de testes do domínio (status do item, tempo, pausas) e do motor offline (fila, sync) | ALTA | Base de segurança para refatorar |

---

## FASE V2.1 — Conferência mobile

| Melhoria | Prioridade |
|---|---|
| Confirmação (com motivo) para **cancelar** conferência e para **excluir** histórico; excluir vira arquivar | ALTA |
| Aviso de itens pendentes ao finalizar (com opção de continuar) | MÉDIA |
| Extrair a conferência de `unidade.$id.tsx` (1.683 linhas) para `features/conferencia/` (domínio puro + repositório + componentes), **sem mudar o comportamento** | MÉDIA |
| Tela de contagem mobile-first: teclado numérico grande, "próximo item" automático, botões +/−, contagem rápida por toque | MÉDIA |
| Motivo obrigatório (ou lista de motivos) para divergência | MÉDIA |
| Botão voltar do Android e do navegador pede confirmação com diálogo aberto ou contagem não salva | MÉDIA |
| Rascunho local do diálogo (quantidade, fotos, assinatura) para não perder ao fechar o app | MÉDIA |
| Busca com destaque, por locação, e memória do último filtro | BAIXA |
| Leitor de código de barras/QR | BAIXA (nesta fase só a interface preparada; implementação na V2.5) |

---

## FASE V2.2 — Offline

| Melhoria | Prioridade |
|---|---|
| **UUID gerado no cliente em toda criação** (conferência, itens, material adicionado), também online. Elimina a duplicidade por timeout (R-01) | CRÍTICA |
| Escrita no IndexedDB **aguardada** (transação confirmada antes de mostrar "salvo") | ALTA |
| Um *object store* por entidade, com índices (conferência, unidade), no lugar de "tabela inteira por chave" | ALTA |
| Particionar os dados locais por usuário; limpar no logout, avisando sobre pendências (S-05) | ALTA |
| Sessão offline sem tokens em texto claro; fallback da guarda de rota só para erro de rede (S-04) | ALTA |
| Delta sync por `updated_at` do servidor + tombstones para exclusões (R-06) | ALTA |
| Tirar imagens base64 do cache principal (carregar sob demanda) | MÉDIA |
| Fallback de navegação no Service Worker (abrir qualquer rota do app offline) | MÉDIA |
| Remover `public/sw.js` morto e as exceções da Lovable | BAIXA |

---

## FASE V2.3 — Sincronização

| Melhoria | Prioridade |
|---|---|
| **Nunca descartar operações:** falha permanente vai para "Precisa de atenção", com tela para tentar de novo, exportar ou descartar conscientemente (R-02) | CRÍTICA |
| Chave de idempotência = id único da operação (não a assinatura do conteúdo), corrigindo pausa/retomada/pausa (R-03) | ALTA |
| Fila ordenada por conferência: uma operação com erro bloqueia as dependentes (R-04) | ALTA |
| RPC transacional e idempotente `iniciar_conferencia` (conferência + itens + histórico numa transação) (R-09) | ALTA |
| Eventos de pausa e retomada com `ocorrido_em` do aparelho; o servidor calcula o tempo pelos eventos, e não pelo `now()` do sync (R-05) | ALTA |
| Índice único de conferência aberta por unidade + reconciliação no cliente quando ele colidir | ALTA |
| Trava de conferência encerrada no banco (trigger) (S-02) | ALTA |
| `updated_at`/`versao` do servidor em `conferencias` e `conferencia_itens`; conflito por versão, e não por relógio (R-07) | MÉDIA |
| Aviso visível ao usuário para cada conflito resolvido a favor do servidor | MÉDIA |
| Envio de e-mail/WhatsApp idempotente por notificação (marcar "enviando" no servidor) | MÉDIA |
| Relatório de saúde da sincronização enviado ao servidor (pendências, erros, conflitos por aparelho) | MÉDIA |

---

## FASE V2.4 — Painel administrativo

| Melhoria | Prioridade |
|---|---|
| Auditoria *append-only* gerada no servidor (triggers/RPC), sem campos vindos do cliente (S-03) | ALTA |
| Unificar a autorização: uma função de nível para todas as policies; aposentar `user_roles` e `perfil_atual()` (S-08) | MÉDIA |
| Revisar e restringir as 11 funções SECURITY DEFINER expostas; validar posse da empresa (S-06) | MÉDIA |
| Regras da conferência também no servidor (RPCs `finalizar_`/`cancelar_conferencia`) (S-09) | MÉDIA |
| Corrigir os avisos de performance do linter (90 `auth_rls_initplan`, FKs sem índice) | MÉDIA |
| Painel de sincronização por aparelho/usuário (usa o relatório da V2.3) | MÉDIA |
| Reabertura de conferência por nível ≥ 4, com motivo e auditoria | MÉDIA |
| Novo dashboard (indicadores de divergência, tempo médio, produtividade) | BAIXA |
| IP obtido no Worker em vez do ipify (S-10); remover logs do cofre (S-11); Master por papel e não por e-mail (S-13) | BAIXA |

---

## FASE V2.5 — Android

| Melhoria | Prioridade |
|---|---|
| (Já na Fase 0) keystore de release — plano de reinstalação única para os usuários atuais | CRÍTICA |
| Plugin nativo de rede (`@capacitor/network`) alimentando o estado de conexão | MÉDIA |
| Scanner de código de barras nativo (ML Kit) exposto pela ponte `cr-android.js` | MÉDIA |
| Fotos: câmera nativa com compressão e envio para o Supabase Storage (fila de upload retomável) | MÉDIA |
| Limpar `allowNavigation` (remover domínios da Lovable) (S-12) | BAIXA |
| Versão semântica única (site + APK) exibida no app, e verificação de "versão mínima da ponte" | BAIXA |
| Remover `t*.tmp.mjs` da raiz do repositório | BAIXA |

---

## Ordem sugerida de execução
1. **Fase 0:** segurança crítica + baseline + testes.
2. **V2.2 e V2.3 juntas:** é onde estão os riscos de perda e duplicação de dados. A tela da V1 continua a mesma, só troca o motor por baixo.
3. **V2.1:** interface mobile sobre o motor novo.
4. **V2.4:** painel e servidor.
5. **V2.5:** Android.

Cada fase termina com:
- testes;
- validação na sua empresa (sinalizador);
- sua autorização para liberar às demais.
