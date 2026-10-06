#!/usr/bin/env node
/**
 * Refreshes the shared company-briefs collection from ../data/briefs.json using a scoped
 * Kitlane updater credential. No dependencies; Node 22 or newer (global fetch).
 *
 * Environment:
 *   KITLANE_URL            portal origin, e.g. https://kit.example.com
 *   KITLANE_UPDATER_TOKEN  updater credential (klu_...), never commit this
 *   KITLANE_COLLECTION_ID  stable collection id
 *
 * Flags: --dry-run  --replace-all  --batch <n>
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dryRun = flag("--dry-run");
const replaceAll = flag("--replace-all");
const batchSize = Math.max(1, Math.min(100, Number(option("--batch", "100")) || 100));

const url = process.env.KITLANE_URL;
const token = process.env.KITLANE_UPDATER_TOKEN;
const collectionId = process.env.KITLANE_COLLECTION_ID;

function die(message, code = 1) {
  console.error(`refresh-briefs: ${message}`);
  process.exit(code);
}

if (!url) die("KITLANE_URL is not set");
if (!token) die("KITLANE_UPDATER_TOKEN is not set");
if (!collectionId) die("KITLANE_COLLECTION_ID is not set");
if (!/^https?:\/\//.test(url)) die("KITLANE_URL must start with http:// or https://");

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(here, "../data/briefs.json");
const briefs = JSON.parse(await readFile(dataFile, "utf8"));
if (!Array.isArray(briefs)) die(`${dataFile} must contain a JSON array`);

const now = new Date();
const stamp = now.toISOString();
const ops = briefs.map((brief) => {
  const news = Array.isArray(brief.recentNews) ? brief.recentNews : [];
  const data = {
    ...brief,
    updatedAt: stamp,
    recentNews: [`Refreshed by updater at ${now.toUTCString()}`, ...news].slice(0, 5),
  };
  return { op: "set", id: brief.id, data };
});

const endpoint = `${url.replace(/\/$/, "")}/.api/updater/collections/${encodeURIComponent(collectionId)}/documents/_bulk`;

if (dryRun) {
  console.log(`dry run: would send ${ops.length} documents to ${endpoint} in batches of ${batchSize}${replaceAll ? " (replaceAll)" : ""}`);
  for (const op of ops) console.log(`  set ${op.id}  ${op.data.name}`);
  process.exit(0);
}

if (replaceAll && ops.length > batchSize) {
  die(`--replace-all must fit in one batch (${ops.length} documents, batch size ${batchSize}); raise --batch up to 100 or drop --replace-all`);
}

function explain(status, body) {
  const detail = body && body.message ? ` (${body.message})` : "";
  switch (status) {
    case 401:
      return `credential rejected${detail}: the updater credential is invalid, expired, or has been revoked. Issue a new one from the collection page and update KITLANE_UPDATER_TOKEN.`;
    case 403:
      return `out of scope${detail}: this credential is not scoped to collection ${collectionId} or lacks an operation it needs (bulk; delete when using --replace-all).`;
    case 423:
      return `collection frozen${detail}: an administrator froze this collection; reads and writes are blocked until it is unfrozen.`;
    case 413:
      return `payload too large${detail}: reduce --batch or the size of individual documents.`;
    default:
      return `request failed with status ${status}${detail}`;
  }
}

let applied = 0;
let revision = null;
for (let i = 0; i < ops.length; i += batchSize) {
  const batch = ops.slice(i, i + batchSize);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ops: batch, replaceAll: replaceAll && i === 0 }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) die(explain(res.status, body), res.status === 401 ? 2 : res.status === 403 ? 3 : res.status === 423 ? 4 : 1);
  applied += body && typeof body.applied === "number" ? body.applied : batch.length;
  if (body && typeof body.collectionRevision === "number") revision = body.collectionRevision;
}

console.log(`refreshed ${applied} documents in collection ${collectionId}${revision !== null ? ` (collection revision ${revision})` : ""}${replaceAll ? ", replaced all" : ""}`);
