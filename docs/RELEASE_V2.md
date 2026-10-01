# Conferência Rápida 2.0.0 — publicação

- **Data de publicação:** 29/09/2026
- **Versão:** 2.0.0 (web e Android)
- **Produção:** https://conferenciarapida.com.br (Cloudflare Workers, workflow `deploy-web.yml`)

## Banco de dados (Supabase `phixzybxehifndmukvte`)

Antes das migrations:
- backup completo das tabelas de `public` e `app_private` no schema `backup_pre_v2_20260929`
  (36 tabelas, 18.032 linhas; sem acesso para `anon`/`authenticated`);
- catálogo de produção comparado com `supabase/baseline/catalogo_producao_20260929.json`:
  idêntico (a baseline `20260929120000_baseline_v2.sql` representa o banco atual e **não** foi
  reexecutada);
- restrições novas testadas contra os dados atuais: 0 violações.

Migrations aplicadas, nesta ordem:

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 1 | `20260929120100_fase0_autorizacao_isolamento.sql` | autorização por nível, isolamento por empresa |
| 2 | `20260929120200_fase0_integridade_conferencias.sql` | uma conferência aberta por lista, encerrada imutável |
| 3 | `20260929120300_fase0_operacoes_idempotentes.sql` | iniciar/incluir/finalizar/cancelar idempotentes |
| 4 | `20260929120400_fase0_limite_tentativas_login.sql` | limite de tentativas de login no banco |
| 5 | `20260929130000_v22_eventos_conferencia.sql` | eventos da conferência, fotos, conflitos |
| 6 | `20260929130100_v23_alteracoes_sync.sql` | sincronização por cursor, exclusões, limpeza diária |

Verificação depois das migrations:
- contagem de linhas idêntica ao backup (36 tabelas, 18.032 linhas; usuários 2 → 2): **nenhuma perda**;
- 14 funções, 6 restrições CHECK validadas, índice único, 11 triggers, RLS em todas as tabelas
  de `public`, bucket `conferencias` privado, limpeza diária agendada;
- fluxo completo executado como usuário real, dentro de transação desfeita ao final: criar,
  contar, pausar/retomar (tempo pela hora do aparelho), incluir material, conflito entre
  aparelhos, assinatura, finalização, histórico; reabertura direta bloqueada; anônimo bloqueado.

## Aplicação web

- `VITE_SYNC_V2=1` e `VITE_CONFERENCE_V2=1` no `.env`: a **conferência V2 (offline) é a padrão**.
- O código da V1 continua no repositório apenas como fallback (build com `VITE_CONFERENCE_V2=0`).

## Android

- `versionName` 2.0.0; `versionCode` = número da execução do workflow `android-apk.yml`
  (sempre crescente).
- O release abre somente `https://conferenciarapida.com.br/`; a URL de teste local só existe no
  build de debug (o workflow recusa um release que contenha `localhost`/`127.0.0.1`).
- A versão final é publicada como release `android-v2.0.0` **somente** quando assinada com a chave
  de produção (rotação a partir da chave atual, `docs/ANDROID_SIGNING.md`). Sem a chave, o workflow
  publica apenas um pré-release de teste.

### APK final publicado

- Release: https://github.com/CuryyOliveira/CrTech/releases/tag/android-v2.0.0
- Arquivo: `conferencia-rapida-2.0.0-release.apk` (versionCode 12)
- SHA-256: `db60647beae6030873335fbc5befcf77b352f18694235d41ce7c36ddcd447c07`
- Assinado com a chave de produção, com rotação a partir da chave anterior (verificado no
  workflow por `scripts/android/verificar-apk.sh`); sem endereço local no release.

### 2.0.1 — novo ícone

- Release: https://github.com/CuryyOliveira/CrTech/releases/tag/android-v2.0.1
- Arquivo: `conferencia-rapida-2.0.1-release.apk` (versionCode 13)
- SHA-256: `2bdc6f39462d5b7fab9a8c99197adaefc2144fd3e1effd5d0553bf562e7418d0`
- Ícone novo (Android e site), gerado por `scripts/gerar-icones.py` a partir de
  `assets/icone/original.jpg`. Mesma chave de produção: atualiza por cima da 2.0.0.

### 2.0.2 — remoção dos resíduos da Lovable (aguardando publicação)

- APK: `allowNavigation`, origens do canal nativo (`MainActivity`) e `offline.html` sem domínios da
  Lovable; `scripts/android/verificar-dominios.sh` recusa um release com Lovable ou endereço local.
- Site: sem as exceções da Lovable no Service Worker e no retorno do Mercado Pago; removidos
  `VITE_PAYMENTS_CLIENT_TOKEN`, `*SUPABASE_PROJECT_ID`, `@hookform/resolvers`, `public/sw.js`
  (o build gera o `sw.js` do Workbox) e os scripts `t*.tmp.mjs`.
- Mesma chave de produção: atualiza por cima da 2.0.1.

## Limitações conhecidas

- Android 7/8 continuam verificando a chave anterior (esquema v2); Android 9+ passa a exigir a
  chave de produção (`docs/ANDROID_SIGNING.md`).
- Exige Android System WebView 111+ (aparelhos antigos veem o aviso de atualização).
- Melhorias futuras: `docs/BACKLOG_V3.md`.
