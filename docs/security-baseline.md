# Security baseline

Employee identity establishes who a caller is. Authorization determines which entries, operations, capabilities, and data the caller may use. Per-tool origins provide browser isolation, not permission to mutate other tools. This document records the boundaries the implementation enforces, where each requirement from section 7 of the specification is tested, and what is explicitly not claimed.

## Trust boundaries

| Boundary | Enforced by |
|---|---|
| Ingress to portal | Caddy adds `X-Kitlane-Ingress-Secret`; oauth2-proxy authenticates the portal and sets identity headers. Kitlane accepts identity headers only when the secret matches `KITLANE_INGRESS_SECRET` (`auth/identity.ts`). Header names are configurable. |
| Portal browser session | Gateway cookie (`__Host-kitlane_gateway`, host-only) in production; development session cookie (`kitlane_portal`, host-only) in dev mode only. |
| Tool origin session | `__Host-kitlane_tool` (plain `kitlane_tool` over HTTP in development), host-only, `HttpOnly`, `SameSite=Lax` by default, established through a one-time code bound to the tool and signed with `KITLANE_SECRET`. A cookie for one tool is rejected on another tool's origin. |
| CLI | Personal access tokens (`klp_`), SHA-256 hashed at rest, default 90-day expiry, revocable, accepted only on `/.api/cli/*`. Identity headers and cookies are ignored there. |
| Updaters | Credentials (`klu_`), hashed, scoped to collection IDs and operations, expiring and revocable, accepted only on `/.api/updater/*`. A claimed tool header changes nothing. |
| Hosted JavaScript | Runs on its own origin inside a sandboxed cross-origin iframe; can reach only its own origin's reserved routes with the viewer's tool session. It has no ambient authority over the portal (origin checks on portal mutations) and cannot obtain publishing or management rights. |

## Requirements from section 7 and where they are tested

Tests are in `packages/server/src`. Titles below are the test names.

