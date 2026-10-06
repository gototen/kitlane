#!/usr/bin/env sh
# Exports Caddy's local root certificate so your browser trusts https://kit.localhost and tool origins.
set -eu
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml -f compose.local.yml cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-local-root.crt
echo "wrote ./caddy-local-root.crt"
case "$(uname -s)" in
  Darwin)
    echo "macOS: run (asks for your password):"
    echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-local-root.crt"
    ;;
  Linux)
    echo "Linux (Debian/Ubuntu): sudo cp caddy-local-root.crt /usr/local/share/ca-certificates/caddy-local-root.crt && sudo update-ca-certificates"
    echo "Chrome on Linux uses its own store: chrome://settings/certificates -> Authorities -> Import"
    ;;
  *)
    echo "Import caddy-local-root.crt as a trusted root certificate authority in your OS or browser."
    ;;
esac
echo "Firefox: Settings -> Privacy & Security -> Certificates -> View Certificates -> Authorities -> Import"
echo "This certificate is local to this machine; remove it when you are done with the demo."
