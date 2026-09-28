# Conferência Rápida — aplicativo Android

Casca nativa (Capacitor 8) que instala o Conferência Rápida como aplicativo Android.

## Como funciona

O app abre o sistema publicado em `https://conferenciarapida.com.br` diretamente no WebView
nativo (`APP_URL` em `MainActivity.java`), usando a rede do próprio Chromium — sem o proxy
interno do Capacitor, que não é compatível com a hospedagem do sistema. Assim toda a lógica, telas, autenticação
(Supabase), funções de servidor (pagamentos, e-mails, WhatsApp, gestão de usuários) e o
banco de dados continuam exatamente os mesmos da versão web — e cada publicação feita na
Lovable chega ao app sem precisar gerar um novo APK.

As adaptações para o Android ficam em:

- `android/app/src/main/java/br/com/conferenciarapida/app/MainActivity.java`
  - exportações (PDF, Excel, CSV, backup JSON) são salvas na pasta **Downloads** e abertas;
  - impressão (`window.print` e relatórios "Imprimir") usa o serviço de impressão do Android
    (imprimir ou salvar como PDF);
  - campos de foto oferecem **câmera** ou galeria;
  - links externos com `target="_blank"` (recibos, WhatsApp) abrem no navegador/app do celular;
  - botão **voltar** navega no histórico do app.
- `android/app/src/main/assets/cr-android.js`: script injetado apenas nas origens do sistema,
  que liga o site a essas funções nativas (canal `CRNativo`).
- `www/offline.html`: tela exibida só quando a página não carrega por falha de rede (mostra o código do erro).

A sessão (Supabase/localStorage), o IndexedDB do modo offline e o Service Worker ficam
guardados no armazenamento do app e persistem entre aberturas.

## Gerar o APK

### Pelo GitHub (recomendado)

Cada push em `mobile/**` executa o workflow **APK Android** (`.github/workflows/android-apk.yml`),
que roda testes/lint, gera `conferencia-rapida-<versão>-release.apk` e `-debug.apk` e publica
os arquivos na página **Releases** do repositório (tag `android-<branch>`) e como artefato da execução.
Também pode ser disparado manualmente em *Actions → APK Android → Run workflow*.

Para assinar com uma chave de publicação própria (necessária para a Play Store), cadastre em
*Settings → Secrets and variables → Actions*:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Sem esses segredos o release é assinado com a chave versionada `android/app/debug.keystore`
(serve para instalação direta; não use para a Play Store).

### Localmente

Requisitos: Node 22+, JDK 21 e Android SDK (API 36).

```bash
cd mobile
npm ci
npx cap sync android
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/conferencia-rapida-<versão>-release.apk
```

Para trocar o endereço do sistema, altere `APP_URL` e `ORIGENS` em `MainActivity.java`
(e `allowNavigation` em `capacitor.config.json`).
