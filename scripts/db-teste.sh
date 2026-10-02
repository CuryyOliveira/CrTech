#!/usr/bin/env bash
# Banco de TESTE descartável (nunca produção).
#
#   scripts/db-teste.sh iniciar   -> sobe um Postgres local em ./.pg-teste (porta 54329)
#   scripts/db-teste.sh aplicar   -> recria o banco cr_teste: bootstrap + todas as migrations
#   scripts/db-teste.sh parar     -> desliga o Postgres local
#
# No CI o Postgres vem de um service container; basta exportar PG_ADMIN_URL e chamar "aplicar".
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DADOS="${PG_TESTE_DIR:-$RAIZ/.pg-teste}"
PORTA="${PG_TESTE_PORTA:-54329}"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://supabase_admin:supabase_admin@127.0.0.1:$PORTA/postgres}"
BANCO="${PG_TESTE_BANCO:-cr_teste}"

url_banco() { # troca o nome do banco na URL de administração
  echo "${PG_ADMIN_URL%/*}/$1"
}

como_dono() { # o Postgres não roda como root: usa um usuário comum quando necessário
  if [ "$(id -u)" = "0" ]; then
    id pgteste >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgteste
    su -s /bin/bash pgteste -c "$*"
  else
    bash -c "$*"
  fi
}

iniciar() {
  if [ ! -d "$DADOS" ]; then
    mkdir -p "$DADOS"
    [ "$(id -u)" = "0" ] && { id pgteste >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pgteste; chown pgteste "$DADOS"; }
    local senha="$DADOS.senha"
    echo "supabase_admin" > "$senha"; chmod 644 "$senha"
    como_dono "'$BIN/initdb' -D '$DADOS' -U supabase_admin --pwfile='$senha' -A md5 >/dev/null"
    rm -f "$senha"
  fi
  if ! como_dono "'$BIN/pg_ctl' -D '$DADOS' status" >/dev/null 2>&1; then
    como_dono "'$BIN/pg_ctl' -D '$DADOS' -o '-p $PORTA -k /tmp' -l '$DADOS/log.txt' -w start" >/dev/null
  fi
  echo "Postgres de teste em $PG_ADMIN_URL"
}

aplicar() {
  psql "$PG_ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $BANCO WITH (FORCE)" -c "CREATE DATABASE $BANCO"
  local admin_banco; admin_banco="$(url_banco "$BANCO")"
  psql "$admin_banco" -v ON_ERROR_STOP=1 -q -f "$RAIZ/supabase/tests/bootstrap.sql"
  # As migrations rodam como "postgres" (dono dos objetos), exatamente como na plataforma.
  local pg_banco="${admin_banco/supabase_admin:supabase_admin@/postgres:postgres@}"
  pg_banco="${pg_banco/supabase_admin:${PG_ADMIN_SENHA:-supabase_admin}@/postgres:postgres@}"
  for arq in "$RAIZ"/supabase/migrations/*.sql; do
    psql "$pg_banco" -v ON_ERROR_STOP=1 -q -f "$arq" >/dev/null || { echo "FALHOU: $arq"; exit 1; }
    echo "ok  $(basename "$arq")"
  done
  echo "Banco $BANCO pronto."
}

parar() {
  como_dono "'$BIN/pg_ctl' -D '$DADOS' -m fast stop" || true
}

case "${1:-}" in
  iniciar) iniciar ;;
  aplicar) aplicar ;;
  parar) parar ;;
  *) echo "uso: $0 iniciar|aplicar|parar"; exit 2 ;;
esac
