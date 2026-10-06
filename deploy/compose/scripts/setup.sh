#!/usr/bin/env sh
# Creates .env from .env.example with generated secrets. Safe to re-run: existing values are kept.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi
gen() { openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'; }
fill() {
  key="$1"; val="$2"
  if grep -q "^${key}=$" .env; then
    # portable in-place edit
    tmp="$(mktemp)"; sed "s|^${key}=$|${key}=${val}|" .env > "$tmp" && mv "$tmp" .env
    echo "set ${key}"
  fi
}
fill POSTGRES_PASSWORD "$(gen)"
fill KITLANE_SECRET "$(gen)"
fill KITLANE_INGRESS_SECRET "$(gen)"
# oauth2-proxy requires exactly 32 bytes, base64url encoded (43 chars without padding is 32 bytes).
fill OAUTH2_PROXY_COOKIE_SECRET "$(openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_' | cut -c1-43)"
chmod 600 .env
echo
echo "Next:"
echo "  Local demo:  docker compose -f docker-compose.yml -f compose.local.yml up -d --build"
echo "               then run scripts/trust-local-ca.sh and open https://kit.localhost"
echo "  Team:        edit .env (KITLANE_DOMAIN, OIDC_*, ACME_EMAIL, CADDYFILE=Caddyfile.team, KITLANE_ADMIN_USERS)"
echo "               docker compose -f docker-compose.yml -f compose.team.yml up -d --build"
