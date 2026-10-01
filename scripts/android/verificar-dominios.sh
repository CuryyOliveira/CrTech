#!/usr/bin/env bash
# Confere os endereços dentro de um APK de release:
#  - abre https://conferenciarapida.com.br/;
#  - não contém endereço local (localhost/127.0.0.1) no código;
#  - não contém nenhum domínio da Lovable em nenhum arquivo (código, config, páginas).
# Uso: verificar-dominios.sh caminho/do/app-release.apk
set -euo pipefail
APK="${1:?informe o APK}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q -o "$APK" -d "$TMP"

if cat "$TMP"/classes*.dex | grep -aqE 'http://(localhost|127\.0\.0\.1)'; then
  echo "::error::O APK de release contém endereço local (localhost/127.0.0.1)"; exit 1
fi
cat "$TMP"/classes*.dex | grep -aq 'https://conferenciarapida.com.br/' \
  || { echo "::error::O APK de release não aponta para https://conferenciarapida.com.br/"; exit 1; }
if grep -rail 'lovable' "$TMP" >/dev/null; then
  echo "::error::O APK contém referência à Lovable:"; grep -rail 'lovable' "$TMP" | sed "s#$TMP/##"; exit 1
fi

CFG="$TMP/assets/capacitor.config.json"
[ -f "$CFG" ] || { echo "::error::capacitor.config.json ausente no APK"; exit 1; }
echo "Navegação permitida no APK:"
node -e 'const c=require(process.argv[1]);console.log(" - "+(c.server.allowNavigation||[]).join("\n - "))' "$CFG"
echo "Endereços OK: abre https://conferenciarapida.com.br/, sem localhost e sem Lovable."
