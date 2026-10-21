#!/usr/bin/env bash
# Teste REAL de instalação e atualização num emulador Android (executado no CI).
# Espera em $DIR os APKs gerados por .github/workflows/android-v2-assinatura.yml:
#   A_atual.apk          versionCode 100 — chave atual (como o app distribuído hoje)
#   B_rotacao.apk        versionCode 101 — rotação chave atual -> chave nova
#   C_mesma_chave.apk    versionCode 102 — nova versão assinada da mesma forma que B
#   D_chave_antiga.apk   versionCode 103 — só a chave antiga (simula APK de terceiro com a chave pública)
#   E_outra_chave.apk    versionCode 104 — chave totalmente diferente
set -uo pipefail

DIR="$1"
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
PKG="br.com.conferenciarapida.app"
ERROS=0
echo "Emulador API $API"

instalar() { adb install -r "$DIR/$1" 2>&1 | tr -d '\r'; }
versao() { adb shell dumpsys package "$PKG" | tr -d '\r' | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1; }
primeira() { adb shell dumpsys package "$PKG" | tr -d '\r' | sed -n 's/.*firstInstallTime=//p' | head -1; }

espera_sucesso() {
  local saida; saida="$(instalar "$1")"
  if echo "$saida" | grep -q "^Success"; then echo "OK   $2 ($1 -> versionCode $(versao))"; else echo "ERRO $2: $saida"; ERROS=$((ERROS+1)); fi
}
espera_recusa() {
  local saida; saida="$(instalar "$1")"
  if echo "$saida" | grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE\|INSTALL_PARSE_FAILED_NO_CERTIFICATES\|signatures do not match"; then
    echo "OK   $2 (recusado: $(echo "$saida" | grep -o 'INSTALL_[A-Z_]*' | head -1))"
  else
    echo "ERRO $2: esperado RECUSAR, obtido: $saida"; ERROS=$((ERROS+1))
  fi
}

adb uninstall "$PKG" >/dev/null 2>&1 || true

espera_sucesso A_atual.apk "instalação da versão atual (chave atual)"
INICIO="$(primeira)"
espera_sucesso B_rotacao.apk "ATUALIZAÇÃO do app atual para a versão com rotação de chave"
[ "$(primeira)" = "$INICIO" ] && echo "OK   foi atualização (dados preservados), não reinstalação" || { echo "ERRO reinstalou"; ERROS=$((ERROS+1)); }
espera_sucesso C_mesma_chave.apk "atualização sobre versão assinada com a mesma chave"
espera_recusa E_outra_chave.apk "APK com outra chave NÃO substitui o app"
if [ "$API" -ge 28 ]; then
  espera_recusa D_chave_antiga.apk "após a rotação, APK só com a chave antiga (pública) NÃO substitui o app (Android 9+)"
else
  echo "INFO API $API (< 28) não suporta rotação: a chave antiga continua aceita nesta versão do Android"
  espera_sucesso D_chave_antiga.apk "comportamento esperado em Android 7/8 (risco residual documentado)"
fi

# O app abre (processo iniciado) após as atualizações.
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 5
if adb shell pidof "$PKG" >/dev/null 2>&1; then echo "OK   app iniciado"; else echo "ERRO app não iniciou"; ERROS=$((ERROS+1)); fi

# Instalação limpa da versão nova (celular novo).
adb uninstall "$PKG" >/dev/null 2>&1 || true
espera_sucesso C_mesma_chave.apk "instalação limpa da versão nova"

echo "Falhas: $ERROS"
exit "$ERROS"
