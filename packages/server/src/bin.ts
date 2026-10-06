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
  if (command && command !== "serve") throw new Error(`unknown command: ${command}. Use serve, migrate, revoke-updaters, grant-admin`);
  if (config.authMode === "dev") await ensureDevUsers(db, config);
  const services = createServices(config, db, new LocalArtifactStorage(config.dataDir));
  const app = createApp(services);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`[kitlane] listening on http://${info.address}:${info.port}`);
    console.log(`[kitlane] portal: ${portalOrigin(config)}  tools: ${config.portalUrl.protocol}//app-<id>.${config.toolsDomain}  auth: ${config.authMode}`);
    if (config.authMode === "dev") console.log(`[kitlane] development identity enabled (local only). Open ${portalOrigin(config)}/.dev/login`);
  });
  const timer = setInterval(() => pruneSessions(db).catch(() => undefined), 10 * 60_000);
  timer.unref();
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
