/**
 * Schema migrations. Each entry runs once, in order, inside a transaction.
 * Keep SQL portable between PostgreSQL and PGlite (both are PostgreSQL).
 */
export const migrations: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  team TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_dev_user BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('tool','resource')),
  mode TEXT NOT NULL CHECK (mode IN ('hosted','external')),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  creator_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  team TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'experimental' CHECK (lifecycle IN ('experimental','maintained','retired')),
  repo_url TEXT,
  external_url TEXT,
  replacement_entry_id TEXT REFERENCES entries(id),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason TEXT,
  copied_from_entry_id TEXT REFERENCES entries(id),
  copied_from_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entries_creator_idx ON entries(creator_id);
CREATE INDEX entries_created_idx ON entries(created_at DESC);

CREATE TABLE maintainers (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  added_by TEXT REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, user_id)
);

CREATE TABLE names (
  name TEXT PRIMARY KEY,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  reserved BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_by TEXT REFERENCES users(id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (entry_id IS NOT NULL OR reserved)
);
CREATE INDEX names_entry_idx ON names(entry_id);

CREATE TABLE name_history (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  entry_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('claimed','released','reassigned','reserved','unreserved')),
  actor_id TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX name_history_name_idx ON name_history(name, at DESC);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_count INTEGER NOT NULL,
  total_bytes BIGINT NOT NULL,
  content_hash TEXT NOT NULL,
  manifest JSONB NOT NULL,
  note TEXT,
  source_entry_id TEXT,
  source_version_id TEXT,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  removed_reason TEXT,
  removed_at TIMESTAMPTZ,
  UNIQUE (entry_id, number)
);

CREATE TABLE deployments (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  active_version_id TEXT REFERENCES versions(id),
  publication_revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE deployment_history (
  id SERIAL PRIMARY KEY,
  entry_id TEXT NOT NULL,
  version_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('publish','rollback','copy')),
  actor_id TEXT,
  revision INTEGER NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deployment_history_entry_idx ON deployment_history(entry_id, at DESC);

CREATE TABLE audit_events (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','updater','system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entry_id TEXT,
  collection_id TEXT,
  target_type TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_entry_idx ON audit_events(entry_id, at DESC);
CREATE INDEX audit_collection_idx ON audit_events(collection_id, at DESC);

CREATE TABLE discovery_events (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT,
  session_key TEXT,
  event_type TEXT NOT NULL,
  source_entry_id TEXT,
  target_entry_id TEXT,
  placement INTEGER,
  reason TEXT,
  via TEXT,
  user_team TEXT,
  target_creator_team TEXT
);
CREATE INDEX discovery_user_target_idx ON discovery_events(user_id, target_entry_id, at);
CREATE INDEX discovery_type_idx ON discovery_events(event_type, at);

CREATE TABLE personal_documents (
  installation_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, tool_id, user_id, collection, doc_id)
);

CREATE TABLE shared_collections (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  origin_tool_id TEXT NOT NULL REFERENCES entries(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shared_documents (
  collection_id TEXT NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by_type TEXT NOT NULL,
  updated_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, doc_id)
);

CREATE TABLE collection_bindings (
  tool_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  binding_name TEXT NOT NULL,
  collection_id TEXT NOT NULL REFERENCES shared_collections(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, binding_name)
);
CREATE INDEX collection_bindings_collection_idx ON collection_bindings(collection_id);

CREATE TABLE collection_writer_grants (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('user','tool')),
  subject_id TEXT NOT NULL,
  granted_by TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT
);
CREATE INDEX writer_grants_collection_idx ON collection_writer_grants(collection_id, grant_type, subject_id);

CREATE TABLE updater_credentials (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  collection_ids JSONB NOT NULL,
  operations JSONB NOT NULL,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('portal','tool')),
  pending BOOLEAN NOT NULL DEFAULT FALSE,
  return_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);
`,
  },
  {
    name: "002_team_lock",
    sql: `
ALTER TABLE users ADD COLUMN team_locked BOOLEAN NOT NULL DEFAULT FALSE;
`,
  },
  {
    // Theme plumbing: a tool's declared theme, the theme sniffed from index.html at publish time,
    // and each person's portal and rail preferences. See docs/architecture.md, "Theme resolution".
    name: "003_theme",
    sql: `
ALTER TABLE entries ADD COLUMN theme TEXT CHECK (theme IN ('light','dark','system'));
ALTER TABLE versions ADD COLUMN detected_theme TEXT CHECK (detected_theme IN ('light','dark','system'));
ALTER TABLE users ADD COLUMN theme_pref TEXT NOT NULL DEFAULT 'system' CHECK (theme_pref IN ('light','dark','system'));
ALTER TABLE users ADD COLUMN rail_pref TEXT NOT NULL DEFAULT 'tool' CHECK (rail_pref IN ('tool','light','dark'));
`,
  },
];
