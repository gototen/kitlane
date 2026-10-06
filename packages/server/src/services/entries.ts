import type { Queryable } from "../db/index.js";
import { KitlaneError, badRequest, forbidden, notFound } from "../errors.js";
import { newId } from "../ids.js";
import type { Actor, Entry, EntryKind, EntryMode, EntryWithNames, Lifecycle, User } from "../types.js";
import { audit } from "./audit.js";
import { claimName } from "./names.js";

const ENTRY_SELECT = `
  SELECT e.*,
    COALESCE((SELECT json_agg(n.name ORDER BY n.claimed_at) FROM names n WHERE n.entry_id = e.id), '[]'::json) AS names,
    cu.display_name AS creator_name, cu.team AS creator_team, ou.display_name AS owner_name
  FROM entries e
  JOIN users cu ON cu.id = e.creator_id
  JOIN users ou ON ou.id = e.owner_id`;

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const v = t.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (v && v.length <= 40) out.add(v);
    if (out.size >= 10) break;
  }
  return [...out];
}

export function validateExternalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest("Enter a full URL starting with https:// or http://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw badRequest("Only http(s) destinations are allowed; script and other executable URL schemes are rejected");
  }
  if (url.username || url.password) throw badRequest("URLs with embedded credentials are rejected");
  return url.toString();
}

function validateTitle(title: string): string {
  const t = title.trim();
  if (t.length < 1 || t.length > 120) throw badRequest("Title must be 1 to 120 characters");
  return t;
}

function validatePurpose(purpose: string): string {
  const p = purpose.trim().replace(/\s+/g, " ");
  if (p.length > 280) throw badRequest("Purpose must be at most 280 characters (one sentence)");
  return p;
}

export interface CreateEntryInput {
  kind: EntryKind;
  mode: EntryMode;
  name: string;
  title: string;
  purpose?: string;
  tags?: string[];
  team?: string | null;
  repoUrl?: string | null;
  externalUrl?: string | null;
  copiedFrom?: { entryId: string; versionId: string } | null;
}

