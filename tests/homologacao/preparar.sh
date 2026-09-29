#!/usr/bin/env bash
# Homologação LOCAL (descartável): Supabase local com as migrations do repositório + app real.
#
#   tests/homologacao/preparar.sh supabase   -> sobe o Supabase local (Docker) e aplica as migrations
#   tests/homologacao/preparar.sh app <0|1> <porta>  -> compila o app (V2 desligada/ligada) e sobe
#   tests/homologacao/preparar.sh env        -> imprime os "export" das variáveis HOMOLOG_*
#
# Nunca aponta para produção: o app é compilado com VITE_SUPABASE_URL=http://localhost:54321.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${HOMOLOG_DIR:-$RAIZ/.homologacao}"
SUPABASE="${SUPABASE_BIN:-npx --yes supabase@2}"

supabase_local() {
  mkdir -p "$DIR/sb" && cd "$DIR/sb"
  [ -f supabase/config.toml ] || $SUPABASE init --force >/dev/null
  sed -i 's/^enable_confirmations = true/enable_confirmations = false/' supabase/config.toml
  rm -rf supabase/migrations && mkdir -p supabase/migrations
  cp "$RAIZ"/supabase/migrations/*.sql supabase/migrations/
  $SUPABASE start -x studio,realtime,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
}

variaveis() {
  cd "$DIR/sb"
  $SUPABASE status -o env | tr -d '"' | sed -n \
    -e 's/^API_URL=/export HOMOLOG_SUPABASE_URL=/p' \
    -e 's/^ANON_KEY=/export HOMOLOG_ANON_KEY=/p' \
    -e 's/^SERVICE_ROLE_KEY=/export HOMOLOG_SERVICE_ROLE_KEY=/p' \
    -e 's/^DB_URL=/export HOMOLOG_DB_URL=/p'
}

app() {
  local v="$1" porta="$2"
  eval "$(variaveis)"
  cd "$RAIZ"
  rm -rf dist
  NITRO_PRESET=node-server VITE_SUPABASE_URL="http://127.0.0.1:54321" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$HOMOLOG_ANON_KEY" VITE_CONFERENCE_V2="$v" npx vite build >/dev/null
  rm -rf "$DIR/app-v$v" && cp -r dist "$DIR/app-v$v"
  node tests/homologacao/corrigir-manifesto.mjs "$DIR/app-v$v"
  cd "$DIR/app-v$v"
  SUPABASE_URL="$HOMOLOG_SUPABASE_URL" SUPABASE_PUBLISHABLE_KEY="$HOMOLOG_ANON_KEY" \
    SUPABASE_SERVICE_ROLE_KEY="$HOMOLOG_SERVICE_ROLE_KEY" APP_URL="http://127.0.0.1:$porta" PORT="$porta" \
    nohup node server/index.mjs >"$DIR/app-v$v.log" 2>&1 &
  for _ in $(seq 1 60); do curl -sf "http://localhost:$porta/" >/dev/null && break; sleep 1; done
  echo "app (VITE_CONFERENCE_V2=$v) em http://localhost:$porta"
}

case "${1:-}" in
  supabase) supabase_local ;;
  env) variaveis ;;
  app) app "${2:?0 ou 1}" "${3:?porta}" ;;
  *) echo "uso: $0 supabase | env | app <0|1> <porta>"; exit 2 ;;
esac
