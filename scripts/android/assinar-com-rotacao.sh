#!/usr/bin/env bash
# Assina um APK de release (sem assinatura) com ROTAÇÃO DE CHAVE:
#   chave ANTIGA (debug.keystore, a que está nos celulares hoje) -> chave NOVA (produção).
#
# Resultado:
#   * Android 9+ (API 28+): passa a confiar na chave NOVA (esquema v3 com a prova de rotação);
#     a chave antiga perde o direito de publicar atualizações ("rollback" desativado).
#   * Android 7/8 (API 24–27): continua verificando a chave ANTIGA (esquema v2) — a atualização
#     funciona, mas nesses aparelhos a chave antiga (pública) segue válida. Ver ANDROID_SIGNING.md.
#
# Uso:
#   assinar-com-rotacao.sh <entrada-sem-assinatura.apk> <saida.apk>
# Variáveis (a senha NUNCA é passada na linha de comando):
#   CHAVE_ANTIGA_KS            (padrão: mobile/android/app/debug.keystore)
#   CHAVE_NOVA_KS              arquivo .jks/.p12 da chave de produção
#   ANDROID_KEY_ALIAS          alias da chave de produção
#   ANDROID_KEYSTORE_PASSWORD  senha do keystore de produção
#   ANDROID_KEY_PASSWORD       senha da chave de produção
set -euo pipefail

ENTRADA="$1"
SAIDA="$2"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BT="${BUILD_TOOLS:-$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)}"
ANTIGA="${CHAVE_ANTIGA_KS:-$RAIZ/mobile/android/app/debug.keystore}"
: "${CHAVE_NOVA_KS:?informe CHAVE_NOVA_KS}"
: "${ANDROID_KEY_ALIAS:?informe ANDROID_KEY_ALIAS}"
: "${ANDROID_KEYSTORE_PASSWORD:?informe ANDROID_KEYSTORE_PASSWORD}"
: "${ANDROID_KEY_PASSWORD:?informe ANDROID_KEY_PASSWORD}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Prova de rotação (lineage): assinada pelas duas chaves. Não contém chave privada.
"$BT/apksigner" rotate --out "$TMP/lineage.bin" \
  --old-signer --ks "$ANTIGA" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --set-rollback false \
  --new-signer --ks "$CHAVE_NOVA_KS" --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD

"$BT/zipalign" -f -p 4 "$ENTRADA" "$TMP/alinhado.apk"

"$BT/apksigner" sign --in "$TMP/alinhado.apk" --out "$SAIDA" \
  --ks "$ANTIGA" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --next-signer --ks "$CHAVE_NOVA_KS" --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
  --lineage "$TMP/lineage.bin" --rotation-min-sdk-version 28

echo "Assinado com rotação: $SAIDA"
