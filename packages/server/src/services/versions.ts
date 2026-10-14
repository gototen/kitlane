import { Readable } from "node:stream";
import zlib from "node:zlib";
import tar from "tar-stream";
import type { Db, Queryable } from "../db/index.js";
import type { Config } from "../config.js";
import { KitlaneError, badRequest, notFound } from "../errors.js";
import { newId } from "../ids.js";
import type { Actor, Deployment, Entry, EntryWithNames, User, Version } from "../types.js";
import { audit } from "./audit.js";
import { createEntry, getEntry } from "./entries.js";
import type { ArtifactStorage } from "./storage.js";
import { extractUploadToStaging, manifestHash, sniffStagedTheme } from "./upload.js";
import { copyBindingsAsReadReferences } from "./documents.js";

export async function getDeployment(q: Queryable, entryId: string): Promise<Deployment | null> {
  const r = await q.query<Deployment>(`SELECT * FROM deployments WHERE entry_id = $1`, [entryId]);
  return r.rows[0] ?? null;
}

export async function getVersion(q: Queryable, versionId: string): Promise<Version | null> {
  const r = await q.query<Version>(`SELECT * FROM versions WHERE id = $1`, [versionId]);
  return r.rows[0] ?? null;
}

export async function getActiveVersion(q: Queryable, entryId: string): Promise<Version | null> {
  const r = await q.query<Version>(
    `SELECT v.* FROM deployments d JOIN versions v ON v.id = d.active_version_id WHERE d.entry_id = $1 AND NOT v.removed`,
    [entryId],
  );
  return r.rows[0] ?? null;
}

export async function listVersions(q: Queryable, entryId: string): Promise<(Version & { created_by_name: string | null })[]> {
  const r = await q.query<Version & { created_by_name: string | null }>(
    `SELECT v.*, u.display_name AS created_by_name FROM versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.entry_id = $1 ORDER BY v.number DESC`,
    [entryId],
  );
  return r.rows;
}

export interface DeploymentHistoryRow {
  id: number;
  entry_id: string;
  version_id: string | null;
  version_number: number | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  revision: number;
  at: Date;
}

export async function listDeploymentHistory(q: Queryable, entryId: string): Promise<DeploymentHistoryRow[]> {
  const r = await q.query<DeploymentHistoryRow>(
    `SELECT h.*, v.number AS version_number, u.display_name AS actor_name
     FROM deployment_history h LEFT JOIN versions v ON v.id = h.version_id LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.entry_id = $1 ORDER BY h.at DESC, h.id DESC`,
    [entryId],
  );
  return r.rows;
}

export interface PublishResult {
  version: Version;
  unchanged: boolean;
  activated: boolean;
}

/**
 * Stages and validates an upload, then commits the new immutable version and (optionally)
 * the active pointer plus audit record in one database transaction.
 */
export async function publishUpload(
  db: Db,
  storage: ArtifactStorage,
  config: Config,
  actor: Actor,
  entry: Entry,
  body: Readable,
  opts: { gzip: boolean; note?: string | null; activate?: boolean },
): Promise<PublishResult> {
  if (entry.mode !== "hosted") throw badRequest("Only hosted tools accept uploads");
  if (entry.frozen) throw new KitlaneError("frozen", "This tool is frozen; publishing is blocked");
  const staging = await storage.createStaging();
  let staged;
  try {
    staged = await extractUploadToStaging(body, staging, config.limits, config.hosted.allowedExtensions, { gzip: opts.gzip });
  } catch (err) {
    await storage.discardStaging(staging);
    throw err;
  }
  const hash = manifestHash(staged.files);
  const active = await getActiveVersion(db, entry.id);
  if (active && active.content_hash === hash) {
    await storage.discardStaging(staging);
    return { version: active, unchanged: true, activated: false };
  }
  // Sniff the theme while the files are still in staging; the shell uses it when nothing is declared.
  const detectedTheme = await sniffStagedTheme(staging, staged.entry);
  const versionId = newId(12);
  await storage.commitRelease(entry.id, versionId, staging);
  try {
    const version = await db.transaction(async (tx) => {
      const num = await tx.query<{ n: number }>(`SELECT COALESCE(max(number), 0)::int + 1 AS n FROM versions WHERE entry_id = $1`, [entry.id]);
      const r = await tx.query<Version>(
        `INSERT INTO versions (id, entry_id, number, created_by, file_count, total_bytes, content_hash, manifest, note, detected_theme)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING *`,
        [versionId, entry.id, num.rows[0].n, actor.id, staged.files.length, staged.totalBytes, hash, JSON.stringify({ files: staged.files, entry: staged.entry }), opts.note ?? null, detectedTheme],
      );
      const version = r.rows[0];
      if (opts.activate !== false) {
        await activateVersionInTx(tx, actor, entry.id, version.id, "publish");
      }
      await audit(tx, actor, {
        action: "version.published",
        entryId: entry.id,
        targetType: "version",
        targetId: version.id,
        details: { number: version.number, fileCount: version.file_count, totalBytes: Number(version.total_bytes), activated: opts.activate !== false },
      });
      return version;
    });
    return { version, unchanged: false, activated: opts.activate !== false };
  } catch (err) {
    await storage.removeRelease(entry.id, versionId);
    throw err;
  }
}

