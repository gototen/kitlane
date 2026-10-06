import type { Db, Queryable } from "../db/index.js";
import type { Limits } from "../config.js";
import { KitlaneError, badRequest, forbidden, notFound } from "../errors.js";
import { hashToken, newId, newToken } from "../ids.js";
import { FIELD_RE, validateCollectionName, validateDocId } from "../names.js";
import type { Actor, DocumentRecord, Entry, SharedCollection, User } from "../types.js";
export type { SharedCollection } from "../types.js";
import { audit } from "./audit.js";

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

export interface PersonalScope {
  installationId: string;
  toolId: string;
  userId: string;
  collection: string;
}

export type FilterOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "contains";
export interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
  where?: Filter[];
  orderBy?: string | null;
  order?: "asc" | "desc";
}

export interface ListResult {
  items: DocumentRecord[];
  nextCursor: string | null;
  revision?: number;
}

export type BulkOp = { op: "set"; id: string; data: unknown; ifRevision?: number } | { op: "delete"; id: string; ifRevision?: number };

const OPS: Record<FilterOp, string> = { eq: "=", ne: "<>", lt: "<", lte: "<=", gt: ">", gte: ">=", contains: "@>" };

export function validatePayload(data: unknown, limits: Limits): string {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw badRequest("Document data must be a JSON object");
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > limits.maxDocBytes) throw new KitlaneError("payload_too_large", `Documents are limited to ${limits.maxDocBytes} bytes`);
  return json;
}

export function parseFilters(raw: unknown): Filter[] {
  if (raw === undefined || raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length > 8) throw badRequest("At most 8 filters are supported");
  return arr.map((raw: any) => {
    let f = raw;
    if (typeof f === "string" && (f.startsWith("[") || f.startsWith("{"))) {
      try {
        f = JSON.parse(f);
      } catch {
        throw badRequest("Invalid filter JSON");
      }
    }
    let field: string, op: string, value: unknown;
    if (typeof f === "string") {
      const parts = f.split(":");
      if (parts.length < 3) throw badRequest("Filters use field:op:value");
      field = parts[0];
      op = parts[1];
      const rawValue = parts.slice(2).join(":");
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue;
      }
    } else if (Array.isArray(f) && f.length === 3) {
      [field, op, value] = f;
    } else if (f && typeof f === "object") {
      ({ field, op, value } = f);
    } else {
      throw badRequest("Invalid filter");
    }
    if (!FIELD_RE.test(field)) throw badRequest(`Invalid filter field: ${field}`);
    if (!(op in OPS)) throw badRequest(`Unsupported filter operator: ${op}. Use eq, ne, lt, lte, gt, gte, contains`);
    return { field, op: op as FilterOp, value };
  });
}

function buildListClauses(opts: ListOptions, limits: Limits, params: unknown[], keysetColumn: string): { where: string; order: string; limit: number; offset: number } {
  const clauses: string[] = [];
  for (const f of opts.where ?? []) {
    params.push(f.field);
    const fieldParam = `$${params.length}`;
    params.push(JSON.stringify(f.value));
    const valueParam = `$${params.length}`;
    clauses.push(`(payload -> ${fieldParam}::text) ${OPS[f.op]} ${valueParam}::jsonb`);
  }
  const limit = Math.max(1, Math.min(opts.limit ?? 50, limits.listLimitMax));
  let offset = 0;
  let order: string;
  if (opts.orderBy) {
    if (!FIELD_RE.test(opts.orderBy)) throw badRequest("Invalid orderBy field");
    params.push(opts.orderBy);
    const dir = opts.order === "desc" ? "DESC" : "ASC";
    order = `(payload -> $${params.length}::text) ${dir} NULLS LAST, ${keysetColumn} ${dir}`;
    if (opts.cursor) {
      if (!/^o:\d{1,9}$/.test(opts.cursor)) throw badRequest("Invalid cursor");
      offset = Number(opts.cursor.slice(2));
    }
  } else {
    order = `${keysetColumn} ASC`;
    if (opts.cursor) {
      validateDocId(opts.cursor);
      params.push(opts.cursor);
      clauses.push(`${keysetColumn} > $${params.length}`);
    }
  }
  return { where: clauses.length ? " AND " + clauses.join(" AND ") : "", order, limit, offset };
}

function toRecord(row: any, withWriter = false): DocumentRecord {
  return {
    id: row.doc_id,
    data: row.payload,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(withWriter ? { updatedBy: row.updated_by_id ?? null } : {}),
  };
}

