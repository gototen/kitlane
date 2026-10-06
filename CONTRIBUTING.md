# Contributing

Kitlane is an Apache-2.0 reference implementation. Contributions are welcome under that license. No contributor agreement or sign-off is required.

## Development setup

Requires Node 22 or newer and npm 10 or newer. No Docker or Postgres is needed for development and tests; an embedded Postgres (PGlite) is used.

```sh
npm install
npm run build        # SDK, server, CLI, and the minified example
npm test             # server (vitest + PGlite) and CLI tests
npm run typecheck
npm run seed         # synthetic users, tools, and data for the local demo
npm run dev          # http://kit.localhost:3000
```

If `npm install` reports that an install script for `esbuild` was blocked, run `npm approve-scripts --allow-scripts-pending` or `npm rebuild esbuild`.

## Repository layout

- `packages/server/src`: `config.ts` (environment), `app.ts` (host dispatch), `routes/` (portal pages, JSON APIs, tool origin), `services/` (entries, names, versions, upload, documents, discovery, search, tokens, export), `auth/` (identity, sessions), `views/` (Hono JSX), `db/` (adapter and migrations), `client/` (shell and portal scripts built with esbuild), `public/` (stylesheet, favicon, built bundles).
- `packages/sdk/src/index.ts`: the browser SDK; built into `packages/server/public/sdk.js` and `sdk.mjs`.
- `packages/cli/src`: commands, packing, config; `templates/` holds `KITLANE.md` and `kitlane.json`.
- `examples/`: seed tools; `examples/tz-minified/dist` is a build output and is not committed.
- `deploy/compose`: reference installation.

## Conventions

- TypeScript, ESM, 2-space indentation, LF line endings, no trailing whitespace.
- SQL is hand-written and must run on both PostgreSQL and PGlite (both are PostgreSQL; avoid multi-statement prepared queries outside migrations).
- Every authorization decision lives in `services/` and is covered by a test in `packages/server/src/*.test.ts`. Add a test for any new boundary.
- Audit events carry identifiers, revisions, and counts only. Never log document contents, personal data, or credentials.
- Pages are server-rendered; client scripts are small progressive enhancements.
- Prefer plain language in UI copy. Lifecycle labels describe maintainer intent, not certification.

## Tests

- `npm test -w packages/server`: 67 tests across names, upload validation, publishing and serving, documents and grants, discovery.
- `npm test -w packages/cli`: 13 tests across packing, pull extraction safety, and `init` marker handling.

Tests create an in-memory PGlite database per file and exercise the HTTP surface through `app.request`, so they do not need a running server or network access.

## Pull requests

Describe what changed, why, and how you verified it. Keep changes scoped. Update the relevant document under `docs/` when behaviour changes.
