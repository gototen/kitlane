# SDK reference

The browser SDK is served on every hosted tool's origin. It carries no credentials; the tool-origin session cookie does. All requests go to reserved routes under `/._kitlane/` on the tool's own origin, and the server derives the tool from the host and the user from the session.

```html
<script src="/._kitlane/sdk.js"></script>                     <!-- global `kitlane` -->
<script type="module">import { kitlane } from "/._kitlane/sdk.mjs";</script>
```

Source: `packages/sdk/src/index.ts`. Types are exported from the module build.

## Identity

```js
const me = await kitlane.me();
// { id: "b8pkg3dw8v", displayName: "Alice Nakamura", team?: "finance", email?: "..." }
```

`id` is an opaque, stable user identifier. `team` is present only when the installation supplies it. `email` is present only when the operator sets `KITLANE_EXPOSE_EMAIL=true`. Route: `GET /._kitlane/me`. The result is cached for the page lifetime.

## Tool information and capabilities

```js
const tool = await kitlane.tool();
// {
//   id, names: ["prep"], title, purpose, lifecycle,
//   version: { id, number } | null,
//   bindings: [{ name: "company-briefs", collectionId, canWrite: true, frozen: false, revision: 4 }],
//   capabilities: { ai: false, personalStorage: true, sharedCollections: true },
//   portalUrl, shortcut
// }
```

Use `bindings[].canWrite` and `capabilities` to report what the current viewer can do instead of guessing. Route: `GET /._kitlane/tool`.

## Personal storage

Scoped to this tool and the signed-in user. Persistent across sessions and devices. Never readable by other users, other tools, maintainers, or administrators through the API.

```js
const prefs = kitlane.user.collection("preferences");

await prefs.set("display", { theme: "dark" });                 // -> Doc
const doc = await prefs.get("display");                         // -> Doc | null
await prefs.delete("display");                                  // -> boolean
const page = await prefs.list({ where: [["kind", "eq", "note"]], orderBy: "createdAt", order: "desc", limit: 50 });
const everything = await prefs.all();                           // follows cursors
await prefs.bulk([{ op: "set", id: "a", data: { n: 1 } }, { op: "delete", id: "b" }]);
await prefs.bulk(ops, { replaceAll: true });                    // replace the whole collection atomically
```

Collection names: `^[a-z0-9][a-z0-9_-]{0,63}$`. Document IDs: `^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$`. Data must be a JSON object (not an array or primitive) up to the document size limit.

A `Doc` is `{ id, data, revision, createdAt, updatedAt, updatedBy? }`.

Routes: `GET|PUT|DELETE /._kitlane/data/user/<collection>/<docId>`, `GET /._kitlane/data/user/<collection>`, `POST /._kitlane/data/user/<collection>/_bulk`.

## Shared collections

Readable by every authenticated member of the installation, through any registered tool that binds the collection. Writing requires both an authorized user and an allowed tool context.

```js
const briefs = kitlane.shared.collection("company-briefs");     // a binding name declared for this tool

const meta = await briefs.meta();
// { collectionId, name, description, revision, frozen, canWrite, writeBlockedReason, ownerId, originToolId }

const page = await briefs.list({ limit: 200 });                 // { items, nextCursor, revision }
const changed = await briefs.listIfChanged(page.revision);      // null when the collection revision is unchanged (ETag)
const one = await briefs.get("acme");

await briefs.set("acme", data, { ifRevision: one.revision });   // only for authorized writers
await briefs.bulk([{ op: "set", id, data }], { replaceAll: false });
```

`writeBlockedReason` is one of `collection_frozen`, `user_not_granted`, `tool_not_granted`, `user_and_tool_not_granted`, or `null`. Show it to the person instead of failing silently; the fix is a grant by the collection owner, not a code change.

Routes: `GET /._kitlane/data/shared/<binding>/_meta`, `GET /._kitlane/data/shared/<binding>` (sends `ETag: W/"<revision>"`, honours `If-None-Match`), `GET|PUT|DELETE /._kitlane/data/shared/<binding>/<docId>`, `POST /._kitlane/data/shared/<binding>/_bulk`.

## Listing, filters, and pagination

`list(options)`:

| Option | Meaning |
|---|---|
| `where` | Array of `[field, op, value]` on top-level fields. Ops: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `contains`. Comparisons use JSONB ordering, so compare like with like (numbers with numbers, strings with strings; ISO timestamps compare correctly as strings). `contains` uses JSONB containment (`@>`): pass an array (for example `["tags", "contains", ["t2"]]`) to test array membership, or an object for key/value containment. At most 8 filters. |
| `orderBy`, `order` | A top-level field name and `asc` or `desc`. When `orderBy` is set, `nextCursor` is an offset cursor (`o:<n>`). |
| `limit` | Default 50, maximum `KITLANE_LIST_LIMIT_MAX` (200). |
| `cursor` | Pass `nextCursor` from the previous page. Without `orderBy`, pagination is keyset by document ID. |

