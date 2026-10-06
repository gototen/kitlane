# Briefs updater

`refresh-briefs.mjs` is an example of a **separate updater process**: a script that refreshes a shared
Kitlane collection from outside the browser. It reads `../data/briefs.json`, stamps each brief with a
new `updatedAt` and a generated news line, and writes the result to the `company-briefs` collection in
bounded atomic batches. Every tool that reads the collection (such as `kit/prep`) sees the new data on
its next fetch.

Kitlane has no jobs runtime or scheduler. Updaters run wherever you already run things: by hand, from
cron, from a CI schedule, or from any external scheduler.

## Requirements

- Node 22 or newer (uses the global `fetch`; no dependencies).
- An **updater credential** scoped to the collection.

## Getting a credential

An updater credential is issued by the collection owner and is scoped to named collections and
operations. It cannot read personal storage, publish tools, or touch any other collection.

Either:

- Open the collection in the portal (`kit/.collection/<id>`) and use **Create credential** under
  *Updater credentials*, choosing the operations `read`, `write`, and `bulk` (add `delete` only if you
  intend to use `--replace-all`); or
- Use the CLI: `kitlane updaters create --label nightly --collection <id> --ops read,write,bulk`.

The credential is shown once. Store it in your scheduler's secret store or an environment file with
restricted permissions.

**Never commit a credential and never put one in published HTML or JavaScript.** Published files are
readable by every member of the installation. If a credential leaks, revoke it from the collection
page or with `kitlane updaters revoke <id>`; revocation takes effect on the next request.

## Running

```sh
export KITLANE_URL=https://kit.example.com
export KITLANE_UPDATER_TOKEN=klu_...
export KITLANE_COLLECTION_ID=<collection id>

node examples/updater/refresh-briefs.mjs --dry-run   # show what would be sent
node examples/updater/refresh-briefs.mjs             # upsert all briefs
```

Flags:

| Flag | Meaning |
|---|---|
| `--dry-run` | Print the planned operations without contacting the server. |
| `--batch <n>` | Documents per request, 1 to 100 (default 100). Each batch is applied atomically. |
| `--replace-all` | Replace the whole collection with the file's contents in one atomic request. Requires the `delete` operation scope and must fit in a single batch. |

The local demonstration (`npm run seed`) writes a ready-made environment file to `data/updater.env`:

```sh
set -a; source data/updater.env; set +a
node examples/updater/refresh-briefs.mjs
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. The collection revision is printed. |
| 2 | 401: the credential is invalid, expired, or revoked. |
| 3 | 403: the credential is not scoped to this collection or lacks a needed operation. |
| 4 | 423: the collection is frozen by an administrator. |
| 1 | Any other failure (bad configuration, network, payload too large). |

## Scheduling examples

cron, every night at 02:15:

```cron
15 2 * * * cd /srv/kitlane && set -a && . /etc/kitlane/updater.env && set +a && /usr/bin/node examples/updater/refresh-briefs.mjs >> /var/log/briefs-updater.log 2>&1
```

A CI schedule works the same way: provide the three environment variables as secrets and run the
script. Nothing about the schedule lives in Kitlane.

## Adapting it

Replace the `briefs.json` read with your own source (an API, a spreadsheet export, a database query),
keep the document shape your reader tool expects, and keep each document under the installation's
document size limit. Use `ifRevision` on individual `set` operations if you need to avoid overwriting
edits made in the browser.
