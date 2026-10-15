# Install: run for a team

This is the supported configuration for a team with several useful tools, recurring users, and one technically capable operator. It has been written and reviewed but not yet executed end to end by the authors (see the caveat in [install-try-locally.md](install-try-locally.md)). Someone outside the project is meant to be able to follow this page; if a step fails, please report it.

## Prerequisites

- One server with Docker 24+ and Docker Compose v2.20+, 2 CPU and 4 GB RAM as a starting point (capacity has not been measured; see below).
- A domain. Decide the portal host, for example `kit.example.com`. Create DNS records pointing at the server for `kit.example.com` and the wildcard `*.sites.kit.example.com`. Tool origins are `app-<id>.sites.kit.example.com`.
- Ports 80 and 443 reachable from your users and from Let's Encrypt.
- An OIDC client at your identity provider (Okta, Entra ID, Google Workspace, Keycloak, Authentik, and others) with redirect URI `https://kit.example.com/oauth2/callback`.
- A decision about who the initial administrators are.

A dedicated domain for the installation is preferred so that unrelated corporate cookies and privileged applications are not in the same cookie scope as employee-authored JavaScript.

## 1. Configure

```sh
git clone <this repository> kitlane && cd kitlane/deploy/compose
./scripts/setup.sh          # creates .env with generated secrets
```

Edit `.env`:

| Variable | Set to |
|---|---|
| `KITLANE_DOMAIN` | `kit.example.com` |
| `CADDYFILE` | `Caddyfile.team` |
| `ACME_EMAIL` | An address for certificate expiry notices |
| `OIDC_ISSUER_URL` | Your provider's issuer, for example `https://login.example.com/realms/corp` or `https://accounts.google.com` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From the client you created |
| `OIDC_EMAIL_DOMAINS` | `example.com` (comma separated), or `*` to admit anyone the provider authenticates |
| `OIDC_USER_ID_CLAIM` | `email` (the claim oauth2-proxy forwards as `X-Forwarded-Email`; the subject is always forwarded as `X-Forwarded-User`) |
| `OIDC_TEAM_CLAIM` | The claim carrying a team or department, if your provider can emit one; otherwise leave the default and teams will be unknown. With Google sign-in, `hd` (the Workspace domain) is an honest choice |
| `KITLANE_ADMIN_USERS` | Comma separated emails or subjects of the initial administrators; they become administrators on first sign-in |
| `KITLANE_REPORTING_CONTACT` | An email address or URL where people report a problematic tool; shown in the portal footer |
| `KITLANE_EXPOSE_EMAIL` | `true` only if tools may see the signed-in user's email through `kitlane.me()` |
| `KITLANE_HOSTED_*_SRC` | Optional Content-Security-Policy allowances for hosted tools (for example an approved CDN) |

Keep `.env` private; it holds the database password, the ingress secret, the signing secret, and the cookie secret.

## 2. Identity provider

Configure the OIDC client as a confidential web client with the authorization code flow and the redirect URI `https://kit.example.com/oauth2/callback`. Kitlane needs the `openid`, `email`, and `profile` scopes and reads these claims through oauth2-proxy:

| Claim | Used for |
|---|---|
| `sub` | Stable opaque user identifier (`users.external_id`) |
| `email` | Cached email; admin matching; shown to tools only if `KITLANE_EXPOSE_EMAIL=true` |
| `preferred_username` | Display name (falls back to the email local part) |
| `team` (configurable) | Team attribution for discovery measurement and catalog metadata; optional |

Only the portal host is behind oauth2-proxy. Tool origins establish their own session through the portal (see [architecture.md](architecture.md)); the provider never sees tool hostnames, so no wildcard redirect URI is needed.

## 3. Start

```sh
docker compose -f docker-compose.yml -f compose.team.yml up -d --build
docker compose logs -f kitlane
```

Caddy obtains a certificate for `kit.example.com` from Let's Encrypt. Tool-origin certificates are issued on demand the first time a registered tool host is visited; Caddy asks Kitlane (`/.well-known/kitlane/host-check`) whether the host is registered before issuing, so unknown names never trigger issuance. Migrations run automatically when the control service starts.

## 4. First sign-in and administrators

Visit `https://kit.example.com`. After signing in, the users listed in `KITLANE_ADMIN_USERS` see an **Admin** link. To promote someone later:

```sh
docker compose run --rm kitlane grant-admin someone@example.com
```

or use the Admin page. Administrators can freeze and unfreeze tools and collections, reserve names, recover ownership of a tool whose maintainer has left, remove a version's content, and see the measurement report.

## 5. Verify the tool-host sign-in bootstrap

Publish a first tool. People install the CLI from the installation itself (`npm install -g https://kit.example.com/.static/kitlane-cli.tgz`), create a token at `/.me#tokens`, then `kitlane login https://kit.example.com --token ...` and `kitlane publish`; a repository can publish on every push with the workflow from `kitlane init --workflow` (see [cli.md](cli.md)). Open it from the portal. The first launch should take one visible round trip through `app-<id>.sites.kit.example.com/.auth/callback` and return to the shell with the tool loaded; the browser's network log should show a `303` from the callback and then a `200` for `/_releases/<version>/index.html`. If the shell shows "Sign in to open this tool", check that cookies for `*.sites.kit.example.com` are allowed and that the DNS wildcard resolves. Also confirm **Open directly** works at the tool's origin.

## 6. Backups

Run `scripts/backup.sh` on a schedule from the host (cron or your scheduler). It writes a database dump, a tar of the release volume, and a copy of `.env` into `backups/<timestamp>/`. These are private operational data. See [backup-restore.md](backup-restore.md).

## 7. Upgrades

```sh
git pull
docker compose -f docker-compose.yml -f compose.team.yml build
docker compose -f docker-compose.yml -f compose.team.yml up -d
```

Migrations run on start. Read the release notes before upgrading; back up first.

## 8. Operating notes

- Policy before a real-data pilot: decide content rules, outbound-network allowances (`KITLANE_HOSTED_CONNECT_SRC` and friends), retention for personal and shared data and for discovery events, and whether any model gateway will be enabled later. Discovery events are not pruned automatically; run `DELETE FROM discovery_events WHERE at < now() - interval '90 days'` on your chosen schedule.
- Limits are configured by environment; defaults are listed in [hosting-constraints.md](hosting-constraints.md).
- Capacity has not been measured. The control service streams release files from a local volume and serves pages from one Node process; a small team on one server is the design point. Measure before promising more.
- Logs: the control service logs startup and unhandled errors to standard output; it does not log request bodies.

## Questions to answer with each adopter before claiming production compatibility

1. Which identity gateway and organizational attributes are actually available (is there a team claim)?
2. Does the company already operate a name service, catalog, hosting platform, or model gateway that should be pointed at or integrated?
3. Which domain, certificate, browser, and cookie configuration can safely host employee-authored JavaScript?
4. What data classes and dependencies are permitted for these tools?
5. Who operates the installation, responds to reports, and can recover ownership when a maintainer leaves?
