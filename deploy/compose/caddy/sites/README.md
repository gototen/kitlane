# Optional extra sites for the team profile

Any `*.caddy` file in this directory is imported by `Caddyfile.team`, so the same Caddy instance can
serve a static landing page (with the privacy notice an identity provider may require) and redirect
secondary domains. Copy `landing.caddy.example` to `landing.caddy`, replace the domains, and run
`docker compose -f docker-compose.yml -f compose.team.yml restart caddy`. The repository's `site/`
folder is mounted read-only at `/srv/site` inside the container.
