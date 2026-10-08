# Architecture

Kitlane is one Node control service, one PostgreSQL database, and one persistent file volume, behind a trusted TLS and identity gateway. This document describes what is implemented in this repository, the request flows, the data model, the narrow interfaces, and where the implementation deliberately differs from the v0.2 design.

## Components

| Component | Implementation | Notes |
|---|---|---|
| Control service | `packages/server`, TypeScript on Node 22, [Hono](https://hono.dev) with server-rendered JSX pages and two small client bundles | Serves the portal, the shell, the tool origins, the SDK routes, and the JSON APIs |
| Database | PostgreSQL 16 in deployments; PGlite (PostgreSQL compiled to WebAssembly) for tests and Docker-free development | One SQL dialect. Selected by `KITLANE_DATABASE_URL`: `postgres://...` or `pglite://<dir>` or `pglite://memory` |
| Artifact storage | Local persistent volume under `<KITLANE_DATA_DIR>/releases/<entryId>/<versionId>/` | Behind the `ArtifactStorage` interface in `services/storage.ts` |
| Browser SDK | `packages/sdk`, bundled to `/._kitlane/sdk.js` (global `kitlane`) and `/._kitlane/sdk.mjs` | Served on every tool origin; hosted files cannot shadow it |
| CLI | `packages/cli` (`kitlane`) | Personal access tokens against `/.api/cli/*` |
| Ingress | Caddy (TLS) and oauth2-proxy (OIDC) in `deploy/compose` | Portal traffic passes through oauth2-proxy; tool-origin traffic goes to Kitlane directly |

## Origins

Two kinds of origin exist and are dispatched by the request host (`app.ts`):

- The **portal origin**, `KITLANE_PORTAL_URL` (for example `https://kit.example.com`). Catalog, search, tool details, administration, the shell, the sign-in round trip start, the CLI and updater APIs.
- One **tool origin per hosted tool**, `https://app-<entryId>.<KITLANE_TOOLS_DOMAIN>` (default tools domain: `sites.<portal host>`). Release files, the SDK, the data API, and the sign-in callback. The entry ID is derived from the host label; it is never taken from a header or body.

A friendly name such as `kit/prep` is an alias that resolves on the portal. The tool origin is the browser security identity; renaming never moves browser storage or sessions.

```
Employee browser / authenticated CLI
                  |
     Caddy (TLS) ---- oauth2-proxy (portal only) ----+
       |                                             |
   Portal origin                               Tool origin app-<id>.sites.<domain>
   kit.<domain>                                 |                   |
       |                                   release files       /._kitlane/* SDK routes
   Node control service  <----------------------+-------------------+
   - catalog and names                          (same process, dispatched by host)
   - shell and drawer
   - publishing, versions, rollback, copy
   - authorization, freeze, audit
   - collections, grants, updater API
       |
   PostgreSQL  +  release volume
```

## Request flows

### Publish (CLI)

1. `kitlane publish ./dist --name prep` packs the folder into a gzip tar (default exclusions, `.kitlaneignore`, symlinks skipped; a single HTML file becomes `index.html`).
2. `POST /.api/cli/tools/prep/versions` with `Authorization: Bearer klp_...`. If the name does not exist yet the CLI first claims it with `POST /.api/cli/tools`.
3. The server streams the archive through `extractUploadToStaging` (`services/upload.ts`): decompressed byte counting, file count and size limits, regular files only, path validation (no traversal, no reserved prefixes, no repository history or credential files, allowed extensions), SHA-256 per file, `index.html` required at the root.
4. If the manifest hash equals the active version's hash the upload is reported as unchanged. Otherwise the staged directory is moved into the release volume and, in one transaction, the version row, the active pointer (`deployments.publication_revision + 1`), the deployment history row, and the audit event are written. If the transaction fails the release directory is removed.

### Launch through the shell, including the sign-in round trip

Tool origins are not behind oauth2-proxy. Each tool origin has its own host-only session cookie, established through a round trip that the shell orchestrates. Keycloak, Okta, and Entra ID do not allow wildcard redirect URIs, so one OIDC callback per tool host is impractical; and host-only cookies (no `Domain` attribute, `__Host-` prefix over HTTPS) are required so hosted JavaScript cannot set a cookie that the portal would accept.

```
Browser                 Portal (kit.<domain>)              Tool origin (app-<id>.sites.<domain>)
  |  GET /prep              |                                   |
  |------------------------>|  identity from gateway/dev cookie |
  |  shell HTML + iframe    |                                   |
  |<------------------------|                                   |
  |  GET /_releases/<v>/index.html  (Sec-Fetch-Dest: iframe)    |
  |------------------------------------------------------------>|  no tool session
  |  bootstrap page: postMessage {type:"kitlane:needs-auth"}    |
  |<------------------------------------------------------------|
  |  shell: location = /.auth/start?tool=<id>&rd=<shell url>    |
  |------------------------>|  mint one-time code (60 s, HMAC, bound to tool)
  |  302 app-<id>/.auth/callback?code=...                       |
  |<------------------------|                                   |
  |  GET /.auth/callback?code=...                               |
  |------------------------------------------------------------>|  verify + consume code
  |  Set-Cookie: __Host-kitlane_tool=...; 303 -> rd (validated) |
  |<------------------------------------------------------------|
  |  GET /prep  ... iframe now loads with the tool cookie       |
```

The return URL is validated: it must be on the portal origin or on that tool's own origin; anything else falls back to the tool's detail page. The shell allows two automatic attempts per tab (sessionStorage), then shows a visible "Sign in to open this tool" button. A direct top-level visit to a tool origin without a session redirects to `/.auth/start` with its own URL as the return destination, so direct access preserves authentication and policy enforcement.

Release pages are served under `/_releases/<versionId>/...`; a request to an unversioned path on the tool origin is answered with a `302` (`Cache-Control: no-store`) to the active version, so already-open pages keep their version and fresh launches get the active one. Unknown extensionless paths fall back to that release's `index.html` for single-page applications. HTML is `no-store`; other assets are `private, max-age=3600`.

### Data API

Requests from a hosted tool go to reserved routes on its own origin: `/._kitlane/me`, `/._kitlane/tool`, `/._kitlane/data/user/<collection>[/<docId>|/_bulk]`, `/._kitlane/data/shared/<binding>[/<docId>|/_bulk|/_meta]`. The tool ID comes from the host and the user from the tool session; nothing in the request body, query, or headers can change the scope. Mutations require `Origin` equal to the tool origin (or `Sec-Fetch-Site: same-origin`) and `Content-Type: application/json`. A sliding-window limiter applies per user per tool (`KITLANE_REQUESTS_PER_MINUTE`).

Shared writes are allowed only when both the user is authorized (owner or active `user` grant) and the tool is an allowed context (originating tool or active `tool` grant). Copies inherit no grants.

### External updater

An external process calls `/.api/updater/collections/<id>/documents[...]` on the portal origin with `Authorization: Bearer klu_...`. The credential is hashed at rest and scoped to collection IDs and operations (`read`, `write`, `delete`, `bulk`). `replaceAll` and delete operations require `delete`. The gateway skips authentication on `/.api/updater/` and `/.api/cli/`; the server never accepts identity headers on those routes. Writes bump the collection revision inside the same transaction, so readers using `listIfChanged` see the change on their next fetch.

## Data model

Tables are created by `db/migrations.ts` (migration `001_init`).

| Table | Purpose |
|---|---|
| `users` | Cached identity: opaque `id`, `external_id` (IdP subject), display name, optional email and team, `is_admin`, `is_dev_user` |
| `entries` | Stable ID, `kind` (tool or resource), `mode` (hosted or external), title, purpose, tags (JSONB), creator, owner, team, lifecycle, repo URL, external URL, replacement, featured, frozen, copy lineage |
| `maintainers` | Entry and user associations; the owner is also a maintainer |
| `names`, `name_history` | Current aliases (or administrator reservations) and their history, kept separate from deployment history |
| `versions` | Immutable published-file references: number, creator, file count, bytes, content hash, manifest (paths, sizes, SHA-256, content types), copy source, removal state |
| `deployments`, `deployment_history` | One active version per hosted entry with a publication revision; publish, rollback, and copy events |
| `audit_events` | Authorized changes and administrator actions, by identifier only |
| `discovery_events` | Minimal measurement events with team snapshots |
| `personal_documents` | Keyed by installation, tool, user, collection, document; JSONB payload; revision |
| `shared_collections`, `shared_documents` | Stable collection IDs with revision and frozen state; documents with revision and writer attribution |
| `collection_bindings` | Tool-local name to stable collection ID; retained on copy as a read reference |
| `collection_writer_grants` | `user` or `tool` grants with revocation |
| `updater_credentials` | Hashed verifier, label, collection and operation scopes, expiry, revocation, last use |
| `access_tokens` | CLI personal access tokens, hashed, with expiry and revocation |
| `sessions` | Development portal sessions and tool-origin sessions, including pending one-time codes |

## Narrow interfaces

These are ordinary code boundaries, not a plugin system.

| Boundary | Where | Implemented |
|---|---|---|
| Identity | `auth/identity.ts`: `portalIdentity` (gateway headers or dev session or bearer token), `toolIdentity` (tool session) | Gateway headers with ingress secret; development identity |
| Artifact storage | `services/storage.ts` `ArtifactStorage` | Local volume. An object-storage implementation can replace it without touching publishing or serving |
| Document storage | `services/documents.ts` over PostgreSQL JSONB | PostgreSQL and PGlite. A later adapter must preserve isolation, shared-read policy, writer authorization, and revision semantics |
| Name resolution | `services/names.ts` and the portal catch-all route | Kitlane-managed names. An existing go-link service can point `go/prep` at the shell URL today without an adapter |
| Model gateway | `/._kitlane/ai/*` returns `501 capability_unavailable`; `kitlane.ai.chat` throws the same | Deferred; see `docs/deferred/ai-adapter.md` |

## Decisions and deviations from the specification

| Topic | Specification | Implementation | Why |
|---|---|---|---|
| Authenticating tool hosts | The gateway authenticates both portal and tool traffic | The gateway authenticates the portal; Kitlane issues a host-only session per tool origin via a one-time code minted by the authenticated portal | IdPs generally disallow wildcard redirect URIs; host-only cookies are needed to stop cookie tossing from hosted origins; the user experience matches the spec's "first launch may take a top-level round trip" |
| Development database | Same database in development and deployment | PostgreSQL in deployment; PGlite (PostgreSQL in WebAssembly) in tests and Docker-free development | One dialect, hermetic tests, and a demo that needs no Docker |
| Static serving | A static server may serve bytes; the control service need not | The control service serves release files itself with the freeze gate on every request | Simplest way to make requirement 4 of section 7 testable; the storage interface leaves room for a separate static server later |
| `kit/.h/<name>` | Listed as reserved but undefined | Name history page | Closest reading of "keep name history distinct from deployment history" |
| Asset caching | Caches keyed by publication revision | HTML `no-store`; other versioned assets `private, max-age=3600` | Freeze must block fresh access; private caching avoids shared caches serving one user's response to another |
| Personal-write auditing | Data-mutation events record actor, document ID, revision, time | Shared writes are audited by identifier; personal writes are not | Auditing personal document IDs would leak activity about individuals; exports already exclude personal data |
| Team attribute | Approved team metadata from the identity gateway | oauth2-proxy groups claim forwarded as `X-Forwarded-Groups`; first value stored as team | Works with any OIDC provider that can emit a claim; missing team is stored as unknown, never guessed |
| SPA fallback | Static path behaviour must be documented | Unknown extensionless paths in a release serve that release's `index.html` | Lets exported single-page apps deep-link without rewriting their code |
| AI gateway | Conditional | Not shipped; interface boundary documented | Cut first when the schedule slipped, as the spec directs |
| Event retention | Define retention | The control service prunes `discovery_events` every ten minutes using `KITLANE_DISCOVERY_RETENTION_DAYS` (default 90; 0 disables) | Time-based retention only; no per-tool policy yet |

## Operational notes

- Secrets: `KITLANE_SECRET` signs one-time codes and pseudonymous analytics keys; `KITLANE_INGRESS_SECRET` gates identity headers. Both are required in gateway mode. In dev mode a secret is generated into `<data dir>/secret.key`.
- Sessions expire after `KITLANE_SESSION_TTL_SECONDS` (default 12 hours); expired sessions and stale codes are pruned every 10 minutes while serving.
- Server subcommands: `kitlane-server serve` (default), `migrate`, `doctor` (configuration summary and fail-fast checks), `seed` (demonstration tools and data), `revoke-updaters [reason]`, `grant-admin <user id | external id | email>`.
- Health: `GET /healthz`. Certificate check for on-demand TLS: `GET /.well-known/kitlane/host-check?domain=<host>` (host-independent, unauthenticated, answers only whether the domain is this installation's portal or a registered tool host).

- Policy knobs for public installations: `KITLANE_PUBLISHERS` (publishing allowlist), `KITLANE_BANNER` (notice on every page and in the drawer). See `docs/install-public-demo.md`.
