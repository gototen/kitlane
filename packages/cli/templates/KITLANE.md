# Kitlane platform guidance

<!-- kitlane:start -->
This file is written by `kitlane init`. It tells people and coding agents how this project is
published to Kitlane and what the platform does and does not provide. Keep your own notes outside
the markers; `kitlane init` refreshes only the section between them.

## What Kitlane is

Kitlane gives an employee-made tool a memorable address (for example `kit/prep`) and shows an
**Explore tools** rail beside every hosted tool so colleagues discover other tools while they work.
A tool is either a folder of static files hosted by Kitlane or an existing URL registered in the
catalog. Hosted tools get identity, durable per-user storage, and company-readable shared
collections through a small browser SDK. Metadata for this project lives in `kitlane.json`
(`name`, `title`, `purpose`, `tags`, `deploy` folder or file, optional `repoUrl`, optional `theme`).

## Publishing contract

- Publish the working files: a single HTML file, or a folder with `index.html` at its root.
- Kitlane runs no build and no server code. Build locally, then publish the output.
- No source bundle, repository, or prompt history is required. A repository link is optional.
- Every publish creates an immutable version; one version is active. Maintainers can roll back.
- Command: `kitlane publish [path] --name <name>`. The name is claimed on first publish.

## Theme

`theme` in `kitlane.json` is `"light"`, `"dark"`, or `"system"`. The Kitlane shell matches its
Explore tools rail to the tool it frames, so a dark tool gets a dark rail. `"system"` means the
tool adapts to the operating system, and the rail follows the person's own portal preference.
Without the field, Kitlane reads the `<meta name="color-scheme">` tag from `index.html` at publish
time (`dark`, `light`, or `light dark` for system) and, at runtime, the SDK reports the background
colour the page actually rendered (`kitlane.shell.setTheme` sends it explicitly).

## Hosting constraints (read before building)

- Each tool has a stable origin `https://app-<id>.<tools-domain>`; names are aliases, not origins.
- Pages are served under `/_releases/<version>/...`. Use **relative** asset URLs (`./app.js`,
  `styles.css`) or configure your bundler's base for that path. Root-absolute asset URLs such as
  `/app.js` break. The only allowed root-absolute path is `/._kitlane/...` (the SDK and data API).
- Unknown extensionless paths fall back to `index.html` (single-page apps work; deep links do).
- Reserved top-level paths you cannot ship: `._kitlane`, `_releases`, `.auth`, `.dev`, `.kitlane`,
  `.well-known`. Repository history (`.git`), environment files (`.env*`), and key material are
  rejected; the CLI excludes them by default (see `.kitlaneignore` for more patterns).
- Allowed file types: html, js/mjs/cjs, css, json, map, webmanifest, txt, md, csv, xml, svg, png,
  jpg, gif, webp, avif, ico, fonts (woff, woff2, ttf, otf), mp3, ogg, wav, mp4, webm, pdf, wasm.
  Operators may change this list. Default limits: 50 MB per publish, 2000 files, 20 MB per file.
- Content Security Policy baseline: `default-src 'self'` with inline scripts and styles allowed.
  No external CDNs, fonts, or APIs unless the installation operator allowlists them. Bundle
  dependencies locally.

## SDK

Load it from the tool's own origin:

```html
<script src="/._kitlane/sdk.js"></script>            <!-- global `kitlane` -->
<script type="module">import { kitlane } from "/._kitlane/sdk.mjs";</script>
```

