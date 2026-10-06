import type { Queryable } from "../db/index.js";
import { KitlaneError, forbidden, notFound } from "../errors.js";
import { validateName } from "../names.js";
import type { Actor } from "../types.js";
import { audit } from "./audit.js";

export interface NameRow {
  name: string;
  entry_id: string | null;
  reserved: boolean;
  claimed_by: string | null;
  claimed_at: Date;
}

export async function getName(q: Queryable, raw: string): Promise<NameRow | null> {
  const name = raw.trim().toLowerCase();
  const r = await q.query<NameRow>(`SELECT * FROM names WHERE name = $1`, [name]);
  return r.rows[0] ?? null;
}

export async function namesForEntry(q: Queryable, entryId: string): Promise<string[]> {
  const r = await q.query<{ name: string }>(`SELECT name FROM names WHERE entry_id = $1 ORDER BY claimed_at`, [entryId]);
  return r.rows.map((x) => x.name);
}

/**
 * Claims an unused name for an entry. Anyone eligible to publish may claim an unused name;
 * existing names are controlled by their maintainers (see reassignName).
 */
export async function claimName(q: Queryable, actor: Actor, rawName: string, entryId: string): Promise<string> {
  const name = validateName(rawName);
  const existing = await getName(q, name);
  if (existing) {
    if (existing.entry_id === entryId) return name;
    if (existing.reserved) throw new KitlaneError("name_reserved", `"${name}" is reserved by an administrator`);
    throw new KitlaneError("name_taken", `"${name}" is already in use`);
  }
  await q.query(`INSERT INTO names (name, entry_id, claimed_by) VALUES ($1, $2, $3)`, [name, entryId, actor.id]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, $2, 'claimed', $3)`, [name, entryId, actor.id]);
  await audit(q, actor, { action: "name.claimed", entryId, targetType: "name", targetId: name });
  return name;
}

/** Releases a name held by an entry. The caller must already be authorized for the entry. */
export async function releaseName(q: Queryable, actor: Actor, rawName: string, entryId: string): Promise<void> {
  const name = rawName.trim().toLowerCase();
  const existing = await getName(q, name);
  if (!existing || existing.entry_id !== entryId) throw notFound(`"${name}" is not a name of this entry`);
  const count = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM names WHERE entry_id = $1`, [entryId]);
  if (count.rows[0].n <= 1) throw new KitlaneError("bad_request", "An entry must keep at least one name");
  await q.query(`DELETE FROM names WHERE name = $1`, [name]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, $2, 'released', $3)`, [name, entryId, actor.id]);
  await audit(q, actor, { action: "name.released", entryId, targetType: "name", targetId: name });
}

/**
 * Moves a name from one entry to another. This is never implicit: the caller must be authorized
 * on both entries (checked by the route layer) or be an administrator.
 */
export async function reassignName(q: Queryable, actor: Actor, rawName: string, toEntryId: string): Promise<void> {
  const name = validateName(rawName);
  const existing = await getName(q, name);
  if (!existing || !existing.entry_id) throw notFound(`"${name}" is not currently assigned`);
  const fromEntryId = existing.entry_id;
  if (fromEntryId === toEntryId) return;
  const count = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM names WHERE entry_id = $1`, [fromEntryId]);
  if (count.rows[0].n <= 1) throw new KitlaneError("bad_request", "The current entry must keep at least one name");
  await q.query(`UPDATE names SET entry_id = $2, claimed_by = $3, claimed_at = now() WHERE name = $1`, [name, toEntryId, actor.id]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, $2, 'released', $3)`, [name, fromEntryId, actor.id]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, $2, 'reassigned', $3)`, [name, toEntryId, actor.id]);
  await audit(q, actor, { action: "name.reassigned", entryId: toEntryId, targetType: "name", targetId: name, details: { from: fromEntryId } });
}

export async function reserveName(q: Queryable, actor: Actor, rawName: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) throw forbidden("Only administrators reserve names");
  const name = validateName(rawName);
  const existing = await getName(q, name);
  if (existing?.entry_id) throw new KitlaneError("name_taken", `"${name}" is in use; release it first`);
  if (existing?.reserved) return;
  await q.query(`INSERT INTO names (name, entry_id, reserved, claimed_by) VALUES ($1, NULL, TRUE, $2)`, [name, actor.id]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, NULL, 'reserved', $2)`, [name, actor.id]);
  await audit(q, actor, { action: "name.reserved", targetType: "name", targetId: name });
}

export async function unreserveName(q: Queryable, actor: Actor, rawName: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin) throw forbidden("Only administrators unreserve names");
  const name = rawName.trim().toLowerCase();
  const existing = await getName(q, name);
  if (!existing?.reserved) throw notFound(`"${name}" is not reserved`);
  await q.query(`DELETE FROM names WHERE name = $1`, [name]);
  await q.query(`INSERT INTO name_history (name, entry_id, action, actor_id) VALUES ($1, NULL, 'unreserved', $2)`, [name, actor.id]);
  await audit(q, actor, { action: "name.unreserved", targetType: "name", targetId: name });
}

export interface NameHistoryRow {
  id: number;
  name: string;
  entry_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  entry_title: string | null;
  at: Date;
}

export async function nameHistory(q: Queryable, rawName: string): Promise<NameHistoryRow[]> {
  const name = rawName.trim().toLowerCase();
  const r = await q.query<NameHistoryRow>(
    `SELECT h.*, u.display_name AS actor_name, e.title AS entry_title
     FROM name_history h LEFT JOIN users u ON u.id = h.actor_id LEFT JOIN entries e ON e.id = h.entry_id
     WHERE h.name = $1 ORDER BY h.at DESC, h.id DESC`,
    [name],
  );
  return r.rows;
}

export async function listReservedNames(q: Queryable): Promise<NameRow[]> {
  return (await q.query<NameRow>(`SELECT * FROM names WHERE reserved ORDER BY name`)).rows;
}
