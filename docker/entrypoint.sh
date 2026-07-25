#!/usr/bin/env bash
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
POSTGRES_USER="${POSTGRES_USER:-saru}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-saru}"
POSTGRES_DB="${POSTGRES_DB:-saru}"
UPLOAD_DIR="${NUXT_UPLOAD_DIR:-/data/uploads}"

export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}}"
export NUXT_UPLOAD_DIR="${UPLOAD_DIR}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
export NITRO_HOST="${NITRO_HOST:-$HOST}"
export NITRO_PORT="${NITRO_PORT:-$PORT}"

mkdir -p "$UPLOAD_DIR"
chown -R postgres:postgres "$(dirname "$PGDATA")" 2>/dev/null || true

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[saru] Initialisiere PostgreSQL …"
  gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=scram-sha-256 --username=postgres
  cat >> "$PGDATA/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
EOF
  cat > "$PGDATA/pg_hba.conf" <<'EOF'
local   all             all                                     trust
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
fi

echo "[saru] Starte PostgreSQL …"
gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1" -w start

if ! gosu postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1; then
  gosu postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}' SUPERUSER;
SQL
fi

if ! gosu postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
  gosu postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};
SQL
fi

echo "[saru] Warte auf Datenbank …"
for _ in $(seq 1 60); do
  if gosu postgres pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "[saru] Führe Migrationen aus …"
node --experimental-strip-types /app/scripts/migrate.ts

shutdown() {
  echo "[saru] Beende Dienste …"
  if [ -n "${APP_PID:-}" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop || true
  exit 0
}

trap shutdown SIGTERM SIGINT

echo "[saru] Starte Anwendung auf ${HOST}:${PORT} …"
node /app/.output/server/index.mjs &
APP_PID=$!
wait "$APP_PID"
EXIT_CODE=$?
shutdown
exit "$EXIT_CODE"
