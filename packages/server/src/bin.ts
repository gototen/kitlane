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

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = await openDatabase(config.databaseUrl);
  const ran = await migrate(db);
  if (ran.length) console.log(`[kitlane] applied migrations: ${ran.join(", ")}`);
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
