# Kitlane

An internal front door for the software people make.

Give an employee-made tool a memorable address, and let using that tool reveal what else colleagues have made. Kitlane publishes static tools (or registers existing URLs) under short names such as `kit/prep`, launches hosted tools inside a shell with a persistent **Explore tools** rail, and lets anyone make a copy of a published tool and adapt it with whatever builder they prefer. Hosted tools get identity, durable per-user storage, and company-readable shared collections through a small browser SDK.

The rail is the primary discovery mechanism. A portal with search and browsing exists for deeper exploration, but success does not depend on people remembering to visit a directory. Builder neutrality is central: a tool can come from an agent, a visual builder, or ordinary development, and AI use is never an eligibility requirement.

**Status: early reference implementation, v0.2 in progress.** This repository implements Kitlane v0.2; the architecture and scope are described in [docs/architecture.md](docs/architecture.md) and [docs/roadmap.md](docs/roadmap.md). It is suitable for a local demonstration and for a cautious team pilot by an operator who reads the installation and security documents first. It is not yet a validated enterprise deployment. See [RELEASE-NOTES.md](RELEASE-NOTES.md) for exactly what is implemented, verified, untested, and deferred.

## What is implemented

| Area | State |
|---|---|
| URL registration, stable IDs, memorable names with history, reserved names | Implemented, tested |
| CLI publishing of a single HTML file or a folder; immutable versions; rollback | Implemented, tested |
| Owner, co-maintainer, and administrator authorization; freeze; content removal with audit | Implemented, tested |
| Shell with the Explore tools rail and drawer; explainable recommendations | Implemented, checked manually in Chrome |
| Portal: search, filters, recent tools, my tools, tool details, lineage, name history, admin | Implemented |
| Make a copy with lineage; download published files; `kitlane pull` | Implemented, tested |
| Identity SDK, personal documents, shared collections, writer grants, updater credentials | Implemented, tested |
| Discovery measurement with a north-star report | Implemented, tested |
| Catalog export; operator backup and restore scripts | Implemented; scripts untested |
| `kitlane init` with bounded agent guidance | Implemented, tested |
| Docker Compose package with oauth2-proxy, Caddy, Postgres, optional Keycloak | Written, **not yet run** |
| Optional AI gateway (`kitlane.ai.chat`) | Deferred; design in [docs/deferred/ai-adapter.md](docs/deferred/ai-adapter.md) |

## Quick start

### Try locally without Docker

Requires Node 22 or newer. Uses an embedded Postgres (PGlite) and a clearly labelled development identity.

```sh
npm install
npm run build
npm run seed
npm run dev
```

Open <http://kit.localhost:3000/.dev/login>, pick a synthetic user, then open `kit/prep` at <http://kit.localhost:3000/prep>. Chrome, Firefox, and curl resolve `*.localhost` to this machine without configuration. Details and troubleshooting: [docs/install-try-locally.md](docs/install-try-locally.md).

### Try locally with Docker Compose and a real sign-in

Adds Keycloak as a test identity provider behind oauth2-proxy, with HTTPS from a local certificate authority and separate portal and tool origins.

```sh
cd deploy/compose
./scripts/setup.sh
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
./scripts/trust-local-ca.sh
```

Then open <https://kit.localhost> and sign in as `alice` / `password`. This path was written against the documented behaviour of each component but has not yet been executed by the authors; see the caveat in [docs/install-try-locally.md](docs/install-try-locally.md).

### Run for a team

One server, Docker, a domain with records for `kit.<domain>` and `*.sites.kit.<domain>`, and an OIDC client at your identity provider. Follow [docs/install-run-for-a-team.md](docs/install-run-for-a-team.md).

## Screenshots

The shell for `kit/prep` with the Explore tools handle on the right (development build, synthetic data):

![The prep tool inside the Kitlane shell with the Explore tools rail](docs/images/shell-prep-rail.jpg)

The drawer open: "This tool", then recommendation cards with the reason each one appears:

![The Explore tools drawer showing recommendations from other creators](docs/images/shell-prep-drawer.jpg)

## Repository layout

```
packages/server          Control service: catalog, names, publishing, shell, SDK routes, document storage
packages/sdk             Browser SDK served on every tool origin at /._kitlane/sdk.js
packages/cli             The `kitlane` command-line tool
examples/                Seed tools and synthetic data (prep, briefs-editor, focus, meet, updater)
deploy/compose           Docker Compose reference installation (local demo and team profiles)
docs/                    Architecture, installation, security, SDK, CLI, measurement, roadmap
Dockerfile               Image for the control service
```

## Documentation

- [Architecture](docs/architecture.md)
- [Install: try locally](docs/install-try-locally.md)
- [Install: run for a team](docs/install-run-for-a-team.md)
- [Security baseline](docs/security-baseline.md)
- [Backup and restore](docs/backup-restore.md)
- [Hosting constraints for tool authors](docs/hosting-constraints.md)
- [SDK reference](docs/sdk.md)
- [CLI reference](docs/cli.md)
- [Adaptation: copy, pull, publish](docs/adaptation.md)
- [Discovery measurement](docs/measurement.md)
- [Deferred: AI adapter design](docs/deferred/ai-adapter.md)
- [Roadmap](docs/roadmap.md)
- [Release notes](RELEASE-NOTES.md), [Security policy](SECURITY.md), [Contributing](CONTRIBUTING.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The platform license does not license an installation's hosted tools or data, and it grants no trademark rights.
