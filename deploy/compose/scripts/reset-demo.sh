#!/usr/bin/env sh
# Resets a PUBLIC DEMONSTRATION installation: drops the database and deployed files, recreates them,
# and reloads the synthetic seed. Everything anyone saved is deleted. Never run this on a team installation.
# Schedule it from cron on the host, for example nightly at 04:00:
#   0 4 * * * cd /srv/kitlane/deploy/compose && ./scripts/reset-demo.sh >> /var/log/kitlane-reset.log 2>&1
set -eu
cd "$(dirname "$0")/.."
if [ -z "${COMPOSE_FILE:-}" ]; then
  if grep -q '^CADDYFILE=Caddyfile.local' .env 2>/dev/null; then export COMPOSE_FILE="docker-compose.yml:compose.local.yml"; else export COMPOSE_FILE="docker-compose.yml:compose.team.yml"; fi
fi
if ! grep -q '^KITLANE_PUBLISHERS=.\+' .env 2>/dev/null && [ "${I_KNOW_THIS_DELETES_EVERYTHING:-}" != "yes" ]; then
  echo "refusing: KITLANE_PUBLISHERS is not set in .env, so this does not look like a demo installation."
  echo "set I_KNOW_THIS_DELETES_EVERYTHING=yes to override."
  exit 1
fi
echo "$(date -u +%FT%TZ) resetting demo data"
docker compose stop kitlane
docker compose exec -T postgres psql -U kitlane -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='kitlane' AND pid <> pg_backend_pid();" -c "DROP DATABASE IF EXISTS kitlane;" -c "CREATE DATABASE kitlane OWNER kitlane;" >/dev/null
# Resolve the data volume by its Compose labels (no extra tooling needed on the host).
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr 'A-Z' 'a-z')}"
VOL="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=kitlane-data" | head -1)"
[ -n "$VOL" ] || { echo "could not find the kitlane-data volume for project $PROJECT"; exit 1; }
docker run --rm -v "$VOL":/data alpine sh -c 'rm -rf /data/releases /data/staging /data/updater.env'
docker compose start kitlane
for i in $(seq 1 60); do docker compose ps kitlane | grep -q healthy && break; sleep 2; done
docker compose run --rm kitlane seed
echo "$(date -u +%FT%TZ) demo reset complete"
