# CLI reference

`kitlane` publishes static tools, registers URLs, and manages names, collections, grants, and updater credentials against a Kitlane portal. It is in `packages/cli` (npm package `kitlane`). Run it with `npx kitlane` from the repository or install it globally after publishing to a registry.

```
kitlane 0.2.0: publish, discover, and adapt the tools your colleagues make

Usage: kitlane <command> [options]

Account:
  login        Store a personal access token for a portal
  logout       Forget the stored token for a portal
  whoami       Show the signed-in identity

Publish:
  init         Write platform guidance (KITLANE.md) and a kitlane.json metadata template
  publish      Upload a single HTML file or a prepared folder as a new immutable version
  register     Register an existing URL as a tool or link with a memorable name
  rollback     Make an earlier version active (stored data is unchanged)
  names        Add or remove a tool's names
  lifecycle    Mark a tool experimental, maintained, or retired

Discover and adapt:
  tools        List tools (yours with --mine, or search with -q)
  tool         Show one tool: addresses, versions, bindings, maintainers
  search       Search the catalog
  pull         Download a tool's published files for adaptation
  copy         Make a copy: duplicate a tool's published files into a new tool you own

Data:
  collections  Manage shared collections, bindings, and writer grants
  updaters     Issue, list, or revoke scoped credentials for external update processes
  export       Download the catalog export (entries, names, ownership, lineage, bindings)

Global options:
  --portal <url>   Portal to talk to (default: KITLANE_URL or the last login)
  --json           Machine-readable output
  --help, -h       Show help (kitlane <command> --help for usage)
  --version        Show version
```

## Authentication and configuration

The CLI uses a personal access token, separate from your browser session. Create one in the portal at `/.me#tokens` (shown once; default expiry 90 days; revocable there).

```
kitlane login <portal-url> [--token <token>]
kitlane logout [portal-url]
kitlane whoami
```

Without `--token`, `login` prints the token page URL, tries to open it in your browser, and prompts you to paste the token. Configuration is stored at `$XDG_CONFIG_HOME/kitlane/config.json` (default `~/.config/kitlane/config.json`, mode 0600):

```json
{ "default": "https://kit.example.com", "portals": { "https://kit.example.com": { "token": "klp_...", "user": "Alice Nakamura" } } }
```

Resolution order for the portal: `--portal`, then `KITLANE_URL`, then the stored default. For the token: `KITLANE_TOKEN`, then the stored token for that portal. Tokens are sent only as `Authorization: Bearer` to `/.api/cli/*`.

## Project files

`kitlane init [dir]` writes:

- `KITLANE.md`: platform guidance for people and coding agents (publishing contract, hosting constraints, SDK, storage modes, grants, updaters, adaptation, identity, what is not available, a cheat sheet). The content sits between `<!-- kitlane:start -->` and `<!-- kitlane:end -->`; re-running `init` refreshes only that section and leaves your notes alone.
- `kitlane.json` (if missing): `{ "name", "title", "purpose", "tags", "deploy", "repoUrl" }`. `deploy` is detected: `./dist`, `./build`, `./public`, or `./out` containing `index.html`, else a root `index.html`, else `./dist`.
- If `AGENTS.md` or `CLAUDE.md` exist, a bounded pointer section is inserted or updated between the same markers: "This project publishes to Kitlane. Read KITLANE.md for ...". Existing files are never replaced or symlinked; if neither exists, nothing is created.

`.kitlaneignore` (optional, next to the deploy folder) uses gitignore-like patterns: `*` within a segment, `**` across segments, a trailing `/` for directories, a leading `/` to anchor at the root, `#` comments.

## Publishing

```
kitlane publish [path] [--name <name>] [--title <t>] [--purpose <p>] [--tags a,b] [--note <msg>] [--no-activate] [--create]
```

- `path` defaults to `deploy` in `kitlane.json`; `--name` defaults to `name` there.
- A single `.html` file is packaged as `index.html`. A folder must contain `index.html` at its root.
- Always excluded: `.git/`, `node_modules/`, `.env*`, `.DS_Store`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `id_rsa*`, `.kitlaneignore` itself. Symbolic links are skipped with a warning.
- If the name is not yet claimed, the CLI claims it with the title, purpose, and tags from flags or `kitlane.json` and prints `Claimed kit/<name>`. Publishing to an external entry is refused.
- An upload identical to the active version is reported as unchanged and creates no version.
- `--no-activate` uploads a version without making it active; activate it later with `rollback --version <n>`.

```
kitlane register <url> --name <name> [--title <t>] [--purpose <p>] [--tags a,b] [--resource]
kitlane rollback <tool> --version <number|id>
kitlane names add <tool> <name>
kitlane names remove <tool> <name>
kitlane lifecycle <tool> <experimental|maintained|retired> [--replacement <tool-id>]
```

`--resource` registers a link (searchable, not recommended among tools) instead of an external tool.

## Discover and adapt

```
kitlane tools [--mine] [-q <query>]
kitlane tool <name|id>
kitlane search <query>
kitlane pull <tool> [dir] [--version <id>] [--force]
kitlane copy <tool> --name <new-name> [--title <t>]
```

`pull` downloads the active (or given) version as tar.gz and extracts it into `dir` (default `./<name>`), validating every entry: no absolute paths, no `..`, no backslashes or control characters, regular files only (symlinks and links are refused), and it will not overwrite a non-empty directory without `--force`. `copy` creates a new tool you own from the active version, with lineage recorded; it does not download anything.

## Data

```
kitlane collections list [--mine]
kitlane collections create <tool> <name> [--description <text>]
kitlane collections bind <tool> <binding> <collection-id>
kitlane collections unbind <tool> <binding>
kitlane collections show <collection-id>
kitlane collections grant <collection-id> (--user <id|email> | --tool <tool>)
kitlane collections revoke <collection-id> <grant-id>

kitlane updaters create --label <label> --collection <id> [--collection <id> ...] [--ops read,write,bulk] [--expires-days 90]
kitlane updaters list
kitlane updaters revoke <id>

kitlane export [--include-shared] [-o <file>]
```

Only a tool's maintainers can create or bind collections for it; only a collection's owner (or an administrator) can grant, revoke, or issue updater credentials for it. `updaters create` prints the credential once with a warning; `--expires-days 0` means no expiry. `--ops` may include `read`, `write`, `bulk`, `delete` (default `read,write,bulk`).

## Errors and exit codes

Exit code 1 on any failure, with a one-paragraph message:

| HTTP | Message |
|---|---|
| 401 | Not signed in to the portal; run `kitlane login <portal-url>` |
| 403 | Not allowed: <server message> |
| 404 | Not found |
| 409 | Conflict (name taken, duplicate binding, revision mismatch) |
| 413 | Too large |
| 422 | Upload rejected, with the server's details (for example the offending path) |
| 423 | Frozen |

`--json` prints the raw API responses for scripting.
