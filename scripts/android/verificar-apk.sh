#!/usr/bin/env bash
# Verifica um APK antes de qualquer distribuição:
#   pacote, versionCode, assinatura válida e certificados esperados.
#
# Uso: verificar-apk.sh <arquivo.apk> [versionCode-esperado]
# Variáveis opcionais:
#   SHA256_ANTIGA  fingerprint da chave atual (padrão: debug.keystore do projeto)
#   SHA256_NOVA    fingerprint da chave de produção — se informado, EXIGE rotação para ela
#   EXIGIR_ANTIGA  "true" (padrão) = o APK precisa continuar aceitável para quem tem o app atual
set -euo pipefail

APK="$1"
VERSAO_ESPERADA="${2:-}"
PACOTE="br.com.conferenciarapida.app"
BT="${BUILD_TOOLS:-$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)}"
SHA256_ANTIGA="${SHA256_ANTIGA:-2ac3d195b7384f4ac4b9e015113488b220d8979ab4f9acfda614738c990268b7}"
EXIGIR_ANTIGA="${EXIGIR_ANTIGA:-true}"
normal() { tr -d ':' | tr 'A-F' 'a-f'; }

falha() { echo "::error::$*"; exit 1; }

INFO="$("$BT/aapt2" dump badging "$APK")"
PKG="$(echo "$INFO" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
VC="$(echo "$INFO" | sed -n "s/^package: .*versionCode='\([^']*\)'.*/\1/p")"
VN="$(echo "$INFO" | sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p")"
echo "Pacote: $PKG | versionCode: $VC | versionName: $VN"
[ "$PKG" = "$PACOTE" ] || falha "pacote inesperado: $PKG (esperado $PACOTE)"
if [ -n "$VERSAO_ESPERADA" ]; then
  [ "$VC" = "$VERSAO_ESPERADA" ] || falha "versionCode $VC diferente do esperado $VERSAO_ESPERADA"
fi

CERTS="$("$BT/apksigner" verify -v --print-certs "$APK")" || falha "assinatura inválida"
echo "$CERTS" | grep -E "Verified using|Signer|SHA-256 digest" || true
DIGESTS="$(echo "$CERTS" | sed -n 's/.*certificate SHA-256 digest: //p' | normal | sort -u)"

if [ "$EXIGIR_ANTIGA" = "true" ]; then
  echo "$DIGESTS" | grep -qx "$(echo "$SHA256_ANTIGA" | normal)" \
    || falha "o APK não é assinado pela chave atual nem tem rotação a partir dela: NÃO instalaria por cima do app atual"
fi
if [ -n "${SHA256_NOVA:-}" ]; then
  echo "$DIGESTS" | grep -qx "$(echo "$SHA256_NOVA" | normal)" || falha "o APK não contém a chave de produção esperada"
  LINHAGEM="$("$BT/apksigner" lineage --in "$APK" --print-certs 2>&1 | normal)" || falha "o APK não traz a prova de rotação (lineage)"
  echo "$LINHAGEM" | grep -q "$(echo "$SHA256_ANTIGA" | normal)" || falha "a rotação não parte da chave atual"
  echo "$LINHAGEM" | grep -q "$(echo "$SHA256_NOVA" | normal)" || falha "a rotação não chega à chave de produção"
fi
echo "OK: $APK"