export async function createEntry(q: Queryable, actor: Actor, creator: User, input: CreateEntryInput): Promise<EntryWithNames> {
  if (input.mode === "external" && !input.externalUrl) throw badRequest("External entries need a destination URL");
  if (input.mode === "hosted" && input.kind !== "tool") throw badRequest("Only tools can be hosted");
  const id = newId(12);
  const externalUrl = input.externalUrl ? validateExternalUrl(input.externalUrl) : null;
  const repoUrl = input.repoUrl ? validateExternalUrl(input.repoUrl) : null;
  await q.query(
    `INSERT INTO entries (id, kind, mode, title, purpose, tags, creator_id, owner_id, team, repo_url, external_url, copied_from_entry_id, copied_from_version_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      input.kind,
      input.mode,
      validateTitle(input.title),
      validatePurpose(input.purpose ?? ""),
      JSON.stringify(normalizeTags(input.tags)),
      creator.id,
      input.team ?? creator.team ?? null,
      repoUrl,
      externalUrl,
      input.copiedFrom?.entryId ?? null,
      input.copiedFrom?.versionId ?? null,
    ],
  );
  await q.query(`INSERT INTO maintainers (entry_id, user_id, added_by) VALUES ($1, $2, $2)`, [id, creator.id]);
  if (input.mode === "hosted") {
    await q.query(`INSERT INTO deployments (entry_id, active_version_id, publication_revision, updated_by) VALUES ($1, NULL, 0, $2)`, [id, creator.id]);
  }
  await audit(q, actor, { action: "entry.created", entryId: id, details: { kind: input.kind, mode: input.mode, copiedFrom: input.copiedFrom ?? null } });
  await claimName(q, actor, input.name, id);
  return (await getEntry(q, id))!;
}

export async function getEntry(q: Queryable, id: string): Promise<EntryWithNames | null> {
  const r = await q.query<EntryWithNames>(`${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function requireEntry(q: Queryable, id: string): Promise<EntryWithNames> {
  const e = await getEntry(q, id);
  if (!e) throw notFound("Tool not found");
  return e;
}

export async function getEntryByName(q: Queryable, name: string): Promise<EntryWithNames | null> {
  const r = await q.query<EntryWithNames>(
    `${ENTRY_SELECT} WHERE e.id = (SELECT entry_id FROM names WHERE name = $1)`,
    [name.trim().toLowerCase()],
  );
  return r.rows[0] ?? null;
}

export async function listEntries(q: Queryable, opts: { limit?: number; ownerId?: string; creatorId?: string; maintainerId?: string; includeRetired?: boolean } = {}): Promise<EntryWithNames[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.ownerId) {
    params.push(opts.ownerId);
    where.push(`e.owner_id = $${params.length}`);
  }
  if (opts.creatorId) {
    params.push(opts.creatorId);
    where.push(`e.creator_id = $${params.length}`);
  }
  if (opts.maintainerId) {
    params.push(opts.maintainerId);
    where.push(`EXISTS (SELECT 1 FROM maintainers m WHERE m.entry_id = e.id AND m.user_id = $${params.length})`);
  }
  if (!opts.includeRetired) where.push(`e.lifecycle <> 'retired'`);
  params.push(Math.min(opts.limit ?? 50, 500));
  const r = await q.query<EntryWithNames>(
    `${ENTRY_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

export async function listMaintainers(q: Queryable, entryId: string): Promise<(User & { added_at: Date })[]> {
  const r = await q.query<User & { added_at: Date }>(
    `SELECT u.*, m.added_at FROM maintainers m JOIN users u ON u.id = m.user_id WHERE m.entry_id = $1 ORDER BY m.added_at`,
    [entryId],
  );
  return r.rows;
}

export async function isMaintainer(q: Queryable, entryId: string, userId: string): Promise<boolean> {
  const r = await q.query(`SELECT 1 FROM maintainers WHERE entry_id = $1 AND user_id = $2`, [entryId, userId]);
  return r.rows.length > 0;
}

/** Maintainers and owners may change an entry. Administrators may act with an audit trail. */
export async function requireMaintainer(q: Queryable, entry: Entry, user: User): Promise<void> {
  if (user.is_admin || entry.owner_id === user.id) return;
  if (await isMaintainer(q, entry.id, user.id)) return;
  throw forbidden("Only this tool's maintainers can do that");
}

export function requireOwner(entry: Entry, user: User): void {
  if (user.is_admin || entry.owner_id === user.id) return;
  throw forbidden("Only this tool's owner can do that");
}

export function requireAdmin(user: User): void {
  if (!user.is_admin) throw forbidden("Administrator access required");
}

export interface UpdateMetadataInput {
  title?: string;
  purpose?: string;
  tags?: string[];
  team?: string | null;
  repoUrl?: string | null;
  externalUrl?: string | null;
}

export async function updateMetadata(q: Queryable, actor: Actor, entry: Entry, input: UpdateMetadataInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [entry.id];
  const push = (col: string, val: unknown, cast = "") => {
    params.push(val);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.title !== undefined) push("title", validateTitle(input.title));
  if (input.purpose !== undefined) push("purpose", validatePurpose(input.purpose));
  if (input.tags !== undefined) push("tags", JSON.stringify(normalizeTags(input.tags)), "::jsonb");
  if (input.team !== undefined) push("team", input.team ? input.team.trim().slice(0, 80) : null);
  if (input.repoUrl !== undefined) push("repo_url", input.repoUrl ? validateExternalUrl(input.repoUrl) : null);
  if (input.externalUrl !== undefined) {
    if (entry.mode !== "external") throw badRequest("Hosted tools do not have an external URL");
    push("external_url", input.externalUrl ? validateExternalUrl(input.externalUrl) : null);
  }
  if (!sets.length) return;
  sets.push("updated_at = now()");
  await q.query(`UPDATE entries SET ${sets.join(", ")} WHERE id = $1`, params);
  await audit(q, actor, { action: "entry.metadata_updated", entryId: entry.id, details: { fields: Object.keys(input) } });
}

export async function setLifecycle(q: Queryable, actor: Actor, entry: Entry, lifecycle: Lifecycle, replacementEntryId: string | null = null): Promise<void> {
  if (!["experimental", "maintained", "retired"].includes(lifecycle)) throw badRequest("Unknown lifecycle state");
  if (replacementEntryId) {
    const rep = await getEntry(q, replacementEntryId);
    if (!rep) throw badRequest("Replacement tool not found");
  }
  await q.query(`UPDATE entries SET lifecycle = $2, replacement_entry_id = $3, updated_at = now() WHERE id = $1`, [
    entry.id,
    lifecycle,
    lifecycle === "retired" ? replacementEntryId : null,
  ]);
  await audit(q, actor, { action: lifecycle === "retired" ? "entry.retired" : "entry.lifecycle_changed", entryId: entry.id, details: { lifecycle, replacementEntryId } });
}

export async function setFeatured(q: Queryable, actor: Actor, entry: Entry, featured: boolean): Promise<void> {
  await q.query(`UPDATE entries SET featured = $2, updated_at = now() WHERE id = $1`, [entry.id, featured]);
  await audit(q, actor, { action: "entry.featured_changed", entryId: entry.id, details: { featured } });
}

export async function setFrozen(q: Queryable, actor: Actor, entry: Entry, frozen: boolean, reason: string | null): Promise<void> {
  await q.query(`UPDATE entries SET frozen = $2, frozen_reason = $3, updated_at = now() WHERE id = $1`, [entry.id, frozen, frozen ? reason : null]);
  await audit(q, actor, { action: frozen ? "entry.frozen" : "entry.unfrozen", entryId: entry.id, details: { reason } });
}

export async function addMaintainer(q: Queryable, actor: Actor, entry: Entry, user: User): Promise<void> {
  await q.query(`INSERT INTO maintainers (entry_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [entry.id, user.id, actor.id]);
  await audit(q, actor, { action: "entry.maintainer_added", entryId: entry.id, targetType: "user", targetId: user.id });
}

export async function removeMaintainer(q: Queryable, actor: Actor, entry: Entry, userId: string): Promise<void> {
  if (userId === entry.owner_id) throw badRequest("Transfer ownership before removing the owner as a maintainer");
  await q.query(`DELETE FROM maintainers WHERE entry_id = $1 AND user_id = $2`, [entry.id, userId]);
  await audit(q, actor, { action: "entry.maintainer_removed", entryId: entry.id, targetType: "user", targetId: userId });
}

/** Explicit ownership transfer. Creator attribution is unchanged. */
export async function transferOwnership(q: Queryable, actor: Actor, entry: Entry, newOwner: User, recovery = false): Promise<void> {
  await q.query(`UPDATE entries SET owner_id = $2, updated_at = now() WHERE id = $1`, [entry.id, newOwner.id]);
  await q.query(`INSERT INTO maintainers (entry_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [entry.id, newOwner.id, actor.id]);
  await audit(q, actor, {
    action: recovery ? "entry.ownership_recovered" : "entry.ownership_transferred",
    entryId: entry.id,
    targetType: "user",
    targetId: newOwner.id,
    details: { previousOwner: entry.owner_id },
  });
}

export function assertLaunchable(entry: Entry): void {
  if (entry.frozen) throw new KitlaneError("frozen", "This tool has been frozen by an administrator", { reason: entry.frozen_reason });
}
