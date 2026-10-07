# Backup and restore

Kitlane stores application records in PostgreSQL and deployed files on a local volume. A complete operator backup covers both plus the configuration. A catalog export is not a backup.

## What a full backup contains

| Part | Contents | Privacy |
|---|---|---|
| `kitlane.pgdump` | Catalog entries, names and history, maintainers, versions and deployments, audit events, discovery events, personal documents, shared collections and documents, bindings, grants, hashed updater and access credentials, identity mapping, sessions | Private operational data. Contains personal documents of every user and pseudonymous analytics. |
| `kitlane-data.tar.gz` | The release volume (`/data/releases/...`) and the server secret file if present | Published files are employee-visible already, but the archive may also hold the signing secret |
| `env.backup` | `.env`: database password, ingress secret, signing secret, cookie secret, OIDC client secret | Secret |

Protect backups as you would the database itself: encrypted storage, restricted access, defined retention.

## Scripts (Compose installations)

```sh
cd deploy/compose
./scripts/backup.sh [output dir]      # default backups/kitlane-<timestamp>/
./scripts/restore.sh <backup dir>
```

`backup.sh` runs `pg_dump` inside the Postgres container, archives the `kitlane-data` volume with a helper container, and copies `.env`. `restore.sh` stops the control service, restores the dump into a fresh database and swaps it in, replaces the volume contents, restarts the service, and then runs `kitlane-server revoke-updaters`. Both scripts were run once on 2026-10-07 against the local Compose stack (Compose v2.0 on macOS): the backup produced all three files and the restore brought the catalog and deployed files back with the control service healthy. Still test them on a throwaway installation before relying on them for a team.

## Restoring into a different installation

A restored installation serves the same catalog, files, and documents. Two things must be re-established:

1. **Updater credentials are revoked on restore.** They belong to the source installation and its external processes. Reissue them from each collection's page or with `kitlane updaters create`, and update the external jobs.
2. **Identity mapping.** Users are matched by `external_id` (the IdP subject). If the destination uses a different identity provider, subjects will not match and people will appear as new users. Plan a mapping step or keep the same provider.

Sessions in the dump are harmless (they expire) but you may truncate `sessions` after restore. Personal access tokens remain valid if `KITLANE_SECRET` is unchanged; they are independent of the secret, but rotate them if the backup may have been exposed.

## Catalog export

Any authenticated employee can download `/.export` (or `kitlane export`). It preserves catalog entries, names and history, ownership references, versions metadata, deployments, lineage, shared-collection bindings, collections and grants, and a minimal user list (ID, external ID, display name, team). With `?includeShared=1` or `--include-shared` it also includes documents of unfrozen shared collections. It never includes personal documents, credentials, tokens, sessions, audit events, discovery events, or deployed files. It is suitable for moving catalog metadata or auditing what exists; it cannot restore an installation.

## Development mode

In development mode everything lives under `packages/server/data` (PGlite directory, releases, secret, `updater.env`). Copying that folder while the server is stopped is a complete backup.