async function activateVersionInTx(tx: Queryable, actor: Actor, entryId: string, versionId: string, action: "publish" | "rollback" | "copy"): Promise<number> {
  const r = await tx.query<{ publication_revision: number }>(
    `UPDATE deployments SET active_version_id = $2, publication_revision = publication_revision + 1, updated_at = now(), updated_by = $3
     WHERE entry_id = $1 RETURNING publication_revision`,
    [entryId, versionId, actor.id],
  );
  if (!r.rows.length) throw notFound("Deployment record missing");
  const revision = r.rows[0].publication_revision;
  await tx.query(`INSERT INTO deployment_history (entry_id, version_id, action, actor_id, revision) VALUES ($1, $2, $3, $4, $5)`, [entryId, versionId, action, actor.id, revision]);
  return revision;
}

/** Rollback changes which version is active. It never changes stored documents. */
export async function rollback(db: Db, actor: Actor, entry: Entry, versionId: string): Promise<Version> {
  if (entry.frozen) throw new KitlaneError("frozen", "This tool is frozen; rollback is blocked");
  return db.transaction(async (tx) => {
    const version = await getVersion(tx, versionId);
    if (!version || version.entry_id !== entry.id) throw notFound("Version not found for this tool");
    if (version.removed) throw badRequest("That version's content was removed and cannot be activated");
    const revision = await activateVersionInTx(tx, actor, entry.id, version.id, "rollback");
    await audit(tx, actor, { action: "version.rollback", entryId: entry.id, targetType: "version", targetId: version.id, details: { number: version.number, revision } });
    return version;
  });
}

/**
 * Make a copy: duplicates the published files of one version into a brand-new tool with its own
 * ID, owner, name, and origin. Shared-collection bindings are retained as read references only.
 * Personal storage starts empty; no grants, credentials, or sessions are inherited.
 */
