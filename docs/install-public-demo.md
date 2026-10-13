# Install: a public demonstration with Google sign-in

This guide sets up an installation that anyone with a Google account can sign in to, browse, and use, while publishing stays limited to accounts you invite. It builds on [Install: run for a team](install-run-for-a-team.md) and adds the demo-specific policy. Read [Security baseline](security-baseline.md) first: hosted tools are JavaScript that runs in visitors' browsers, and the publishing allowlist is what keeps strangers from running code on your visitors.

**Status.** This guide was followed on 2026-10-13 to deploy the author's public demonstration (Hetzner CX23, Nuremberg, Google sign-in). Everything below was executed; the two defects it surfaced (a gitignored seed file and the consent prompt setting) are fixed in the repository.

## What you get

- `https://kit.<your-domain>`: the portal, Google sign-in for any account.
- `https://app-<id>.sites.kit.<your-domain>`: one origin per hosted tool.
- Everyone who signs in can search, launch, open the drawer, and use the sample tools, including personal storage.
- Only accounts listed in `KITLANE_PUBLISHERS` (and administrators) can publish, upload versions, copy, or claim names.
- A banner on every page says it is a demo, and a scheduled reset deletes everything and reloads the synthetic seed.

## 1. Domain and server

1. Register a domain. Kitlane does not need the apex; `kit.<domain>` and `*.sites.kit.<domain>` are enough.
2. Create a small Linux VM (2 vCPU, 2 to 4 GB RAM, 20 GB disk is plenty) with Docker Engine and the Compose plugin installed, and ports 80 and 443 open.
3. DNS: an `A` record for `kit.<domain>` and an `A` record for `*.sites.kit.<domain>`, both pointing at the VM. Wait until both resolve from outside before starting the stack, because Caddy requests certificates on first use.

## 2. Google OAuth client

In the Google Cloud console (any project you own):

1. **APIs & Services → OAuth consent screen.** User type **External**. App name "Kitlane demo" (or your choice), user support email, and developer contact email. Under authorized domains add your domain (for example `kitlane.dev`). Add the application home page and **privacy policy** link; Google requires a privacy policy for external apps in production. The repository ships a starting point at `site/privacy.html`, which you must review, fill in the contact address, and host (for example on a static host at your apex domain).
2. **Scopes.** Add only `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`. These are non-sensitive scopes; the verification review that sensitive and restricted scopes require does not apply. Google may still ask for brand verification if you add a logo.
3. **Publishing status.** Publish the app to **Production**. In Testing mode only listed test users could sign in, which defeats word-of-mouth exploration.
4. **Credentials → Create credentials → OAuth client ID.** Type **Web application**. Authorized redirect URI: `https://kit.<domain>/oauth2/callback`. Copy the client ID and client secret.

## 3. Configuration

On the VM, clone the repository, then in `deploy/compose`:

```sh
./scripts/setup.sh                 # creates .env with generated secrets
```

Edit `.env`:

```ini
KITLANE_DOMAIN=kit.example.com
CADDYFILE=Caddyfile.team
ACME_EMAIL=you@example.com

OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=<client id>.apps.googleusercontent.com
OIDC_CLIENT_SECRET=<client secret>
OIDC_DISPLAY_NAME="Google"
OIDC_EMAIL_DOMAINS=*
OIDC_SCOPE="openid email profile"
OIDC_USER_ID_CLAIM=email
OIDC_EMAIL_CLAIM=email
# Google Workspace accounts carry an "hd" (hosted domain) claim; consumer accounts do not.
# Using it as the team keeps team attribution honest: unknown for personal accounts.
OIDC_TEAM_CLAIM=hd

KITLANE_ADMIN_USERS=you@example.com
KITLANE_PUBLISHERS=you@example.com,friend@example.com
KITLANE_BANNER="Public demo: synthetic data, reset nightly. Do not enter real information."
KITLANE_REPORTING_CONTACT=you@example.com
KITLANE_EXPOSE_EMAIL=false
```

Start it:

```sh
docker compose -f docker-compose.yml -f compose.team.yml up -d --build
docker compose -f docker-compose.yml -f compose.team.yml run --rm kitlane doctor
docker compose -f docker-compose.yml -f compose.team.yml run --rm kitlane seed
```

Then open `https://kit.<domain>`, sign in with the Google account listed in `KITLANE_ADMIN_USERS`, and check `/.admin`. The seed's synthetic owners (`alice@example.test` and friends) are not Google accounts, so the sample tools stay owned by synthetic users; as an administrator you can recover ownership of any tool to your own account from its detail page if you want to maintain it.

## 4. Scheduled reset

`scripts/reset-demo.sh` drops the database and deployed files and reloads the seed. It refuses to run unless `KITLANE_PUBLISHERS` is set, as a guard against running it on a team installation. Schedule it on the host:

```cron
0 4 * * * cd /srv/kitlane/deploy/compose && ./scripts/reset-demo.sh >> /var/log/kitlane-reset.log 2>&1
```

Say so in the banner and in the privacy notice. Visitors' Google identities, personal notes, and usage events are deleted by every reset.

## 5. Operating it

- **Reports.** `KITLANE_REPORTING_CONTACT` appears in the portal footer and in the "publishing is limited" page. Check that mailbox.
- **Freeze.** An administrator can freeze any tool or collection from its detail page; freezing blocks fresh asset and SDK access immediately.
- **Inviting a publisher.** Add their email to `KITLANE_PUBLISHERS` and restart the `kitlane` service (`docker compose ... up -d kitlane`). They must have signed in once with that email. Remember that a publisher can run JavaScript in every visitor's browser on their tool's origin; invite people you would trust with that in a workplace.
- **Measurement.** `/.admin/measurement` works as on any installation. Team attribution is the Workspace domain when present and unknown otherwise; report it that way.
- **Costs.** One small VM and the domain. Google sign-in is free at this scale.

## What this is not

A public demo is not a managed service for other organizations. Shared collections are readable by every signed-in visitor by design, so one demo cannot host two unrelated groups' data. The supported model for other organizations is one installation each, run by them, with their own sign-in and data.

## Running a study on the demo

- Pause the nightly reset for the whole study window (move or comment the cron entry), and change `KITLANE_BANNER` to say the data is reset after the study. The seven-day return measure cannot survive a reset.
- Assign study teams to participants from `/.admin` before the first session, so discovery snapshots carry them.
- Give participants a tool with a reason to return: replace the synthetic briefs with content your participants actually consult, and republish `prep` with it.
- Report the result as a usability study with assigned teams, per spec section 11.1.
