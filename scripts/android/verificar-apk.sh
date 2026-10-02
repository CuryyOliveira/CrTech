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
digests() { sed -n 's/.*certificate SHA-256 digest: //p' | normal | sort -u; }

# O que um aparelho Android 7/8 verifica (esquema v2, API 24–27).
ANTIGOS="$("$BT/apksigner" verify --print-certs --max-sdk-version 27 "$APK" | digests)" \
  || falha "assinatura inválida para Android 7/8"
# O que um aparelho Android 9+ verifica (esquema v3, se houver; senão v2).
NOVOS="$("$BT/apksigner" verify --print-certs --min-sdk-version 28 "$APK" | digests)" \
  || falha "assinatura inválida para Android 9+"
LINHAGEM="$("$BT/apksigner" lineage --in "$APK" --print-certs 2>/dev/null | normal || true)"
echo "Android 7/8 verifica: $ANTIGOS"
echo "Android 9+  verifica: $NOVOS"
ANT="$(echo "$SHA256_ANTIGA" | normal)"

if [ "$EXIGIR_ANTIGA" = "true" ]; then
  echo "$ANTIGOS" | grep -qx "$ANT" \
    || falha "Android 7/8: o APK não é assinado pela chave atual — NÃO instalaria por cima do app atual"
  echo "$NOVOS" | grep -qx "$ANT" || echo "$LINHAGEM" | grep -q "$ANT" \
    || falha "Android 9+: o APK não é assinado pela chave atual nem tem rotação a partir dela — NÃO instalaria por cima do app atual"
fi
if [ -n "${SHA256_NOVA:-}" ]; then
  NOVA="$(echo "$SHA256_NOVA" | normal)"
  echo "$NOVOS" | grep -qx "$NOVA" || falha "Android 9+: o APK não é assinado pela chave de produção"
  echo "$LINHAGEM" | grep -q "$ANT" || falha "a prova de rotação não parte da chave atual"
  echo "$LINHAGEM" | grep -q "$NOVA" || falha "a prova de rotação não chega à chave de produção"
fi
echo "OK: $APK"
