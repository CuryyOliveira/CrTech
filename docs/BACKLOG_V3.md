# Backlog V3 — melhorias futuras (não bloqueiam a V2)

Registradas durante a publicação da V2 (29/09/2026). Nenhum item abaixo impede o uso em produção.

## Desempenho
- **Iniciar conferência com 1.000+ itens em celular fraco** pode levar vários segundos (6,7–20 s
  em simulação). Medir em aparelho real barato e, se necessário, criar os itens em lotes.
- **Primeira carga de um aparelho novo** cresce com o número de materiais da empresa
  (~0,75 ms por material, pela RLS da V1). Avaliar carga inicial filtrada por lista.
- **RLS de `conferencia_itens`** custa proporcional ao número de conferências em consultas
  de um item só. A sincronização V2 já contorna em lote; revisar a política numa etapa própria.

## Compatibilidade
- O sistema exige Android System WebView 111+. Aparelhos antigos veem o aviso "Atualize o
  navegador do aparelho". Avaliar alternativa para aparelhos sem Play Store.

## Segurança (avisos do Supabase Advisor, nível WARN)
- Ativar "Leaked password protection" no Supabase Auth (painel → Authentication).
- Fixar `search_path` em 5 funções auxiliares sem acesso a tabelas (`cursor_sync_inicial`,
  `conferencia_encerrada`, `alteracao_privilegiada`, `hora_evento`, `ler_cursor`).
- Revisar as funções SECURITY DEFINER expostas a `authenticated` (as administrativas já
  validam nível e empresa internamente).

## Limpeza
- Remover o código da conferência V1 (mantido como fallback: `VITE_CONFERENCE_V2=0`) depois de
  um período estável em produção.
- Remover de `mobile/capacitor.config.json` e `MainActivity.ORIGENS` os domínios antigos da
  Lovable, se não houver mais usuários no endereço antigo.
- Remover o schema de backup `backup_pre_v2_20260929` do banco após o período de segurança.

## Validação
- Testes de campo com usuários reais (luvas, luz forte, aparelhos baratos, sinal fraco).
