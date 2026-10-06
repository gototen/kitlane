# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers through the repository's private vulnerability reporting feature, or by opening an issue that contains no exploit details and asks for a private channel. Include the version or commit, the component (server, SDK, CLI, Compose package), and reproduction steps.

There is no bug bounty. Reports are acknowledged as soon as practical and fixed on a best-effort basis by the maintainers of this reference implementation.

## Scope

In scope:

- The control service (`packages/server`): authentication and session handling, authorization on entries and collections, personal-data isolation, upload validation, hosted-content headers, freeze behaviour, export contents.
- The browser SDK (`packages/sdk`) and the shell client.
- The CLI (`packages/cli`), including `pull` extraction safety.
- The Compose reference configuration (`deploy/compose`).

Out of scope:

- Vulnerabilities in tools that people publish on an installation. Report those to that installation's operator through the reporting contact shown in its portal footer (`KITLANE_REPORTING_CONTACT`). Administrators can freeze a tool immediately.
- Third-party components (Postgres, oauth2-proxy, Caddy, Keycloak); report those upstream.

## What this project does not claim

See [docs/security-baseline.md](docs/security-baseline.md). In short: no end-to-end encryption against the installation operator; hosted JavaScript is untrusted code that can act on what people type into it; a freeze cannot retract content already delivered to a browser; the Compose package has not yet been executed by the authors.

## Supported versions

Only the latest tagged release and the `main` branch receive fixes.
