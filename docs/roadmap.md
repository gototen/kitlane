# Roadmap

What is deferred from v0.2 and what the build surfaced. None of these are promises; they are the recorded backlog in rough priority order within each theme.

## Validation of what exists (highest priority)

- Execute the Docker Compose package (local profile with Keycloak, then team profile) and fix what breaks. It has not yet been run by the authors.
- Independent installation validation: someone outside the project installs the supported configuration from the documentation, publishes, discovers, copies, adapts, verifies personal and shared boundaries, and restores a backup. Record required permissions, failures, and any author assistance.
- Two-builder adaptation verification, including from the minified `kit/meet` bundle (procedure in `docs/adaptation.md`).
- Pilot study with uncoached sessions and seven-day follow-up (`docs/measurement.md`). Label simulated team identities as a usability study.
- Measure capacity on one server and document limits.
- Rail handle placement and size testing; first-screen mix of related-purpose, familiar-creator, and new-tool cards.

## Engineering backlog discovered during the build

- Discovery event retention is time-based only (`KITLANE_DISCOVERY_RETENTION_DAYS`). Add aggregated snapshots so raw events can be pruned sooner without losing the north-star history.
- Object-storage implementation of `ArtifactStorage` for installations that do not want a local volume.
- Existing name-service adapter so `go/prep` can be registered automatically (a manual redirect works today).
- Shell: keyboard shortcut for the drawer (supplementary), narrow-screen testing, reduced-motion review, screen-reader pass with a real assistive-technology user.
- Portal: creator filter is a search filter; richer people and team pages are deferred.
- Portal: live search suggestions using `/.api/search`.
- Server: request logging with a correlation ID (currently only startup and unhandled errors are logged).
- Server: optional external static server in front of the release volume, keyed by publication revision.
- Server: validate `X-Forwarded-Proto` handling behind the ingress and document HSTS.
- CLI: `kitlane login` device-style flow instead of paste; `kitlane status` for the configured portal.
- SDK: TypeScript types published to npm as `@kitlane/sdk`; the bundle is currently served from the server only.
- Compose: health-condition `depends_on` once the minimum Compose version is raised; retention and log rotation guidance.

## Deferred by the specification (section 5)

Capabilities
- Optional AI gateway (`docs/deferred/ai-adapter.md`).
- Restricted team or group collections (today a shared collection is readable by the whole installation).
- Arbitrary database queries and aggregations; a schema designer; automatic index management.
- Live subscriptions and offline synchronization.
- Binary file uploads and an object-storage capability for large user files.
- MCP server, after the CLI and guidance are proven.

Publishing surfaces
- Drag-and-drop and paste-to-publish interfaces (same publishing contract).
- Redirect templates (parameterized redirects), Unicode aliases, underscore aliases.

Integration
- Multiple identity, model, and storage adapters.
- External rail component for apps whose maintainers can integrate it.
- Arbitrary reverse-proxy wrapping of external applications; a browser extension.

Catalog
- Extensive people and team pages; advanced rankings; imported-code graphs; most-duplicated leaderboards.

Operations and business
- Shared multi-organization tenancy; managed-service provisioning and billing. Each installation serves one organization or trusted team; a commercial host operates one installation per customer.

## Outside the product boundary

A code editor or app builder; user server code or scheduled jobs; a company-wide data permission system; public anonymous production hosting; arbitrary external-app proxying; guaranteed long-term operation of tools that have lost their maintainer.