`all(options)` follows cursors and returns every document.

## Conflicts and revisions

Every document has a `revision` starting at 1. Pass `ifRevision` to detect concurrent edits; `0` means "create only".

```js
try {
  await prefs.set("display", next, { ifRevision: doc.revision });
} catch (err) {
  if (err instanceof kitlane.KitlaneError && err.code === "conflict") {
    const current = err.current;      // the server's current document, or null if it was deleted
    // show both versions, let the person decide, then retry with current.revision
  } else {
    throw err;
  }
}
```

Bulk operations may carry `ifRevision` per op. A bulk request either applies entirely or not at all.

## Refreshing shared data

Kitlane has no live subscriptions. Readers refresh on open, on regaining focus, and on a bounded interval; `listIfChanged` avoids downloading unchanged data.

```js
let revision = null;
async function load() {
  const page = await briefs.listIfChanged(revision, { limit: 200 });
  if (page) { revision = page.revision; render(page.items); }
}
await load();
const stop = kitlane.onRefresh(load, { intervalMs: 60_000 });   // minimum interval 15 s
```

## Shell integration

```js
kitlane.shell.isFramed();          // true inside the Kitlane shell
kitlane.shell.setTitle("Acme");    // updates the browser tab via a validated postMessage; sets document.title when not framed
kitlane.shell.setTheme("dark");    // tells the shell which scheme the tool rendered; no-op when not framed
```

### Theme report

The shell matches its Explore tools rail to the tool it frames. When the SDK loads inside the shell it reports the scheme the page actually rendered, so a tool needs no code for the common case:

1. On `DOMContentLoaded` and `load` (immediately if the document is already loaded) it reads `getComputedStyle(document.body).backgroundColor`, falling back to `document.documentElement` when the body is transparent, then to a single-valued `<meta name="color-scheme">`, then to `matchMedia("(prefers-color-scheme: dark)")`.
2. It parses `rgb()`/`rgba()` and computes WCAG relative luminance: below 0.5 is `dark`, otherwise `light`.
3. It posts `{ type: "kitlane:theme", scheme: "light" | "dark" }` to the parent window, and posts again (debounced about 150 ms, only on change) when the OS scheme changes or when `class`, `style`, or `data-theme` change on `html` or `body`.

Everything is wrapped so it never throws, and it does nothing outside an iframe. Call `kitlane.shell.setTheme(scheme)` when your tool changes theme in a way the automatic check cannot see (for example a canvas-drawn background).

What the shell does with it: the message is accepted only from the framed tool's origin and window, and it changes the rail only when the theme is not locked. The theme is locked when the person forced the rail to always light or always dark, or when the tool declares `"theme": "light"` or `"dark"` in `kitlane.json`; a declared `"system"` or no declaration lets the report apply. Without a report, the shell uses the theme sniffed from `index.html`'s color-scheme meta at publish time, then the person's portal preference, then the OS. See `docs/architecture.md`, "Theme resolution".

The pure helpers (`parseColor`, `relativeLuminance`, `schemeForColor`, `schemeFromColorSchemeMeta`, `isTransparent`) are exported from the module build for tools that want the same classification.

## Errors

`KitlaneError` has `code`, `status`, `message`, `details`, and (for conflicts) `current`.

| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | No tool session; the shell will run the sign-in round trip, or the direct visit redirects |
| `forbidden` | 403 | Not permitted (see `details.reason` for shared writes) |
| `not_found` | 404 | Unknown document or binding |
| `conflict` | 409 | `ifRevision` did not match; `current` holds the server's document |
| `frozen` | 423 | The tool or the collection is frozen by an administrator |
| `quota_exceeded` | 413 | Personal or collection quota, or too many documents |
| `payload_too_large` | 413 | Document over the size limit or too many bulk operations |
| `rate_limited` | 429 | Slow down |
| `bad_request` | 400 | Invalid name, ID, filter, or payload shape |
| `capability_unavailable` | 501 | `kitlane.ai.chat` (not enabled in this release) |
| `network` | 0 | The request did not reach the server |

## Not available

`kitlane.ai.chat()` throws `capability_unavailable`; see `docs/deferred/ai-adapter.md`. There are no file uploads, live subscriptions, server-side code hooks, or cross-user reads.
