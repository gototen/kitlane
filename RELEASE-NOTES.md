# Release notes

## v0.2.0 (draft, in progress)

Build started 2026-10-06. Release target 2026-10-24. The specification's week-1 and week-2 milestones (2026-09-28 to 2026-10-11) were missed before the build started; the pilot sessions planned for 2026-10-07 to 2026-10-09 did not take place.

### Implemented

- Catalog entries with stable IDs; hosted tools, external tools, and links; purpose and tags; lifecycle (experimental, maintained, retired with replacement); featured flag.
- Names: `^[a-z0-9]+(-[a-z0-9]+)*$`, 2 to 63 characters, case normalized, reserved platform names, administrator reservations, separate name history (`/.h/<name>`). Unknown names lead to search with a claim option and are never created by visiting.
- CLI publishing of a single HTML file or a folder as immutable versions; unchanged-upload detection; rollback; deployment history; download as tar.gz.
- Hardened upload validation: streaming extraction with size, count, and decompression limits; regular files only; path, reserved-prefix, repository-history, and credential-file rejection; allowed-extension list.
- Authorization: authenticated employee, maintainer, owner (co-maintainers, transfer), administrator (recover ownership, reserve names, freeze and unfreeze tools and collections, remove version content with the audit event preserved, grant admin).
- Per-tool origins `app-<id>.<tools domain>`; release paths `/_releases/<version>/`; non-cacheable redirect from unversioned paths; SPA fallback; hosted-content headers (CSP, nosniff, referrer, permissions, CORP).
- Shell with the Explore tools rail and drawer: "This tool" area, explainable recommendation cards (shared tags, same creator, recent, featured) with at least one card from a different creator when available, Search all tools, Browse all tools, Open directly, Make a copy; Escape closes and restores focus; reduced motion and light/dark; narrow-screen overlay; title synchronization via a validated message.
- Sign-in round trip for tool origins with one-time signed codes, validated return destinations, and a loop guard.
- Portal: home, search with kind, tag, creator, and retired filters, recent tools, my tools, publish page, tool detail with versions, lineage, addresses, maintainers, collections, audit log; collection page with grants, updater credentials, freeze; admin page; measurement report; catalog export.
- Browser SDK: `me`, `tool`, personal collections, shared collections through bindings, list with filters and pagination, bulk writes with `replaceAll`, `ifRevision` conflicts with the current document returned, ETag-based `listIfChanged`, `onRefresh`, `shell.setTitle`, typed errors.
- Document storage on PostgreSQL JSONB: personal isolation by installation, tool, user, collection, and document; shared collections with stable IDs, bindings, user and tool writer grants, revisions, quotas, per-user-per-tool rate limits; updater credentials with collection and operation scopes, expiry, and revocation; collection freeze.
- Discovery measurement events and a north-star report with stated limits.
- `kitlane init` with bounded guidance (`KITLANE.md`, `kitlane.json`, pointer in `AGENTS.md`/`CLAUDE.md`); `kitlane pull` with safe extraction.
- Development identity (local only) and seed data: four hosted tools, two links, one shared collection with twelve synthetic briefs, grants, and an updater credential; `examples/updater/refresh-briefs.mjs`.
- Docker Compose reference package: control service, Postgres 16, oauth2-proxy 7.7.1, Caddy 2.8; local profile with Keycloak 26 and an internal CA; team profile with ACME and on-demand TLS gated by a host check; setup, CA trust, backup, and restore scripts; server subcommands `migrate`, `doctor`, `revoke-updaters`, `grant-admin`.

### Verified

- 68 server tests (names, upload validation, publishing and serving, sign-in round trip, freeze, copy, removal, authorization, personal isolation, shared grants, updaters, export, discovery) and 13 CLI tests pass on PGlite without network access.
- Manual check in Chrome against the development server: dev login, shell with rail, first-launch sign-in round trip, prep rendering briefs, drawer with cards from other creators and reasons, launching a recommendation into a second tool (`kit/meet`) with its own automatic sign-in round trip, title synchronization, Escape closing the drawer and restoring focus to the handle without reloading the iframe (synthetic key event), and the last-viewed company restored from personal storage after a reload.
- CLI against the development server: login, whoami, tool, pull, publish (name claim and unchanged detection), init.
- Updater script refresh observed by a reader on the next fetch.

### Executed after the first draft

- 2026-10-07: the local Compose profile (control service, Postgres 16, oauth2-proxy 7.7.1, Caddy 2.8, Keycloak 26) was built and run on macOS with Docker 20.10 / Compose v2.0. Verified with curl through Caddy: Keycloak sign-in via oauth2-proxy, the host-only gateway cookie, the portal as the signed-in user, administrator mapping from `KITLANE_ADMIN_USERS`, forged identity headers ignored, a CLI token and `kitlane publish` over HTTPS, the per-origin tool sign-in round trip with the `__Host-` tool cookie, the hosted document served on its own HTTPS origin, `kitlane.me()` returning the mapped team, and unauthenticated SDK and direct launches refused or redirected. Three defects were found and fixed in the process (Keycloak volume permissions, missing built-in client scopes, the email header claim).

- 2026-10-07: `scripts/backup.sh` and `scripts/restore.sh` were run against the local stack: the dump, the deployed-files archive, and the env copy were produced; the restore replaced the database and files, restarted the control service, revoked updater credentials, and the published tool survived.

### Written but not executed

- The browser walk-through of the Compose path with the trusted local CA.
- The team profile (`compose.team.yml`: ACME certificates and on-demand TLS for tool hosts).

### Not performed

- Pilot study and seven-day follow-up.
- Independent installation validation by someone outside the project.
- Two-builder adaptation verification (procedure in `docs/adaptation.md`).
- Capacity measurement.
- Rail placement and size testing.
- Narrow-screen (overlay) layout of the shell was not checked in a browser.

### Deferred

Optional AI gateway (design captured in `docs/deferred/ai-adapter.md`); restricted group collections; arbitrary queries and aggregations; live subscriptions; offline sync; binary uploads; MCP server; drag-and-drop and paste publishing; multiple identity, model, and storage adapters; Unicode aliases; redirect templates; people and team pages; advanced rankings; browser extension; external rail component; multi-organization tenancy; managed-service provisioning and billing. See `docs/roadmap.md`.

### Known limitations

- Discovery events are pruned by the control service every ten minutes according to `KITLANE_DISCOVERY_RETENTION_DAYS` (default 90; 0 disables pruning). Pruning is per installation and not configurable per tool.
- Only the first value of the team header is stored; team attribution is often unknown and is reported as such.
- One control-service process is the design point; the rate limiter and concurrency state are in memory.
- Hosted-content CSP allows inline scripts and styles by necessity for single-file tools.
- `kitlane login` requires pasting a token created in the portal.
- Request logging is minimal.

### Deviations from the specification

Documented with rationale in `docs/architecture.md`: tool origins are authenticated by Kitlane-issued host-only sessions bootstrapped from the gateway-authenticated portal rather than by the gateway directly; PGlite is used for tests and Docker-free development; the control service serves release files itself; `kit/.h/<name>` is the name history page; personal-document writes are not audited.
