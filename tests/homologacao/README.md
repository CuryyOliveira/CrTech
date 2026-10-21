# Homologação local da V2.1 (app real + Supabase local)

Ambiente **descartável**: Supabase local (Docker, imagens oficiais) com as migrations do
repositório aplicadas em sequência num banco limpo, e o app web real compilado duas vezes
(`VITE_CONFERENCE_V2=0` → V1 e `=1` → V2.1). Nada aponta para produção: `ambiente.ts` recusa
qualquer URL de Supabase que não seja local.

```bash
tests/homologacao/preparar.sh supabase          # sobe o Supabase local e aplica as migrations
eval "$(tests/homologacao/preparar.sh env)"     # HOMOLOG_SUPABASE_URL, chaves locais, DB_URL
tests/homologacao/preparar.sh app 0 3100        # V1 (flag desligada)
tests/homologacao/preparar.sh app 1 3101        # V2.1 (flag ligada)
npx playwright test -c tests/homologacao/playwright.config.ts
```

- `semear.ts`: duas empresas com assinatura ativa, módulo próprio, usuários (senha aleatória por
  execução, só em memória) e listas pequena (8), média (120) e grande (1.000).
- `v1-regressao.spec.ts`: V1 com login real — cadastro de lista, conferência, inclusão de
  material, pausa, retomada, finalização com assinatura, histórico e administração.
- `v21.spec.ts`: V2.1 com login real — conferência completa, alternância V1↔V2, dois aparelhos
  com conflito, troca de usuário, queda real de internet e desempenho (1.000 itens, CPU 4×).
- `android.ts`: o mesmo no WebView real do Android (emulador), usado pelo workflow
  `.github/workflows/v21-android-webview.yml`.
