import type { Queryable } from "../db/index.js";
import type { Actor } from "../types.js";

export interface AuditInput {
  action: string;
  entryId?: string | null;
  collectionId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Records an authorized change. Never pass document contents, personal data, or credentials
 * in details; callers pass identifiers, revisions, and counts only.
 */
export async function audit(q: Queryable, actor: Actor, input: AuditInput): Promise<void> {
  await q.query(
    `INSERT INTO audit_events (actor_type, actor_id, action, entry_id, collection_id, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      actor.type,
      actor.id,
      input.action,
      input.entryId ?? null,
      input.collectionId ?? null,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export interface AuditEvent {
  id: number;
  at: Date;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entry_id: string | null;
  collection_id: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
}

export async function listAuditForEntry(q: Queryable, entryId: string, limit = 100): Promise<AuditEvent[]> {
  const r = await q.query<AuditEvent>(
    `SELECT a.*, u.display_name AS actor_name FROM audit_events a
     LEFT JOIN users u ON u.id = a.actor_id AND a.actor_type = 'user'
     WHERE a.entry_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`,
    [entryId, limit],
  );
  return r.rows;
}

export async function listAuditForCollection(q: Queryable, collectionId: string, limit = 100): Promise<AuditEvent[]> {
  const r = await q.query<AuditEvent>(
    `SELECT a.*, u.display_name AS actor_name FROM audit_events a
     LEFT JOIN users u ON u.id = a.actor_id AND a.actor_type = 'user'
     WHERE a.collection_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`,
    [collectionId, limit],
  );
  return r.rows;
}

export async function listRecentAudit(q: Queryable, limit = 200): Promise<AuditEvent[]> {
  const r = await q.query<AuditEvent>(
    `SELECT a.*, u.display_name AS actor_name FROM audit_events a
     LEFT JOIN users u ON u.id = a.actor_id AND a.actor_type = 'user'
     ORDER BY a.at DESC, a.id DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}