export async function copyTool(
  db: Db,
  storage: ArtifactStorage,
  actor: Actor,
  copier: User,
  source: EntryWithNames,
  sourceVersion: Version,
  input: { name: string; title?: string; purpose?: string },
): Promise<EntryWithNames> {
  if (source.mode !== "hosted") throw badRequest("Only hosted tools can be copied");
  if (source.frozen) throw new KitlaneError("frozen", "This tool is frozen and cannot be copied");
  if (sourceVersion.entry_id !== source.id || sourceVersion.removed) throw notFound("Version not available for copying");
  const newVersionId = newId(12);
  let created: EntryWithNames | null = null;
  try {
    created = await db.transaction(async (tx) => {
      const entry = await createEntry(tx, actor, copier, {
        kind: "tool",
        mode: "hosted",
        name: input.name,
        title: input.title?.trim() || `${source.title} (copy)`,
        purpose: input.purpose ?? source.purpose,
        tags: source.tags,
        copiedFrom: { entryId: source.id, versionId: sourceVersion.id },
        // The same files render in the same scheme, so the declared theme travels with the remix.
        theme: source.theme ?? null,
      });
      await tx.query(
        `INSERT INTO versions (id, entry_id, number, created_by, file_count, total_bytes, content_hash, manifest, note, source_entry_id, source_version_id, detected_theme)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
        [
          newVersionId,
          entry.id,
          copier.id,
          sourceVersion.file_count,
          sourceVersion.total_bytes,
          sourceVersion.content_hash,
          JSON.stringify(sourceVersion.manifest),
          `Copied from ${source.names[0] ?? source.id} v${sourceVersion.number}`,
          source.id,
          sourceVersion.id,
          sourceVersion.detected_theme ?? null,
        ],
      );
      await activateVersionInTx(tx, actor, entry.id, newVersionId, "copy");
      const bindings = await copyBindingsAsReadReferences(tx, source.id, entry.id);
      await audit(tx, actor, { action: "entry.copied", entryId: entry.id, details: { sourceEntryId: source.id, sourceVersionId: sourceVersion.id, bindingsRetained: bindings } });
      await audit(tx, actor, { action: "entry.copied_from", entryId: source.id, targetType: "entry", targetId: entry.id, details: { sourceVersionId: sourceVersion.id } });
      return entry;
    });
    await storage.copyRelease(source.id, sourceVersion.id, created.id, newVersionId);
    return created;
  } catch (err) {
    if (created) {
      await storage.removeRelease(created.id, newVersionId);
      await db.query(`DELETE FROM entries WHERE id = $1`, [created.id]).catch(() => undefined);
    }
    throw err;
  }
}

/**
 * Administrator removal path for mistakenly uploaded credentials or other material that must not
 * remain downloadable. The audit event and version metadata are preserved; the bytes are not.
 */
export async function removeVersionContent(db: Db, storage: ArtifactStorage, actor: Actor, entry: Entry, versionId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const version = await getVersion(tx, versionId);
    if (!version || version.entry_id !== entry.id) throw notFound("Version not found for this tool");
    await tx.query(`UPDATE versions SET removed = TRUE, removed_reason = $2, removed_at = now(), manifest = $3::jsonb WHERE id = $1`, [
      version.id,
      reason,
      JSON.stringify({ files: version.manifest.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, contentType: f.contentType })), entry: version.manifest.entry, removed: true }),
    ]);
    const dep = await getDeployment(tx, entry.id);
    if (dep?.active_version_id === version.id) {
      await tx.query(`UPDATE deployments SET active_version_id = NULL, publication_revision = publication_revision + 1, updated_at = now(), updated_by = $2 WHERE entry_id = $1`, [entry.id, actor.id]);
    }
    await audit(tx, actor, { action: "version.content_removed", entryId: entry.id, targetType: "version", targetId: version.id, details: { reason, wasActive: dep?.active_version_id === version.id } });
  });
  await storage.removeRelease(entry.id, versionId);
}

/** Streams a version's files as tar.gz for download and adaptation. */
export async function packVersion(storage: ArtifactStorage, entryId: string, version: Version): Promise<Readable> {
  if (version.removed) throw new KitlaneError("not_found", "This version's content was removed");
  const pack = tar.pack();
  const gzip = zlib.createGzip();
  (async () => {
    try {
      for (const file of version.manifest.files) {
        const buf = await storage.readFile(entryId, version.id, file.path);
        if (!buf) continue;
        await new Promise<void>((resolve, reject) => {
          pack.entry({ name: file.path, size: buf.length, mode: 0o644, mtime: version.created_at }, buf, (err) => (err ? reject(err) : resolve()));
        });
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();
  return pack.pipe(gzip);
}

export async function lineage(q: Queryable, entry: Entry): Promise<{ original: { entry: EntryWithNames | null; versionId: string | null } | null; copies: EntryWithNames[] }> {
  const original = entry.copied_from_entry_id ? { entry: await getEntry(q, entry.copied_from_entry_id), versionId: entry.copied_from_version_id } : null;
  const r = await q.query<{ id: string }>(`SELECT id FROM entries WHERE copied_from_entry_id = $1 ORDER BY created_at`, [entry.id]);
  const copies: EntryWithNames[] = [];
  for (const row of r.rows) {
    const e = await getEntry(q, row.id);
    if (e) copies.push(e);
  }
  return { original, copies };
}
