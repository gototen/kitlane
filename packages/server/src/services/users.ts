import type { Queryable } from "../db/index.js";
import type { Config } from "../config.js";
import { newId } from "../ids.js";
import type { User } from "../types.js";

export interface IdentityClaims {
  externalId: string;
  displayName?: string | null;
  email?: string | null;
  team?: string | null;
}

export async function getUser(q: Queryable, id: string): Promise<User | null> {
  const r = await q.query<User>(`SELECT * FROM users WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getUserByExternalId(q: Queryable, externalId: string): Promise<User | null> {
  const r = await q.query<User>(`SELECT * FROM users WHERE external_id = $1`, [externalId]);
  return r.rows[0] ?? null;
}

export async function listUsers(q: Queryable): Promise<User[]> {
  return (await q.query<User>(`SELECT * FROM users ORDER BY display_name`)).rows;
}

export async function findUserByHandle(q: Queryable, handle: string): Promise<User | null> {
  const r = await q.query<User>(
    `SELECT * FROM users WHERE id = $1 OR external_id = $1 OR lower(email) = lower($1) LIMIT 1`,
    [handle],
  );
  return r.rows[0] ?? null;
}

function isConfiguredAdmin(config: Config, claims: IdentityClaims): boolean {
  const candidates = [claims.externalId, claims.email ?? ""].map((s) => s.toLowerCase()).filter(Boolean);
  return candidates.some((c) => config.adminUsers.has(c));
}

/**
 * Creates or refreshes the cached identity for a user authenticated by the trusted gateway
 * (or the development identity). Team data is only stored when the gateway supplies it.
 */
export async function upsertUserFromIdentity(q: Queryable, config: Config, claims: IdentityClaims, opts: { devUser?: boolean } = {}): Promise<User> {
  const existing = await getUserByExternalId(q, claims.externalId);
  const displayName = (claims.displayName || claims.email?.split("@")[0] || claims.externalId).slice(0, 120);
  const admin = isConfiguredAdmin(config, claims);
  if (existing) {
    const r = await q.query<User>(
      `UPDATE users SET display_name = $2, email = COALESCE($3, email), team = COALESCE($4, team),
         is_admin = (is_admin OR $5), last_seen_at = now()
       WHERE id = $1 RETURNING *`,
      [existing.id, displayName, claims.email ?? null, claims.team ?? null, admin],
    );
    return r.rows[0];
  }
  const r = await q.query<User>(
    `INSERT INTO users (id, external_id, display_name, email, team, is_admin, is_dev_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [newId(10), claims.externalId, displayName, claims.email ?? null, claims.team ?? null, admin, opts.devUser ?? false],
  );
  return r.rows[0];
}

export async function setAdmin(q: Queryable, userId: string, isAdmin: boolean): Promise<void> {
  await q.query(`UPDATE users SET is_admin = $2 WHERE id = $1`, [userId, isAdmin]);
}

/** Minimal identity exposed to hosted tools through kitlane.me(). */
export function publicIdentity(user: User, config: Config) {
  return {
    id: user.id,
    displayName: user.display_name,
    ...(user.team ? { team: user.team } : {}),
    ...(config.exposeEmail && user.email ? { email: user.email } : {}),
  };
}