```js
const me = await kitlane.me();            // { id, displayName, team?, email? }  (opaque id)
const tool = await kitlane.tool();        // { id, names, version, bindings: [{name, canWrite}], capabilities }

// Personal storage: scoped to this tool AND the signed-in user; survives sessions and devices.
const prefs = kitlane.user.collection("preferences");
await prefs.set("display", { theme: "dark" });
const doc = await prefs.get("display");    // { id, data, revision, updatedAt } or null
await prefs.list({ where: [["kind", "eq", "note"]], orderBy: "savedAt", order: "desc", limit: 50 }); // fields of data
await prefs.all();                          // follows cursors
await prefs.delete("display");
await prefs.bulk([{ op: "set", id: "a", data: {} }, { op: "delete", id: "b" }], { replaceAll: false });

// Shared collections: readable by everyone signed in to this installation, through a named binding.
const briefs = kitlane.shared.collection("company-briefs");
const meta = await briefs.meta();          // { collectionId, revision, canWrite, writeBlockedReason }
const page = await briefs.list({ limit: 200 });
const changed = await briefs.listIfChanged(page.revision); // null when nothing changed (ETag)
await briefs.set("acme", data, { ifRevision: doc.revision }); // only for authorized writers

// Conflicts: pass ifRevision (0 = must not exist yet) and handle the conflict.
try { await prefs.set("display", next, { ifRevision: doc.revision }); }
catch (err) { if (err instanceof kitlane.KitlaneError && err.code === "conflict") { const current = err.current; } }

kitlane.onRefresh(() => reload(), { intervalMs: 60000 }); // focus, visibility, bounded polling
kitlane.shell.setTitle("Acme brief");                     // updates the browser tab via the shell
```

Filter operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `contains` on top-level fields. Documents
are JSON objects up to 256 KB (default). Error codes: `unauthenticated`, `forbidden`, `not_found`,
`conflict`, `frozen`, `quota_exceeded`, `rate_limited`, `payload_too_large`, `capability_unavailable`.

## Two storage modes and the sharing rule

| Mode | Who reads | Who writes |
|---|---|---|
| Personal | the signed-in user, inside this tool only | that user, through this tool |
| Shared collection | **everyone signed in to this installation**, from any registered tool | owner, granted writers in allowed tool contexts, scoped updater credentials |

"Shared" never means public internet. Personal data is never readable by maintainers or other tools.
Changing request parameters cannot reach another person's records or another tool's namespace.

## Writer grants

A browser write to a shared collection succeeds only when the user is an authorized writer **and**
the tool is an allowed writer context. The collection owner and the originating tool are implicit.
A separate editor tool needs `kitlane collections grant <collection-id> --tool <editor>` plus
`--user <person>` for each writer. Opening an editor does not make its visitors writers. Copies of a
tool keep shared bindings as read references and inherit no writer rights; the copy's owner can
create a new collection and rebind the name (`kitlane collections create`, `collections bind`).

## Updating shared data from outside the browser

An external script or scheduled job uses a scoped, revocable credential:
`kitlane updaters create --label nightly --collection <id> --ops read,write,bulk`. It calls
`POST <portal>/.api/updater/collections/<id>/documents/_bulk` with `Authorization: Bearer klu_...`
and `{ "ops": [{ "op": "set", "id": "...", "data": {...} }] }` (max 500 ops; `replaceAll` needs the
`delete` operation). The credential cannot read personal data or publish tools. Never commit it or
put it in published HTML or JavaScript. Kitlane has no scheduler; run the job elsewhere. Readers see
updates on their next fetch (`listIfChanged`, `onRefresh`).

## Adapting someone else's tool

1. `kitlane remix <name> --name <yours>` (or **Remix** in the portal), then `kitlane pull <yours>`.
   `kitlane copy` still works as an alias of `remix`.
2. Edit the files with any agent or builder. Minified bundles are fine; infer from behaviour.
3. `kitlane publish <dir> --name <yours>`. Lineage credits the original creator.
Backends not present in the files are not reproduced. Personal data is never copied.

## Identity

`kitlane.me()` returns an opaque user id and display name. Team and email appear only if the
installation policy exposes them. Missing team data is a graceful fallback, not a guess.

## Not available in this release

- AI gateway (`kitlane.ai.chat`) is disabled; calls fail with `capability_unavailable`.
- No user server code, cron, binary file uploads, live subscriptions, or offline sync.
- No restricted team-only collections: a shared collection is readable by the whole installation.

## CLI cheat sheet

```
kitlane login <portal>            kitlane publish ./dist --name prep       kitlane tool prep
kitlane init                      kitlane register <url> --name docs       kitlane pull prep ./prep-copy
kitlane tools --mine              kitlane rollback prep --version 3        kitlane remix prep --name prep-mine
kitlane collections list          kitlane collections grant <id> --user x  kitlane updaters create ...
kitlane names add prep brief      kitlane lifecycle prep maintained        kitlane export -o catalog.json
```
<!-- kitlane:end -->
