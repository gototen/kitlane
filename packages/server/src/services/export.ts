import type { Queryable } from "../db/index.js";

/**
 * Employee-facing JSON export. Preserves catalog entries, names, ownership references, lineage,
 * and shared-collection bindings. Never includes other users' personal records, credentials,
 * tokens, or sessions. A full operator backup is a separate, protected procedure.
 */
export async function buildExport(q: Queryable, opts: { includeSharedDocuments: boolean; requestedBy: string }) {
  const [entries, names, nameHistory, maintainers, versions, deployments, bindings, collections, grants, users] = await Promise.all([
    q.query(`SELECT * FROM entries ORDER BY created_at`),
    q.query(`SELECT name, entry_id, reserved, claimed_by, claimed_at FROM names ORDER BY name`),
    q.query(`SELECT * FROM name_history ORDER BY at`),
    q.query(`SELECT entry_id, user_id, added_at FROM maintainers`),
    q.query(`SELECT id, entry_id, number, created_by, created_at, file_count, total_bytes, content_hash, manifest, note, source_entry_id, source_version_id, removed FROM versions ORDER BY created_at`),
    q.query(`SELECT * FROM deployments`),
    q.query(`SELECT * FROM collection_bindings`),
    q.query(`SELECT id, installation_id, origin_tool_id, owner_id, name, description, revision, frozen, created_at, updated_at FROM shared_collections`),
    q.query(`SELECT id, collection_id, grant_type, subject_id, granted_by, granted_at, revoked_at FROM collection_writer_grants`),
    q.query(`SELECT id, external_id, display_name, team FROM users`),
  ]);
  const sharedDocuments = opts.includeSharedDocuments
    ? (await q.query(`SELECT collection_id, doc_id, payload, revision, updated_by_type, updated_by_id, created_at, updated_at FROM shared_documents WHERE collection_id IN (SELECT id FROM shared_collections WHERE NOT frozen) ORDER BY collection_id, doc_id`)).rows
    : undefined;
  return {
    format: "kitlane-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    requestedBy: opts.requestedBy,
    excludes: ["personal_documents", "updater_credentials", "access_tokens", "sessions", "audit_events", "discovery_events", "deployed files"],
    users: users.rows,
    entries: entries.rows,
    names: names.rows,
    nameHistory: nameHistory.rows,
    maintainers: maintainers.rows,
    versions: versions.rows,
    deployments: deployments.rows,
    collectionBindings: bindings.rows,
    sharedCollections: collections.rows,
    collectionWriterGrants: grants.rows,
    ...(sharedDocuments ? { sharedDocuments } : {}),
  };
}