function conflict(current: DocumentRecord | null): KitlaneError {
  return new KitlaneError("conflict", "The document changed since you last read it", { current });
}

// ---------------------------------------------------------------------------------------------
// Personal documents: scoped by installation, tool, user, collection, document.
// The scope always comes from trusted routing and authentication, never from the request body.
// ---------------------------------------------------------------------------------------------

const P_WHERE = `installation_id = $1 AND tool_id = $2 AND user_id = $3 AND collection = $4`;

function scopeParams(s: PersonalScope): unknown[] {
  validateCollectionName(s.collection);
  return [s.installationId, s.toolId, s.userId, s.collection];
}

export async function getPersonal(q: Queryable, scope: PersonalScope, docId: string): Promise<DocumentRecord | null> {
  validateDocId(docId);
  const r = await q.query(`SELECT * FROM personal_documents WHERE ${P_WHERE} AND doc_id = $5`, [...scopeParams(scope), docId]);
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

export async function listPersonal(q: Queryable, scope: PersonalScope, opts: ListOptions, limits: Limits): Promise<ListResult> {
  const params = scopeParams(scope);
  const { where, order, limit, offset } = buildListClauses(opts, limits, params, "doc_id");
  const r = await q.query(`SELECT * FROM personal_documents WHERE ${P_WHERE}${where} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`, params);
  const rows = r.rows.slice(0, limit);
  const more = r.rows.length > limit;
  const nextCursor = more ? (opts.orderBy ? `o:${offset + limit}` : rows[rows.length - 1].doc_id) : null;
  return { items: rows.map((row) => toRecord(row)), nextCursor };
}

async function enforcePersonalQuota(tx: Queryable, scope: PersonalScope, limits: Limits, addedBytes: number, addedDocs: number): Promise<void> {
  const r = await tx.query<{ bytes: string | number; docs: number }>(
    `SELECT COALESCE(sum(octet_length(payload::text)), 0) AS bytes,
            (SELECT count(*)::int FROM personal_documents WHERE ${P_WHERE}) AS docs
     FROM personal_documents WHERE installation_id = $1 AND tool_id = $2 AND user_id = $3`,
    scopeParams(scope),
  );
  if (Number(r.rows[0].bytes) + addedBytes > limits.personalQuotaBytes) throw new KitlaneError("quota_exceeded", "Personal storage quota for this tool is full");
  if (r.rows[0].docs + addedDocs > limits.maxDocsPerCollection) throw new KitlaneError("quota_exceeded", "Too many documents in this collection");
}

async function setPersonalInTx(tx: Queryable, scope: PersonalScope, docId: string, json: string, ifRevision: number | undefined, limits: Limits): Promise<DocumentRecord> {
  validateDocId(docId);
  const params = scopeParams(scope);
  const existing = await tx.query(`SELECT * FROM personal_documents WHERE ${P_WHERE} AND doc_id = $5 FOR UPDATE`, [...params, docId]);
  const current = existing.rows[0] ? toRecord(existing.rows[0]) : null;
  if (ifRevision !== undefined && (current?.revision ?? 0) !== ifRevision) throw conflict(current);
  if (!current) {
    await enforcePersonalQuota(tx, scope, limits, Buffer.byteLength(json), 1);
    const r = await tx.query(
      `INSERT INTO personal_documents (installation_id, tool_id, user_id, collection, doc_id, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
      [...params, docId, json],
    );
    return toRecord(r.rows[0]);
  }
  await enforcePersonalQuota(tx, scope, limits, Buffer.byteLength(json) - Buffer.byteLength(JSON.stringify(current.data)), 0);
  const r = await tx.query(
    `UPDATE personal_documents SET payload = $6::jsonb, revision = revision + 1, updated_at = now() WHERE ${P_WHERE} AND doc_id = $5 RETURNING *`,
    [...params, docId, json],
  );
  return toRecord(r.rows[0]);
}

async function deletePersonalInTx(tx: Queryable, scope: PersonalScope, docId: string, ifRevision: number | undefined): Promise<boolean> {
  validateDocId(docId);
  const params = scopeParams(scope);
  if (ifRevision !== undefined) {
    const existing = await tx.query(`SELECT * FROM personal_documents WHERE ${P_WHERE} AND doc_id = $5 FOR UPDATE`, [...params, docId]);
    const current = existing.rows[0] ? toRecord(existing.rows[0]) : null;
    if ((current?.revision ?? 0) !== ifRevision) throw conflict(current);
  }
  const r = await tx.query(`DELETE FROM personal_documents WHERE ${P_WHERE} AND doc_id = $5`, [...params, docId]);
  return r.rowCount > 0;
}

export function setPersonal(db: Db, scope: PersonalScope, docId: string, data: unknown, ifRevision: number | undefined, limits: Limits): Promise<DocumentRecord> {
  const json = validatePayload(data, limits);
  return db.transaction((tx) => setPersonalInTx(tx, scope, docId, json, ifRevision, limits));
}

export function deletePersonal(db: Db, scope: PersonalScope, docId: string, ifRevision: number | undefined): Promise<boolean> {
  return db.transaction((tx) => deletePersonalInTx(tx, scope, docId, ifRevision));
}

export function validateBulk(ops: unknown, limits: Limits): BulkOp[] {
  if (!Array.isArray(ops)) throw badRequest("Bulk operations must be an array");
  if (ops.length === 0) throw badRequest("Bulk operations must not be empty");
  if (ops.length > limits.maxBulkDocs) throw new KitlaneError("payload_too_large", `Bulk operations are limited to ${limits.maxBulkDocs} documents; split the refresh into bounded batches`);
  const ids = new Set<string>();
  return ops.map((o: any) => {
    if (!o || typeof o !== "object" || typeof o.id !== "string") throw badRequest("Each bulk operation needs an id");
    validateDocId(o.id);
    if (ids.has(o.id)) throw badRequest(`Duplicate id in bulk operation: ${o.id}`);
    ids.add(o.id);
    if (o.ifRevision !== undefined && (!Number.isInteger(o.ifRevision) || o.ifRevision < 0)) throw badRequest("ifRevision must be a non-negative integer");
    if (o.op === "set") return { op: "set", id: o.id, data: o.data, ifRevision: o.ifRevision };
    if (o.op === "delete") return { op: "delete", id: o.id, ifRevision: o.ifRevision };
    throw badRequest(`Unknown bulk op: ${o.op}`);
  });
}

/** Atomic bulk write to personal storage. Either every operation applies or none does. */
export function bulkPersonal(db: Db, scope: PersonalScope, ops: BulkOp[], replaceAll: boolean, limits: Limits): Promise<{ applied: number }> {
  const payloads = ops.map((o) => (o.op === "set" ? validatePayload(o.data, limits) : null));
  return db.transaction(async (tx) => {
    if (replaceAll) {
      const keep = ops.filter((o) => o.op === "set").map((o) => o.id);
      await tx.query(`DELETE FROM personal_documents WHERE ${P_WHERE} AND NOT (doc_id = ANY($5::text[]))`, [...scopeParams(scope), keep]);
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op === "set") await setPersonalInTx(tx, scope, op.id, payloads[i]!, op.ifRevision, limits);
      else await deletePersonalInTx(tx, scope, op.id, op.ifRevision);
    }
    return { applied: ops.length };
  });
}

/** Used only by the account-level "delete my data" path; never exposed to other users or tools. */
export async function deleteAllPersonalForUserTool(q: Queryable, installationId: string, toolId: string, userId: string): Promise<number> {
  const r = await q.query(`DELETE FROM personal_documents WHERE installation_id = $1 AND tool_id = $2 AND user_id = $3`, [installationId, toolId, userId]);
  return r.rowCount;
}

// ---------------------------------------------------------------------------------------------
// Shared collections: readable by every authenticated member; writes require an authorized user
// (or updater credential) AND an allowed tool context.
// ---------------------------------------------------------------------------------------------

export async function getCollection(q: Queryable, id: string): Promise<SharedCollection | null> {
  const r = await q.query<SharedCollection>(`SELECT * FROM shared_collections WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function requireCollection(q: Queryable, id: string): Promise<SharedCollection> {
  const c = await getCollection(q, id);
  if (!c) throw notFound("Collection not found");
  return c;
}

export interface CollectionWithOwner extends SharedCollection {
  owner_name: string;
  origin_tool_title: string;
  doc_count: number;
}

export async function listCollections(q: Queryable, opts: { ownerId?: string; originToolId?: string } = {}): Promise<CollectionWithOwner[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.ownerId) {
    params.push(opts.ownerId);
    where.push(`c.owner_id = $${params.length}`);
  }
  if (opts.originToolId) {
    params.push(opts.originToolId);
    where.push(`c.origin_tool_id = $${params.length}`);
  }
  const r = await q.query<CollectionWithOwner>(
    `SELECT c.*, u.display_name AS owner_name, e.title AS origin_tool_title,
            (SELECT count(*)::int FROM shared_documents d WHERE d.collection_id = c.id) AS doc_count
     FROM shared_collections c JOIN users u ON u.id = c.owner_id JOIN entries e ON e.id = c.origin_tool_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.created_at DESC`,
    params,
  );
  return r.rows;
}

/**
 * Only an owner or maintainer of the originating tool may create one of its shared collections.
 * The collection is bound under the given name in that tool; the tool's owner owns it by default.
 */
export async function createCollection(q: Queryable, actor: Actor, installationId: string, originTool: Entry, owner: User, name: string, description = ""): Promise<SharedCollection> {
  validateCollectionName(name);
  const existingBinding = await q.query(`SELECT 1 FROM collection_bindings WHERE tool_id = $1 AND binding_name = $2`, [originTool.id, name]);
  if (existingBinding.rows.length) throw new KitlaneError("conflict", `This tool already binds "${name}"`);
  const id = newId(12);
  const r = await q.query<SharedCollection>(
    `INSERT INTO shared_collections (id, installation_id, origin_tool_id, owner_id, name, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, installationId, originTool.id, owner.id, name, description.slice(0, 500)],
  );
  await q.query(`INSERT INTO collection_bindings (tool_id, binding_name, collection_id) VALUES ($1, $2, $3)`, [originTool.id, name, id]);
  await audit(q, actor, { action: "collection.created", entryId: originTool.id, collectionId: id, details: { name, ownerId: owner.id } });
  return r.rows[0];
}

export interface BindingInfo {
  binding_name: string;
  collection_id: string;
  collection_name: string;
  origin_tool_id: string;
  owner_id: string;
  frozen: boolean;
  revision: number;
}

export async function listBindings(q: Queryable, toolId: string): Promise<BindingInfo[]> {
  const r = await q.query<BindingInfo>(
    `SELECT b.binding_name, b.collection_id, c.name AS collection_name, c.origin_tool_id, c.owner_id, c.frozen, c.revision
     FROM collection_bindings b JOIN shared_collections c ON c.id = b.collection_id WHERE b.tool_id = $1 ORDER BY b.binding_name`,
    [toolId],
  );
  return r.rows;
}

export async function resolveBinding(q: Queryable, toolId: string, bindingName: string): Promise<SharedCollection | null> {
  const r = await q.query<SharedCollection>(
    `SELECT c.* FROM collection_bindings b JOIN shared_collections c ON c.id = b.collection_id WHERE b.tool_id = $1 AND b.binding_name = $2`,
    [toolId, bindingName],
  );
  return r.rows[0] ?? null;
}

/** Binds (or rebinds) a tool-local name to a stable collection ID. Grants no writing authority. */
export async function bindCollection(q: Queryable, actor: Actor, tool: Entry, bindingName: string, collectionId: string): Promise<void> {
  validateCollectionName(bindingName);
  await requireCollection(q, collectionId);
  await q.query(
    `INSERT INTO collection_bindings (tool_id, binding_name, collection_id) VALUES ($1, $2, $3)
     ON CONFLICT (tool_id, binding_name) DO UPDATE SET collection_id = EXCLUDED.collection_id, created_at = now()`,
    [tool.id, bindingName, collectionId],
  );
  await audit(q, actor, { action: "collection.bound", entryId: tool.id, collectionId, details: { bindingName } });
}

export async function unbindCollection(q: Queryable, actor: Actor, tool: Entry, bindingName: string): Promise<void> {
  const r = await q.query<{ collection_id: string }>(`DELETE FROM collection_bindings WHERE tool_id = $1 AND binding_name = $2 RETURNING collection_id`, [tool.id, bindingName]);
  if (!r.rows.length) throw notFound("Binding not found");
  await audit(q, actor, { action: "collection.unbound", entryId: tool.id, collectionId: r.rows[0].collection_id, details: { bindingName } });
}

/** On copy: retain bindings as read references to the same collection IDs. */
export async function copyBindingsAsReadReferences(q: Queryable, fromToolId: string, toToolId: string): Promise<string[]> {
  const r = await q.query<{ binding_name: string }>(
    `INSERT INTO collection_bindings (tool_id, binding_name, collection_id)
     SELECT $2, binding_name, collection_id FROM collection_bindings WHERE tool_id = $1 RETURNING binding_name`,
    [fromToolId, toToolId],
  );
  return r.rows.map((x) => x.binding_name);
}

export interface WriterGrant {
  id: string;
  collection_id: string;
  grant_type: "user" | "tool";
  subject_id: string;
  subject_name: string | null;
  granted_by: string | null;
  granted_at: Date;
  revoked_at: Date | null;
}

export async function listGrants(q: Queryable, collectionId: string, includeRevoked = false): Promise<WriterGrant[]> {
  const r = await q.query<WriterGrant>(
    `SELECT g.*, CASE WHEN g.grant_type = 'user' THEN u.display_name ELSE e.title END AS subject_name
     FROM collection_writer_grants g
     LEFT JOIN users u ON g.grant_type = 'user' AND u.id = g.subject_id
     LEFT JOIN entries e ON g.grant_type = 'tool' AND e.id = g.subject_id
     WHERE g.collection_id = $1 ${includeRevoked ? "" : "AND g.revoked_at IS NULL"} ORDER BY g.granted_at`,
    [collectionId],
  );
  return r.rows;
}

export async function addGrant(q: Queryable, actor: Actor, collection: SharedCollection, grantType: "user" | "tool", subjectId: string): Promise<WriterGrant> {
  if (grantType === "user") {
    const u = await q.query(`SELECT 1 FROM users WHERE id = $1`, [subjectId]);
    if (!u.rows.length) throw notFound("User not found");
  } else {
    const e = await q.query<{ mode: string }>(`SELECT mode FROM entries WHERE id = $1`, [subjectId]);
    if (!e.rows.length) throw notFound("Tool not found");
    if (e.rows[0].mode !== "hosted") throw badRequest("Only hosted tools can be writer contexts");
  }
  const existing = await q.query<WriterGrant>(
    `SELECT * FROM collection_writer_grants WHERE collection_id = $1 AND grant_type = $2 AND subject_id = $3 AND revoked_at IS NULL`,
    [collection.id, grantType, subjectId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await q.query<WriterGrant>(
    `INSERT INTO collection_writer_grants (id, collection_id, grant_type, subject_id, granted_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId(12), collection.id, grantType, subjectId, actor.id],
  );
  await audit(q, actor, { action: "collection.grant_added", collectionId: collection.id, entryId: collection.origin_tool_id, targetType: grantType, targetId: subjectId });
  return r.rows[0];
}

export async function revokeGrant(q: Queryable, actor: Actor, collection: SharedCollection, grantId: string): Promise<void> {
  const r = await q.query<WriterGrant>(
    `UPDATE collection_writer_grants SET revoked_at = now(), revoked_by = $3 WHERE id = $1 AND collection_id = $2 AND revoked_at IS NULL RETURNING *`,
    [grantId, collection.id, actor.id],
  );
  if (!r.rows.length) throw notFound("Grant not found");
  await audit(q, actor, { action: "collection.grant_revoked", collectionId: collection.id, entryId: collection.origin_tool_id, targetType: r.rows[0].grant_type, targetId: r.rows[0].subject_id });
}

export async function transferCollectionOwnership(q: Queryable, actor: Actor, collection: SharedCollection, newOwner: User): Promise<void> {
  await q.query(`UPDATE shared_collections SET owner_id = $2, updated_at = now() WHERE id = $1`, [collection.id, newOwner.id]);
  await audit(q, actor, { action: "collection.ownership_transferred", collectionId: collection.id, entryId: collection.origin_tool_id, targetType: "user", targetId: newOwner.id, details: { previousOwner: collection.owner_id } });
}

export async function setCollectionFrozen(q: Queryable, actor: Actor, collection: SharedCollection, frozen: boolean, reason: string | null): Promise<void> {
  await q.query(`UPDATE shared_collections SET frozen = $2, frozen_reason = $3, updated_at = now() WHERE id = $1`, [collection.id, frozen, frozen ? reason : null]);
  await audit(q, actor, { action: frozen ? "collection.frozen" : "collection.unfrozen", collectionId: collection.id, entryId: collection.origin_tool_id, details: { reason } });
}

export async function updateCollectionDescription(q: Queryable, actor: Actor, collection: SharedCollection, description: string): Promise<void> {
  await q.query(`UPDATE shared_collections SET description = $2, updated_at = now() WHERE id = $1`, [collection.id, description.slice(0, 500)]);
  await audit(q, actor, { action: "collection.description_updated", collectionId: collection.id, entryId: collection.origin_tool_id });
}

export interface WriteDecision {
  allowed: boolean;
  userAllowed: boolean;
  toolAllowed: boolean;
  reason: string | null;
}

/** Collection management rights: owner or administrator. */
export function canManageCollection(collection: SharedCollection, user: User): boolean {
  return user.is_admin || collection.owner_id === user.id;
}

/**
 * Browser writes need BOTH an authorized user and an allowed tool context. The owner is always an
 * authorized user; the originating tool is always an allowed context. Everything else is an explicit
 * grant. Copies inherit neither.
 */
export async function decideBrowserWrite(q: Queryable, collection: SharedCollection, user: User, toolId: string): Promise<WriteDecision> {
  if (collection.frozen) return { allowed: false, userAllowed: false, toolAllowed: false, reason: "collection_frozen" };
  const grants = await q.query<{ grant_type: string; subject_id: string }>(
    `SELECT grant_type, subject_id FROM collection_writer_grants WHERE collection_id = $1 AND revoked_at IS NULL
       AND ((grant_type = 'user' AND subject_id = $2) OR (grant_type = 'tool' AND subject_id = $3))`,
    [collection.id, user.id, toolId],
  );
  const userAllowed = collection.owner_id === user.id || grants.rows.some((g) => g.grant_type === "user");
  const toolAllowed = collection.origin_tool_id === toolId || grants.rows.some((g) => g.grant_type === "tool");
  const allowed = userAllowed && toolAllowed;
  return {
    allowed,
    userAllowed,
    toolAllowed,
    reason: allowed ? null : !userAllowed && !toolAllowed ? "user_and_tool_not_granted" : !userAllowed ? "user_not_granted" : "tool_not_granted",
  };
}

export function requireWrite(decision: WriteDecision): void {
  if (decision.allowed) return;
  if (decision.reason === "collection_frozen") throw new KitlaneError("frozen", "This collection is frozen");
  const why =
    decision.reason === "tool_not_granted"
      ? "This tool is not an allowed writer context for the collection; the collection owner must grant it"
      : decision.reason === "user_not_granted"
        ? "You are not a writer on this collection"
        : "Neither you nor this tool is permitted to write to this collection";
  throw new KitlaneError("forbidden", why, { reason: decision.reason });
}

const S_WHERE = `collection_id = $1`;

export async function getShared(q: Queryable, collection: SharedCollection, docId: string): Promise<DocumentRecord | null> {
  validateDocId(docId);
  if (collection.frozen) throw new KitlaneError("frozen", "This collection is frozen");
  const r = await q.query(`SELECT * FROM shared_documents WHERE ${S_WHERE} AND doc_id = $2`, [collection.id, docId]);
  return r.rows[0] ? toRecord(r.rows[0], true) : null;
}

export async function listShared(q: Queryable, collection: SharedCollection, opts: ListOptions, limits: Limits): Promise<ListResult> {
  if (collection.frozen) throw new KitlaneError("frozen", "This collection is frozen");
  const params: unknown[] = [collection.id];
  const { where, order, limit, offset } = buildListClauses(opts, limits, params, "doc_id");
  const r = await q.query(`SELECT * FROM shared_documents WHERE ${S_WHERE}${where} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`, params);
  const rows = r.rows.slice(0, limit);
  const more = r.rows.length > limit;
  const nextCursor = more ? (opts.orderBy ? `o:${offset + limit}` : rows[rows.length - 1].doc_id) : null;
  return { items: rows.map((row) => toRecord(row, true)), nextCursor, revision: collection.revision };
}

export interface Writer {
  type: "user" | "updater";
  id: string;
}

async function lockAndBumpCollection(tx: Queryable, collectionId: string): Promise<number> {
  const r = await tx.query<{ revision: number; frozen: boolean }>(
    `UPDATE shared_collections SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision, frozen`,
    [collectionId],
  );
  if (!r.rows.length) throw notFound("Collection not found");
  if (r.rows[0].frozen) throw new KitlaneError("frozen", "This collection is frozen");
  return r.rows[0].revision;
}

async function enforceSharedQuota(tx: Queryable, collectionId: string, limits: Limits, addedBytes: number, addedDocs: number): Promise<void> {
  const r = await tx.query<{ bytes: string | number; docs: number }>(
    `SELECT COALESCE(sum(octet_length(payload::text)), 0) AS bytes, count(*)::int AS docs FROM shared_documents WHERE collection_id = $1`,
    [collectionId],
  );
  if (Number(r.rows[0].bytes) + addedBytes > limits.sharedQuotaBytes) throw new KitlaneError("quota_exceeded", "This collection's storage quota is full");
  if (r.rows[0].docs + addedDocs > limits.maxDocsPerCollection) throw new KitlaneError("quota_exceeded", "Too many documents in this collection");
}

async function setSharedInTx(tx: Queryable, collectionId: string, docId: string, json: string, ifRevision: number | undefined, writer: Writer, limits: Limits): Promise<DocumentRecord> {
  validateDocId(docId);
  const existing = await tx.query(`SELECT * FROM shared_documents WHERE ${S_WHERE} AND doc_id = $2 FOR UPDATE`, [collectionId, docId]);
  const current = existing.rows[0] ? toRecord(existing.rows[0], true) : null;
  if (ifRevision !== undefined && (current?.revision ?? 0) !== ifRevision) throw conflict(current);
  if (!current) {
    await enforceSharedQuota(tx, collectionId, limits, Buffer.byteLength(json), 1);
    const r = await tx.query(
      `INSERT INTO shared_documents (collection_id, doc_id, payload, updated_by_type, updated_by_id) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`,
      [collectionId, docId, json, writer.type, writer.id],
    );
    return toRecord(r.rows[0], true);
  }
  await enforceSharedQuota(tx, collectionId, limits, Buffer.byteLength(json) - Buffer.byteLength(JSON.stringify(current.data)), 0);
  const r = await tx.query(
    `UPDATE shared_documents SET payload = $3::jsonb, revision = revision + 1, updated_at = now(), updated_by_type = $4, updated_by_id = $5 WHERE ${S_WHERE} AND doc_id = $2 RETURNING *`,
    [collectionId, docId, json, writer.type, writer.id],
  );
  return toRecord(r.rows[0], true);
}

async function deleteSharedInTx(tx: Queryable, collectionId: string, docId: string, ifRevision: number | undefined): Promise<boolean> {
  validateDocId(docId);
  if (ifRevision !== undefined) {
    const existing = await tx.query(`SELECT * FROM shared_documents WHERE ${S_WHERE} AND doc_id = $2 FOR UPDATE`, [collectionId, docId]);
    const current = existing.rows[0] ? toRecord(existing.rows[0], true) : null;
    if ((current?.revision ?? 0) !== ifRevision) throw conflict(current);
  }
  const r = await tx.query(`DELETE FROM shared_documents WHERE ${S_WHERE} AND doc_id = $2`, [collectionId, docId]);
  return r.rowCount > 0;
}

const writerActor = (w: Writer): Actor => ({ type: w.type, id: w.id });

/** Callers must have already authorized the write (decideBrowserWrite or updater scope). */
export function setShared(db: Db, collection: SharedCollection, docId: string, data: unknown, ifRevision: number | undefined, writer: Writer, limits: Limits): Promise<DocumentRecord & { collectionRevision: number }> {
  const json = validatePayload(data, limits);
  return db.transaction(async (tx) => {
    const collectionRevision = await lockAndBumpCollection(tx, collection.id);
    const doc = await setSharedInTx(tx, collection.id, docId, json, ifRevision, writer, limits);
    await audit(tx, writerActor(writer), { action: "shared_document.set", collectionId: collection.id, targetType: "document", targetId: docId, details: { revision: doc.revision, collectionRevision } });
    return { ...doc, collectionRevision };
  });
}

export function deleteShared(db: Db, collection: SharedCollection, docId: string, ifRevision: number | undefined, writer: Writer): Promise<{ deleted: boolean; collectionRevision: number }> {
  return db.transaction(async (tx) => {
    const collectionRevision = await lockAndBumpCollection(tx, collection.id);
    const deleted = await deleteSharedInTx(tx, collection.id, docId, ifRevision);
    await audit(tx, writerActor(writer), { action: "shared_document.deleted", collectionId: collection.id, targetType: "document", targetId: docId, details: { collectionRevision } });
    return { deleted, collectionRevision };
  });
}

/** Bounded atomic bulk refresh. Oversized operations are rejected before any change is made. */
export function bulkShared(db: Db, collection: SharedCollection, ops: BulkOp[], replaceAll: boolean, writer: Writer, limits: Limits): Promise<{ applied: number; collectionRevision: number }> {
  const payloads = ops.map((o) => (o.op === "set" ? validatePayload(o.data, limits) : null));
  return db.transaction(async (tx) => {
    const collectionRevision = await lockAndBumpCollection(tx, collection.id);
    let removed = 0;
    if (replaceAll) {
      const keep = ops.filter((o) => o.op === "set").map((o) => o.id);
      const r = await tx.query(`DELETE FROM shared_documents WHERE ${S_WHERE} AND NOT (doc_id = ANY($2::text[]))`, [collection.id, keep]);
      removed = r.rowCount;
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op === "set") await setSharedInTx(tx, collection.id, op.id, payloads[i]!, op.ifRevision, writer, limits);
      else await deleteSharedInTx(tx, collection.id, op.id, op.ifRevision);
    }
    await audit(tx, writerActor(writer), { action: "shared_document.bulk", collectionId: collection.id, details: { operations: ops.length, replaceAll, removed, collectionRevision } });
    return { applied: ops.length, collectionRevision };
  });
}

// ---------------------------------------------------------------------------------------------
// Updater credentials: scoped, revocable, never able to reach personal storage or publishing.
// ---------------------------------------------------------------------------------------------

export type UpdaterOperation = "read" | "write" | "delete" | "bulk";
const UPDATER_OPS: UpdaterOperation[] = ["read", "write", "delete", "bulk"];

export interface UpdaterCredential {
  id: string;
  label: string;
  token_hash: string;
  created_by: string | null;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  collection_ids: string[];
  operations: UpdaterOperation[];
  last_used_at: Date | null;
}

export async function createUpdaterCredential(
  q: Queryable,
  actor: Actor,
  input: { label: string; collectionIds: string[]; operations: string[]; expiresAt?: Date | null },
): Promise<{ credential: UpdaterCredential; token: string }> {
  const label = input.label.trim().slice(0, 120);
  if (!label) throw badRequest("Label is required");
  if (!input.collectionIds.length) throw badRequest("At least one collection is required");
  for (const id of input.collectionIds) await requireCollection(q, id);
  const operations = input.operations.filter((o): o is UpdaterOperation => (UPDATER_OPS as string[]).includes(o));
  if (!operations.length) throw badRequest(`Operations must include at least one of ${UPDATER_OPS.join(", ")}`);
  const token = newToken("klu");
  const r = await q.query<UpdaterCredential>(
    `INSERT INTO updater_credentials (id, label, token_hash, created_by, expires_at, collection_ids, operations)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING *`,
    [newId(12), label, hashToken(token), actor.id, input.expiresAt ?? null, JSON.stringify(input.collectionIds), JSON.stringify(operations)],
  );
  for (const cid of input.collectionIds) {
    await audit(q, actor, { action: "updater.created", collectionId: cid, targetType: "updater", targetId: r.rows[0].id, details: { operations, expiresAt: input.expiresAt ?? null } });
  }
  return { credential: r.rows[0], token };
}

export async function listUpdaterCredentials(q: Queryable, collectionId?: string): Promise<UpdaterCredential[]> {
  if (collectionId) {
    const r = await q.query<UpdaterCredential>(`SELECT * FROM updater_credentials WHERE collection_ids @> $1::jsonb ORDER BY created_at DESC`, [JSON.stringify([collectionId])]);
    return r.rows;
  }
  return (await q.query<UpdaterCredential>(`SELECT * FROM updater_credentials ORDER BY created_at DESC`)).rows;
}

export async function revokeUpdaterCredential(q: Queryable, actor: Actor, id: string): Promise<UpdaterCredential> {
  const r = await q.query<UpdaterCredential>(`UPDATE updater_credentials SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, actor.id]);
  if (!r.rows.length) throw notFound("Updater credential not found or already revoked");
  for (const cid of r.rows[0].collection_ids) await audit(q, actor, { action: "updater.revoked", collectionId: cid, targetType: "updater", targetId: id });
  return r.rows[0];
}

/** Disables every updater credential; used after restoring a backup into a new installation. */
export async function revokeAllUpdaterCredentials(q: Queryable, actor: Actor, reason: string): Promise<number> {
  const r = await q.query(`UPDATE updater_credentials SET revoked_at = now() WHERE revoked_at IS NULL`);
  await audit(q, actor, { action: "updater.revoked_all", details: { count: r.rowCount, reason } });
  return r.rowCount;
}

export async function authenticateUpdater(q: Queryable, token: string): Promise<UpdaterCredential | null> {
  if (!token.startsWith("klu_")) return null;
  const r = await q.query<UpdaterCredential>(`SELECT * FROM updater_credentials WHERE token_hash = $1`, [hashToken(token)]);
  const cred = r.rows[0];
  if (!cred || cred.revoked_at) return null;
  if (cred.expires_at && new Date(cred.expires_at).getTime() < Date.now()) return null;
  await q.query(`UPDATE updater_credentials SET last_used_at = now() WHERE id = $1`, [cred.id]);
  return cred;
}

export function requireUpdaterScope(cred: UpdaterCredential, collectionId: string, operation: UpdaterOperation): void {
  if (!cred.collection_ids.includes(collectionId)) throw forbidden("This credential is not scoped to that collection");
  if (!cred.operations.includes(operation)) throw forbidden(`This credential may not perform "${operation}"`);
}
