#!/usr/bin/env sh
# Restores a backup made by scripts/backup.sh into THIS installation.
# After restore, every updater credential is revoked: reissue them for the destination installation.
set -eu
cd "$(dirname "$0")/.."
# Use the same overlay as the running stack (local profile with Keycloak, or team profile).
if [ -z "${COMPOSE_FILE:-}" ]; then
  if grep -q '^CADDYFILE=Caddyfile.local' .env 2>/dev/null; then
    export COMPOSE_FILE="docker-compose.yml:compose.local.yml"
  else
    export COMPOSE_FILE="docker-compose.yml:compose.team.yml"
  fi
fi
SRC="${1:?usage: restore.sh <backup dir>}"
[ -f "$SRC/kitlane.pgdump" ] || { echo "missing $SRC/kitlane.pgdump"; exit 1; }
[ -f "$SRC/kitlane-data.tar.gz" ] || { echo "missing $SRC/kitlane-data.tar.gz"; exit 1; }
echo "This replaces the current database and deployed files. Press Ctrl-C within 5s to abort."
sleep 5
docker compose stop kitlane
echo "restoring database..."
docker compose exec -T postgres psql -U kitlane -d postgres -c "DROP DATABASE IF EXISTS kitlane_restore;" -c "CREATE DATABASE kitlane_restore OWNER kitlane;"
docker compose exec -T postgres pg_restore -U kitlane -d kitlane_restore --no-owner < "$SRC/kitlane.pgdump"
docker compose exec -T postgres psql -U kitlane -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='kitlane' AND pid <> pg_backend_pid();" -c "DROP DATABASE kitlane;" -c "ALTER DATABASE kitlane_restore RENAME TO kitlane;"
echo "restoring deployed files..."
# Resolve the data volume by its Compose labels (no extra tooling needed on the host).
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr 'A-Z' 'a-z')}"
VOL="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=kitlane-data" | head -1)"
[ -n "$VOL" ] || { echo "could not find the kitlane-data volume for project $PROJECT"; exit 1; }
docker run --rm -v "$VOL":/data -v "$(cd "$SRC" && pwd)":/in:ro alpine sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null || true; cd /data && tar xzf /in/kitlane-data.tar.gz'
docker compose start kitlane
echo "revoking updater credentials (they belong to the source installation)..."
docker compose run --rm kitlane revoke-updaters "restored from backup $(basename "$SRC")"
echo "restore complete. Reissue updater credentials from the portal or with: kitlane updaters create ..."
