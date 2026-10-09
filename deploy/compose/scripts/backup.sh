#!/usr/bin/env sh
# Full operator backup: database dump + deployed files volume. Output is PRIVATE operational data
# (it contains personal documents, credential hashes, and identity mapping). Protect it accordingly.
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
OUT="${1:-./backups/kitlane-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
echo "dumping database..."
docker compose exec -T postgres pg_dump -U kitlane -d kitlane --no-owner --format=custom > "$OUT/kitlane.pgdump"
echo "archiving deployed files and server secret..."
# Resolve the data volume by its Compose labels (no extra tooling needed on the host).
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr 'A-Z' 'a-z')}"
VOL="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=kitlane-data" | head -1)"
[ -n "$VOL" ] || { echo "could not find the kitlane-data volume for project $PROJECT"; exit 1; }
docker run --rm -v "$VOL":/data:ro -v "$(cd "$OUT" && pwd)":/out alpine sh -c 'cd /data && tar czf /out/kitlane-data.tar.gz .'
cp .env "$OUT/env.backup"
chmod 600 "$OUT"/*
echo "backup written to $OUT"
echo "  kitlane.pgdump        database (catalog, documents, grants, audit, identity mapping)"
echo "  kitlane-data.tar.gz   deployed files + server secret"
echo "  env.backup            configuration and secrets"
echo "Keep this private. Restore with scripts/restore.sh <dir>."
