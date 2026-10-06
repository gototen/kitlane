#!/usr/bin/env node
import { serve } from "@hono/node-server";
import fs from "node:fs";
import { createApp } from "./app.js";
import { loadConfig, portalOrigin } from "./config.js";
import { createServices } from "./context.js";
import { openDatabase } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { LocalArtifactStorage } from "./services/storage.js";
import { pruneSessions } from "./auth/sessions.js";
import { pruneDiscoveryEvents } from "./services/discovery.js";
import { ensureDevUsers } from "./seed.js";
import { revokeAllUpdaterCredentials } from "./services/documents.js";
import { findUserByHandle, setAdmin } from "./services/users.js";
import { systemActor } from "./types.js";

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = await openDatabase(config.databaseUrl);
  const ran = await migrate(db);
  if (ran.length) console.log(`[kitlane] applied migrations: ${ran.join(", ")}`);

  const [command, ...args] = process.argv.slice(2);
  if (command === "migrate") {
    console.log(`[kitlane] migrations up to date`);
    await db.close();
    return;
  }
  if (command === "revoke-updaters") {
    // Run after restoring a backup into a different installation: credentials must be reissued.
    const reason = args.join(" ") || "restore";
    const n = await revokeAllUpdaterCredentials(db, systemActor, reason);
    console.log(`[kitlane] revoked ${n} updater credential(s) (${reason})`);
    await db.close();
    return;
  }
  if (command === "grant-admin") {
    const handle = args[0];
    if (!handle) throw new Error("usage: kitlane-server grant-admin <user id, external id, or email>");
    const user = await findUserByHandle(db, handle);
    if (!user) throw new Error(`no user matches ${handle} (they must sign in once first, or set KITLANE_ADMIN_USERS)`);
    await setAdmin(db, user.id, true);
    console.log(`[kitlane] ${user.display_name} (${user.id}) is now an administrator`);
    await db.close();
    return;
  }
  if (command === "doctor") {
    // Setup checks for operators: configuration summary plus a few fail-fast probes.
    const problems: string[] = [];
    const warn: string[] = [];
    console.log(`portal:          ${portalOrigin(config)}`);
    console.log(`tool origins:    ${config.portalUrl.protocol}//app-<id>.${config.toolsDomain}`);
    console.log(`auth mode:       ${config.authMode}`);
    console.log(`database:        ${config.databaseUrl.replace(/:\/\/[^@]*@/, "://***@")}`);
    console.log(`data dir:        ${config.dataDir}`);
    console.log(`installation:    ${config.installationId}`);
    console.log(`admins (config): ${config.adminUsers.size ? [...config.adminUsers].join(", ") : "(none; use grant-admin)"}`);
    if (config.authMode === "dev") warn.push("development identity is enabled; never expose this instance beyond your machine");
    if (config.portalUrl.protocol !== "https:" && config.authMode === "gateway") problems.push("gateway mode should run behind HTTPS (KITLANE_PORTAL_URL)");
    const toolsHost = config.toolsDomain.split(":")[0];
    const portalSite = config.portalUrl.hostname.split(".").slice(-2).join(".");
    if (config.toolCookieSameSite === "Lax" && !(toolsHost === portalSite || toolsHost.endsWith(`.${portalSite}`))) {
      warn.push("tool origins look cross-site to the portal; set KITLANE_TOOL_COOKIE_SAMESITE=None (requires HTTPS)");
    }
    try {
      fs.accessSync(config.dataDir, fs.constants.W_OK);
    } catch {
      problems.push(`data dir is not writable: ${config.dataDir}`);
    }
    const counts = await db.query<{ users: number; entries: number; versions: number }>(
      `SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM entries) AS entries, (SELECT count(*)::int FROM versions) AS versions`,
    );
    console.log(`database ok:     ${counts.rows[0].users} users, ${counts.rows[0].entries} entries, ${counts.rows[0].versions} versions`);
    const admins = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE is_admin`);
    if (admins.rows[0].n === 0 && config.adminUsers.size === 0) warn.push("no administrator exists yet; set KITLANE_ADMIN_USERS or run grant-admin after the first sign-in");
    const sdk = fs.existsSync(`${config.publicDir}/sdk.js`);
    if (!sdk) problems.push(`SDK bundle missing at ${config.publicDir}/sdk.js (run npm run build)`);
    for (const w of warn) console.log(`warning: ${w}`);
    for (const p of problems) console.log(`problem: ${p}`);
    console.log(problems.length ? `doctor: ${problems.length} problem(s)` : "doctor: ok");
    await db.close();
    process.exit(problems.length ? 1 : 0);
  }
  if (command && command !== "serve") throw new Error(`unknown command: ${command}. Use serve, migrate, doctor, revoke-updaters, grant-admin`);
  if (config.authMode === "dev") await ensureDevUsers(db, config);
  const services = createServices(config, db, new LocalArtifactStorage(config.dataDir));
  const app = createApp(services);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`[kitlane] listening on http://${info.address}:${info.port}`);
    console.log(`[kitlane] portal: ${portalOrigin(config)}  tools: ${config.portalUrl.protocol}//app-<id>.${config.toolsDomain}  auth: ${config.authMode}`);
    if (config.authMode === "dev") console.log(`[kitlane] development identity enabled (local only). Open ${portalOrigin(config)}/.dev/login`);
  });
  const housekeeping = async () => {
    await pruneSessions(db).catch(() => undefined);
    if (config.discoveryRetentionDays > 0) {
      await pruneDiscoveryEvents(db, config.discoveryRetentionDays).catch((err) => console.error("[kitlane] discovery retention failed", err));
    }
  };
  const timer = setInterval(() => void housekeeping(), 10 * 60_000);
  timer.unref();
  void housekeeping();
  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[kitlane] failed to start:", err);
  process.exit(1);
});
