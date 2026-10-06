# Example tools

Seed tools for the local demonstration. Everything here is synthetic:
fictional companies, made-up people, and public knowledge only. They are
published automatically by `npm run seed` (see
`packages/server/src/seed.ts`) and can also be published by hand with the
CLI.

| Entry | Kind | Folder | What it validates |
|---|---|---|---|
| `kit/prep` | hosted, single HTML file | `prep/` | **Shared collection reads.** Renders company briefs from the shared `company-briefs` collection, refreshing on focus with a revision check. **Personal storage** for per-company notes and the last viewed company. |
| `kit/briefs-editor` | hosted, single HTML file | `briefs-editor/` | **Controlled shared writes.** A separate editing tool. It can only write when the collection owner has granted the user as a writer *and* granted this tool as a writer context. Shows the missing-capability message otherwise. Revision-checked saves detect conflicting edits. |
| `kit/focus` | hosted, single HTML file | `focus/` | **Personal storage only.** Preferences and a session log, isolated per user and per tool, persistent across sessions and devices. |
| `kit/meet` | hosted, minified Preact bundle | `tz-minified/` | **Adaptation from published files.** Only the minified `dist/` is published; `src/` never is. Favourite cities use personal storage. |
| `kit/teamdocs` | external link (resource) | created by the seed script | **Everyday links.** Searchable catalog entry that redirects directly; not shown among tool recommendations. |
| `kit/statuspage` | external tool | created by the seed script | **External tools.** Full catalog entry, recommended in drawers, launches at its own URL. |

The seed script also creates the `company-briefs` shared collection from
`data/briefs.json`, grants `briefs-editor` as a writer context, grants Carol
(a synthetic user) as a writer, and issues an updater credential for
`updater/refresh-briefs.mjs`, which demonstrates an authorized out-of-band
refresh that readers pick up on their next fetch.

## Publishing by hand

Each folder has a `kitlane.json` with the tool's name, title, purpose, tags,
and deploy path. After `npx kitlane login <portal-url>`:

```sh
npx kitlane publish examples/prep --name prep
npx kitlane publish examples/briefs-editor --name briefs-editor
npx kitlane publish examples/focus --name focus
npm run build -w examples/tz-minified && npx kitlane publish examples/tz-minified/dist --name meet
```

A single HTML file is packaged as `index.html` automatically. If the name is
not yet claimed, the CLI claims it for you using the metadata in
`kitlane.json`.

## Hosting constraints these examples follow

- Reference assets relatively (`./app.js`), never root-absolute, because the
  shell pins pages under `/_releases/<version>/`.
- Load the SDK from `/._kitlane/sdk.js`; it is the one allowed root-absolute
  route and hosted files can never shadow it.
- No external CDNs or fonts: the hosted-content policy is `default-src
  'self'` unless the operator allows more.
- Keep secrets out of the files. Updater credentials belong to the external
  process, never to published HTML or JavaScript.