| # | Requirement | Tests |
|---|---|---|
| 1 | Unauthenticated callers cannot reach protected portal, assets, shared documents, or SDK routes through a bypass path | `redirects an unauthenticated top-level navigation to the portal sign-in start`; `serves a bootstrap page to an unauthenticated iframe that asks the shell to sign in`; `returns 401 JSON for unauthenticated SDK routes`; `rejects identity headers on the CLI API and cookies without a token`; `redirects to the dev login when there is no portal session`; `cannot escape collection or operation scope, reach personal data, or publish` |
| 2 | One employee cannot publish to, reassign, or roll back another employee's tool; an app cannot perform management mutations with the viewer's ambient authority | `refuses uploads from a non-maintainer`; `owner-only: co-maintainers and transfer; admin recovery`; `rejects portal form posts without a matching browser origin`; `requires same-origin for mutations and JSON content type` |
| 3 | Renaming or copying does not inherit another tool's origin, sessions, or service permissions | `rejects a tool cookie on a different tool's origin`; `make a copy duplicates files into a new tool with lineage and no inherited identity`; `copies retain bindings as read references and inherit no writer rights` |
| 4 | Freeze blocks fresh native asset and SDK access by short link and direct URL; cache behaviour tested | `freeze blocks assets, SDK, short link, and direct URL; unfreeze restores`; `resolves unversioned launches to the active release with a non-cacheable redirect` |
| 5 | Upload validation prevents path escape, unbounded expansion, and replacement of reserved SDK routes | `rejects traversal, absolute, reserved, credential, and unsupported paths`; `rejects symlinks`; `rejects path traversal inside the archive`; `rejects reserved platform paths`; `rejects too many files`; `rejects a file over the per-file limit and a total over the upload limit`; `rejects an archive that decompresses far beyond the limit (bomb)`; `rejects uploads with traversal or reserved paths without leaving partial state`; `never serves files outside the release directory` |
| 6 | If AI ships, unauthorized tools cannot invoke it and budgets hold | Not applicable: AI is not shipped; `/._kitlane/ai/*` returns `501 capability_unavailable` |
| 7 | One employee cannot read, list, alter, delete, or export another's personal records; tool A's data is unreachable through tool B; forged parameters, listing, and caches are tested | `isolates records by user: bob cannot read, list, alter, or delete alice's`; `isolates records by tool: the same user cannot reach prep data through the editor tool`; `ignores forged user/tool parameters in body, query, and headers`; `excludes personal records, credentials, tokens, and sessions`; API responses carry `Cache-Control: no-store` and `Vary: Cookie` |
| 8 | Authenticated employees read shared collections through other tools without read grants; ordinary readers and copies cannot write | `is readable from another registered tool through a binding, without a read grant`; `owner writes through the originating tool; ordinary readers cannot write`; `copies retain bindings as read references and inherit no writer rights` |
| 9 | A separate editor checks writer rights; an updater cannot escape scope or reach personal records; revocation and collection freeze apply everywhere | `a separate editor needs both a tool-context grant and a user grant`; `are issued by the collection owner with explicit scopes`; `cannot escape collection or operation scope, reach personal data, or publish`; `collection freeze blocks every path; revocation stops subsequent writes` |
| 10 | Personal data persists across sessions and rollback; copies start fresh and keep read references; conflicts detected; bulk refreshes atomic | `persists across sessions`; `publishes v2 then rolls back to v1 without touching data`; `detects conflicting edits with ifRevision and returns the current document`; `bulk writes are atomic and bounded`; `shared bulk refresh is atomic and oversized refreshes are rejected` |

Additional tests cover the sign-in round trip (`completes the sign-in round trip and serves assets with hosted headers`, `rejects a replayed, tampered, or cross-tool auth code`, `validates the return destination of the sign-in round trip`), content removal (`administrator can remove a version's content while keeping the audit record`), external URL validation (`registers a URL, redirects on launch, and rejects javascript: schemes`), and the drawer and measurement.

## Hosted content headers

Every response from a tool origin carries:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' <KITLANE_HOSTED_SCRIPT_SRC>;
  style-src 'self' 'unsafe-inline' <KITLANE_HOSTED_STYLE_SRC>; img-src 'self' data: blob: <KITLANE_HOSTED_IMG_SRC>;
  font-src 'self' data: <KITLANE_HOSTED_FONT_SRC>; connect-src 'self' <KITLANE_HOSTED_CONNECT_SRC>;
  media-src 'self' data: blob:; worker-src 'self' blob:; frame-src <KITLANE_HOSTED_FRAME_SRC or 'none'>;
  frame-ancestors 'self' <portal origin>; form-action 'self'; base-uri 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()   (KITLANE_HOSTED_PERMISSIONS_POLICY)
Cross-Origin-Resource-Policy: same-site
Cache-Control: no-store (HTML) | private, max-age=3600 (other assets)
```

Inline scripts and styles are allowed because single-file tools depend on them. External scripts, styles, fonts, images, and fetch destinations are blocked unless the operator lists them. `'unsafe-eval'` is not included; an operator can add it to `KITLANE_HOSTED_SCRIPT_SRC` for a specific need. The portal's own policy is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src <tool origins>; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`.

## Iframe policy

The shell frames the tool with `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"`, `allow="clipboard-write; fullscreen"`, and `referrerpolicy="strict-origin-when-cross-origin"`. Because the frame is cross-origin, `allow-same-origin` only restores the tool's own origin identity (its cookies and storage); it grants nothing on the portal. Security does not depend solely on the sandbox, because the direct-origin path exists and carries the same server-side headers and checks.

## Cookies, CSRF, and origin checks

- All session cookies are host-only, `HttpOnly`, and `Secure` over HTTPS with the `__Host-` prefix. No cookie carries a `Domain` attribute, so a hosted origin cannot set a cookie the portal would read.
- Portal form posts and browser JSON mutations require the `Origin` header (or `Sec-Fetch-Site: same-origin`, or a same-origin `Referer`) to match the portal origin. Tool-origin mutations require it to match the tool origin and the body to be `application/json`.
- CLI and updater routes carry no ambient cookie and are exempt from origin checks.
- One-time sign-in codes expire after 60 seconds, are consumed once, are bound to a tool ID, and are HMAC-signed. Return destinations are limited to the portal origin or the tool's own origin.

## Upload validation

Archives are streamed, never buffered whole. Rejected: more than `KITLANE_MAX_FILES` files, any file over `KITLANE_MAX_FILE_BYTES`, totals over `KITLANE_MAX_UPLOAD_BYTES`, decompressed output beyond the limit, entries that are not regular files (symlinks, hard links, devices), absolute paths, `..` segments, backslashes, control characters, paths deeper than 32 segments or longer than 512 characters, top-level `._kitlane`, `_releases`, `.auth`, `.dev`, `.kitlane`, `.well-known`, any `.git`/`.svn`/`.hg` segment, `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.netrc`, duplicate paths differing only by case, and files without an allowed extension. `index.html` must exist at the root. A rejected upload leaves no version and no files.

## Rate limits and quotas

Per user per tool: `KITLANE_REQUESTS_PER_MINUTE` (default 600) on SDK data routes; per updater credential the same limit. Documents up to `KITLANE_MAX_DOC_BYTES` (256 KB), bulk operations up to `KITLANE_MAX_BULK_DOCS` (500), `KITLANE_MAX_DOCS_PER_COLLECTION` (20000), `KITLANE_PERSONAL_QUOTA_BYTES` (20 MB per user per tool), `KITLANE_SHARED_QUOTA_BYTES` (200 MB per collection). Oversized operations are rejected before any change is made.

## Audit

Audited: entry creation, metadata changes, lifecycle, feature flag, freeze and unfreeze, maintainer changes, ownership transfer and recovery, name claims, releases, reassignments, reservations, version publish, rollback, content removal, copies (on both entries), collection creation, bindings, grants and revocations, ownership transfer, description changes, collection freeze, updater credential creation and revocation, token creation and revocation, administrator grants, and shared-document writes by document ID and revision. Not audited: personal-document writes (by design, to avoid recording individuals' activity) and reads. Audit details never contain document contents, personal data, or credentials.

## What is not claimed

- No end-to-end encryption against the installation operator. Database and infrastructure operators can read personal and shared documents and must protect backups accordingly.
- Hosted JavaScript is executable, employee-authored content. It can act on inputs people give it and, within the Content-Security-Policy, could attempt to exfiltrate data through allowed destinations. The policy is a mitigation, not a guarantee.
- A freeze cannot retract content already delivered to a browser or already cached by it.
- Freezing an external entry blocks platform launches and recommendations only; the external host must separately revoke access.
- The Compose local profile was executed once and its gateway configuration verified with curl (identity headers only accepted with the ingress secret; forged headers ignored; API routes answer 401). The team profile has not been executed.
- Discovery analytics use pseudonymous identifiers, which are still potentially personal data under some policies.

## Reporting and response

Operators set `KITLANE_REPORTING_CONTACT` (shown in the portal footer). Administrators can freeze a tool or a collection immediately from its detail page, remove a version's content while preserving the audit record, and recover ownership. These controls exist from the first deployment, not as a later retrofit.

## Public installations and the publishing allowlist

By default every authenticated member may publish, because inside one organization authors are identified and accountable. On an installation that admits strangers (a public demo with Google sign-in, for example) that accountability is gone, so `KITLANE_PUBLISHERS` limits creating entries, uploading versions, copying, and claiming names to listed accounts and administrators. The check runs server-side on every publishing route, including for co-maintainers who are not listed. Browsing, launching, the drawer, personal storage, and shared-collection reads stay open to everyone who can sign in. `KITLANE_BANNER` labels the installation, and `scripts/reset-demo.sh` deletes everything on a schedule. See `docs/install-public-demo.md`.
