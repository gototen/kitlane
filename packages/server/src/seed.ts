/**
 * Synthetic data for the local demonstration. Public/synthetic content only.
 * Run: npm run seed  (after the examples are built)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { loadConfig, portalOrigin } from "./config.js";
import type { Db } from "./db/index.js";
import { openDatabase } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { userActor } from "./types.js";
import * as entries from "./services/entries.js";
import * as docs from "./services/documents.js";
import * as versions from "./services/versions.js";
import { upsertUserFromIdentity } from "./services/users.js";
import { LocalArtifactStorage } from "./services/storage.js";
import { packForUpload } from "./services/pack.js";

export const DEV_USERS = [
  { externalId: "dev:alice", displayName: "Alice Nakamura", email: "alice@example.test", team: "finance", admin: true },
  { externalId: "dev:bob", displayName: "Bob Okafor", email: "bob@example.test", team: "marketing", admin: false },
  { externalId: "dev:carol", displayName: "Carol Lindqvist", email: "carol@example.test", team: "research", admin: false },
  { externalId: "dev:dave", displayName: "Dave Patel", email: "dave@example.test", team: "engineering", admin: false },
];

export async function ensureDevUsers(db: Db, config: Config) {
  const out = [] as Awaited<ReturnType<typeof upsertUserFromIdentity>>[];
  for (const u of DEV_USERS) {
    const user = await upsertUserFromIdentity(db, config, u, { devUser: true });
    if (u.admin && !user.is_admin) await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [user.id]);
    out.push(user);
  }
  return out;
}

export async function runSeed(db: Db, config: Config): Promise<void> {
  const storage = new LocalArtifactStorage(config.dataDir);
  const [alice, bob, carol, dave] = await ensureDevUsers(db, config);
  const aliceUser = (await db.query(`SELECT * FROM users WHERE id = $1`, [alice.id])).rows[0];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");

  const existing = await entries.getEntryByName(db, "prep");
  if (existing) {
    console.log("Seed data already present (kit/prep exists). Nothing to do.");
    return;
  }

  async function publish(user: any, name: string, title: string, purpose: string, tags: string[], dir: string, note: string) {
    const entry = await db.transaction((tx) => entries.createEntry(tx, userActor(user.id), user, { kind: "tool", mode: "hosted", name, title, purpose, tags }));
    const target = path.join(root, dir);
    if (!fs.existsSync(target)) throw new Error(`Example not found: ${target}. Run npm run build first.`);
    const body = await packForUpload(target);
    const r = await versions.publishUpload(db, storage, config, userActor(user.id), entry, body, { gzip: true, note });
    console.log(`published ${config.shortcut}/${name} v${r.version.number} (${r.version.file_count} files) → ${portalOrigin(config)}/${name}`);
    return (await entries.getEntry(db, entry.id))!;
  }

  // 1. prep: reads the shared company-briefs collection; personal notes per company.
  const prep = await publish(aliceUser, "prep", "Pre-call brief", "Turn public company facts into a one-page brief before a call.", ["meetings", "research", "sales"], "prep", "Initial seed release");
  await entries.setLifecycle(db, userActor(alice.id), prep, "maintained");
  const briefs = await db.transaction((tx) => docs.createCollection(tx, userActor(alice.id), config.installationId, prep, aliceUser, "company-briefs", "Public, synthetic company briefs refreshed by a separate updater process."));

  // Seed documents for the collection.
  const dataFile = path.join(root, "data", "briefs.json");
  const briefDocs = JSON.parse(fs.readFileSync(dataFile, "utf8")) as { id: string; [k: string]: unknown }[];
  await docs.bulkShared(db, briefs, briefDocs.map((d) => ({ op: "set" as const, id: d.id, data: d })), false, { type: "user", id: alice.id }, config.limits);
  console.log(`seeded collection company-briefs (${briefs.id}) with ${briefDocs.length} documents`);

  // 2. briefs-editor: a separate editing tool, granted writer context; Carol is a writer.
  const carolUser = (await db.query(`SELECT * FROM users WHERE id = $1`, [carol.id])).rows[0];
  const editor = await publish(carolUser, "briefs-editor", "Briefs editor", "Edit the shared company briefs that kit/prep reads.", ["research", "editing"], "briefs-editor", "Initial seed release");
  await docs.bindCollection(db, userActor(carol.id), editor, "company-briefs", briefs.id);
  await docs.addGrant(db, userActor(alice.id), briefs, "tool", editor.id);
  await docs.addGrant(db, userActor(alice.id), briefs, "user", carol.id);

  // 3. focus: personal state only.
  const bobUser = (await db.query(`SELECT * FROM users WHERE id = $1`, [bob.id])).rows[0];
  const focus = await publish(bobUser, "focus", "Focus timer", "A focus timer that remembers your preferences and logs sessions.", ["productivity", "wellbeing"], "focus", "Initial seed release");
  await entries.setLifecycle(db, userActor(bob.id), focus, "maintained");

  // 4. meet: minified Preact bundle, for adaptation testing.
  const daveUser = (await db.query(`SELECT * FROM users WHERE id = $1`, [dave.id])).rows[0];
  await publish(daveUser, "meet", "Meeting time finder", "Find a meeting time that works across time zones; saves your favourite cities.", ["meetings", "timezones", "productivity"], "tz-minified/dist", "Minified bundle (Preact + esbuild)");

  // 5. External entries.
  await db.transaction((tx) => entries.createEntry(tx, userActor(bob.id), bobUser, { kind: "resource", mode: "external", name: "teamdocs", title: "Team docs", purpose: "Where the marketing team keeps its working documents.", tags: ["docs"], externalUrl: "https://example.com/teamdocs" }));
  await db.transaction((tx) => entries.createEntry(tx, userActor(dave.id), daveUser, { kind: "tool", mode: "external", name: "statuspage", title: "Internal status page", purpose: "Live status of internal systems (external tool).", tags: ["engineering", "operations"], externalUrl: "https://example.com/status" }));

  // 6. An updater credential for the refresh script.
  const { token } = await docs.createUpdaterCredential(db, userActor(alice.id), { label: "briefs-refresh (seed)", collectionIds: [briefs.id], operations: ["read", "write", "bulk"], expiresAt: null });
  const envFile = path.join(config.dataDir, "updater.env");
  fs.writeFileSync(envFile, `KITLANE_URL=${portalOrigin(config)}\nKITLANE_UPDATER_TOKEN=${token}\nKITLANE_COLLECTION_ID=${briefs.id}\n`, { mode: 0o600 });
  console.log(`\nupdater credential written to ${envFile} (local demo only; never commit it)`);
  console.log(`try:  set -a; source ${envFile}; set +a; node examples/updater/refresh-briefs.mjs`);
  if (config.authMode === "dev") console.log(`\nOpen ${portalOrigin(config)}/.dev/login and pick a user.`);
  else console.log(`\nSign in at ${portalOrigin(config)}; a real account whose email matches a synthetic owner (alice@example.test, ...) adopts that owner's tools.`);
}

async function main() {
  const config = loadConfig();
  const db = await openDatabase(config.databaseUrl);
  await migrate(db);
  try {
    await runSeed(db, config);
  } finally {
    await db.close();
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
