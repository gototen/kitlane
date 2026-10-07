# Install: try locally

Two reproducible local experiences come from the same repository. Both use synthetic users and synthetic data only.

| Path | Identity | TLS | Needs |
|---|---|---|---|
| A. Development mode | Visibly labelled development identity (local only) | Plain HTTP on `kit.localhost:3000` | Node 22+ |
| B. Compose with Keycloak | Real OIDC sign-in through oauth2-proxy | HTTPS from Caddy's local certificate authority | Docker with Compose v2 |

**Status of path B.** The Compose package was run on 2026-10-07 on macOS with Docker 20.10 / Compose v2.0: all five containers start, Keycloak imports the realm, and the full sign-in path (Keycloak login through oauth2-proxy, portal session, CLI publish over HTTPS, per-origin tool session, hosted document served) was verified with curl using the local CA. Not yet verified: the same flow in a browser with the trusted CA, the team profile (ACME and on-demand TLS), and the backup and restore scripts. Running it surfaced and fixed three issues (an unwritable Keycloak volume, missing built-in client scopes, and the email header mapping), so expect that other environments may surface more; please report them.

## A. Development mode (no Docker)

```sh
npm install
npm run build        # builds the SDK, server, CLI, and the minified example tool
npm run seed         # synthetic users, four hosted tools, two links, one shared collection
npm run dev          # serves http://kit.localhost:3000
```

If `npm install` says an install script for `esbuild` was blocked, run `npm approve-scripts --allow-scripts-pending` (or `npm rebuild esbuild`) and build again.

Open <http://kit.localhost:3000/.dev/login>. The page is labelled as development identity and lists the synthetic users:

| User | Team | Role in the demo |
|---|---|---|
| Alice Nakamura | finance | Administrator; owns `kit/prep` and the `company-briefs` collection |
| Bob Okafor | marketing | Owns `kit/focus`; the "marketing employee who uses a friend's tool" |
| Carol Lindqvist | research | Owns `kit/briefs-editor`; granted as a writer on `company-briefs` |
| Dave Patel | engineering | Owns `kit/meet` (minified Preact bundle) |

The seed script publishes `kit/prep`, `kit/briefs-editor`, `kit/focus`, `kit/meet`, registers the links `kit/teamdocs` (resource) and `kit/statuspage` (external tool), creates the `company-briefs` collection with 12 fictional companies, grants the editor tool as a writer context and Carol as a writer, and writes an updater credential to `packages/server/data/updater.env`. Running it again is a no-op when `kit/prep` already exists.

### Seeing the loop

1. Sign in as **Bob**. Open <http://kit.localhost:3000/prep>. The first launch performs one sign-in round trip to the tool's own origin and returns to the shell. Pick a company; the brief renders and the tab title updates.
2. Click the **Explore tools** handle on the right. The drawer shows "This tool" (creator, maintainer, lifecycle, Details, Make a copy, Open directly) and cards such as `kit/meet` ("Also about meetings") from other creators. Press Escape to close it; focus returns to the handle.
3. Launch `kit/meet` from a card. That is a recorded discovery. Save a favourite set of cities; it is stored in personal storage for Bob and this tool only.
4. Open `kit/prep` again and type a note for a company. Sign out (Switch user), sign in as **Alice**, open the same company: Alice does not see Bob's note. Personal data is isolated by user.
5. Sign in as **Bob** and open `kit/briefs-editor`. It shows the missing-capability message: the editor tool is an allowed writer context, but Bob is not a granted writer. Sign in as **Carol** (granted writer) or **Alice** (collection owner): either can edit, and `kit/prep` readers see the change on their next fetch. A writer needs both a user grant and an allowed tool context; the seed grants the editor tool and Carol.
6. Run the out-of-band updater:

   ```sh
   set -a; . packages/server/data/updater.env; set +a
   node examples/updater/refresh-briefs.mjs
   ```

   Return to `kit/prep`; within a minute, or on refocus, the briefs show the refreshed news line.
7. On `kit/meet`'s detail page, choose **Make a copy**, give it a name, then `npx kitlane pull <copy-name> ./meet-copy` and change something using only the three downloaded files. Republish with `npx kitlane publish ./meet-copy --name <copy-name>`. See [adaptation.md](adaptation.md).
8. As Alice (administrator), open a tool's detail page and **Freeze** it. Its short link, direct origin, assets, and SDK routes stop serving. **Unfreeze** restores them. The admin page also has the measurement report.

### CLI against the local server

Create a token at <http://kit.localhost:3000/.me#tokens>, then:

```sh
npx kitlane login http://kit.localhost:3000 --token klp_...
npx kitlane whoami
npx kitlane tool prep
npx kitlane publish examples/focus/index.html --name focus-mine --title "My focus timer"
```

### Where things live

- Database: `packages/server/data/db` (PGlite). Delete the folder for a clean start.
- Releases: `packages/server/data/releases/<entryId>/<versionId>/`.
- Development secret: `packages/server/data/secret.key`.
- Server log: standard output of `npm run dev`.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `kit.localhost` does not resolve | Chrome, Firefox, Safari 16+, and curl 7.78+ resolve `*.localhost` to loopback. Older tools may not; add `127.0.0.1 kit.localhost app-<id>.sites.kit.localhost` entries to `/etc/hosts` or use a newer client. |
| The shell shows "Sign in to open this tool" | The automatic round trip was attempted twice without a tool session. Check that cookies are allowed for `kit.localhost` and its subdomains, and that no extension blocks third-party cookies for same-site frames. Click the button to retry. |
| Port 3000 is in use | Set `KITLANE_PORTAL_URL=http://kit.localhost:3100` (the port is taken from the URL) and `KITLANE_TOOLS_DOMAIN=sites.kit.localhost:3100`. |
| `PGlite` lock or "database is in use" | Only one process can open the PGlite directory. Stop the other server (or the seed) first. |
| `Example not found ... Run npm run build first` from the seed | The minified example is built by `npm run build`; run it before `npm run seed`. |
| Styles look stale after pulling changes | Static files are cached for five minutes; hard-reload. |

## B. Docker Compose with Keycloak (real sign-in)

This path exercises the supported gateway with HTTPS and separate portal and tool origins: `https://kit.localhost` (portal), `https://*.sites.kit.localhost` (tool origins), and `https://auth.kit.localhost` (Keycloak).

```sh
cd deploy/compose
./scripts/setup.sh                      # copies .env.example to .env and generates secrets
docker compose -f docker-compose.yml -f compose.local.yml up -d --build
./scripts/trust-local-ca.sh             # exports Caddy's local root certificate and prints how to trust it
docker compose -f docker-compose.yml -f compose.local.yml run --rm kitlane seed   # demo tools and data (optional)
```

Trust the certificate once:

- macOS: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-local-root.crt`
- Linux (Debian/Ubuntu): copy it to `/usr/local/share/ca-certificates/` and run `update-ca-certificates`; Chrome on Linux additionally needs it under `chrome://settings/certificates`.
- Firefox: Settings, Privacy and Security, Certificates, View Certificates, Authorities, Import.

Remove it when you are done with the demo.

Open <https://kit.localhost>. oauth2-proxy redirects to Keycloak. Synthetic users: `alice`, `bob`, `carol`, `dave`, all with password `password`. `alice@example.test` is listed in `KITLANE_ADMIN_USERS` and becomes an administrator on first sign-in. The Keycloak admin console is at <https://auth.kit.localhost/admin> (`admin` / `admin` unless changed in `.env`).

The containers have no seed data. Publish the examples with the CLI after creating a token at <https://kit.localhost/.me#tokens>:

```sh
npx kitlane login https://kit.localhost --token klp_...
npx kitlane publish examples/prep --name prep
npx kitlane publish examples/briefs-editor --name briefs-editor
npx kitlane publish examples/focus --name focus
npm run build -w examples/tz-minified && npx kitlane publish examples/tz-minified/dist --name meet
```

The optional `seed` step publishes the same demonstration tools as the npm path. Their synthetic owners are adopted by the first real sign-in with a matching email address, so signing in to Keycloak as `alice` makes you the owner of `kit/prep`.

Then create the `company-briefs` collection from `kit/prep`'s detail page, bind it in `kit/briefs-editor`, grant the editor as a writer context, create an updater credential, and run `examples/updater/refresh-briefs.mjs` with it.

### How the pieces fit

- Caddy terminates TLS for the three hostnames with its internal CA and forwards the portal to oauth2-proxy and tool origins straight to Kitlane, adding `X-Kitlane-Ingress-Secret`.
- oauth2-proxy (OIDC, host-only `__Host-kitlane_gateway` cookie) authenticates the portal and forwards `X-Forwarded-User` (subject), `X-Forwarded-Email`, `X-Forwarded-Preferred-Username`, and `X-Forwarded-Groups` (the `team` claim). It skips `/.api/cli/`, `/.api/updater/`, `/healthz`, `/.well-known/`, and `/.static/`.
- oauth2-proxy uses the public login URL for the browser and the container-internal token and JWKS URLs, so no TLS trust is needed inside the network.
- Keycloak imports the `kitlane` realm with the users, a confidential client `kitlane-portal`, and a mapper that puts the `team` user attribute into a `team` claim.
- Kitlane runs with `KITLANE_AUTH_MODE=gateway`. There is no development identity in this profile.

### Verification checklist for the first installer

Please record the outcome of each item and open an issue with the exact failure text if one does not hold:

1. `docker compose ... up` starts all five containers and `https://kit.localhost/healthz` returns `{"ok":true,"authMode":"gateway"}` after trusting the CA.
2. Visiting `https://kit.localhost` redirects to Keycloak and back; the portal shows your display name.
3. Opening `kit/prep` performs the tool-origin sign-in round trip once and renders the tool; a second launch does not repeat it.
4. `Open directly` on a tool detail page works at `https://app-<id>.sites.kit.localhost/` and preserves authentication.
5. A second user cannot read the first user's notes in `kit/prep`.
6. Freezing a tool blocks the direct origin and the short link.
7. `scripts/backup.sh` produces a backup and `scripts/restore.sh` restores it on a fresh set of volumes, after which updater credentials are revoked.

Known unknowns in this profile: oauth2-proxy's handling of a single-string `team` claim as groups, Keycloak 26 start flags, and whether the author's old Docker Compose (v2.0.0) honours everything in these files. Compose v2.20 or newer and Docker 24 or newer are recommended.
