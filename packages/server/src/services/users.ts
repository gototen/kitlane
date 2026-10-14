import type { Queryable } from "../db/index.js";
import type { Config } from "../config.js";
import { badRequest } from "../errors.js";
import { newId } from "../ids.js";
import type { RailPref, ThemeSetting, User } from "../types.js";
import { isRailPref, isThemeSetting } from "./theme.js";

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
      `UPDATE users SET display_name = $2, email = COALESCE($3, email),
         team = CASE WHEN team_locked THEN team ELSE COALESCE($4, team) END,
         is_admin = (is_admin OR $5), last_seen_at = now()
       WHERE id = $1 RETURNING *`,
      [existing.id, displayName, claims.email ?? null, claims.team ?? null, admin],
    );
    return r.rows[0];
  }
  if (!opts.devUser && claims.email) {
    // A synthetic (seeded) user with the same email is adopted by the first real sign-in, so the
    // demonstration tools get a real owner. Only rows marked is_dev_user are eligible.
    const seeded = await q.query<User>(`SELECT * FROM users WHERE lower(email) = lower($1) AND is_dev_user LIMIT 1`, [claims.email]);
    if (seeded.rows[0]) {
      const r = await q.query<User>(
        `UPDATE users SET external_id = $2, display_name = $3,
           team = CASE WHEN team_locked THEN team ELSE COALESCE($4, team) END,
           is_admin = (is_admin OR $5), is_dev_user = FALSE, last_seen_at = now()
         WHERE id = $1 RETURNING *`,
        [seeded.rows[0].id, claims.externalId, displayName, claims.team ?? null, admin],
      );
      return r.rows[0];
    }
  }
  const r = await q.query<User>(
    `INSERT INTO users (id, external_id, display_name, email, team, is_admin, is_dev_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [newId(10), claims.externalId, displayName, claims.email ?? null, claims.team ?? null, admin, opts.devUser ?? false],
  );
  return r.rows[0];
}

/**
 * Administrator-assigned team. Used when the identity provider supplies no team (for example a
 * usability study with personal accounts). A locked team is kept on later sign-ins; clearing it
 * unlocks the field so the provider's claim applies again. Reports must label assigned teams.
 */
export async function setUserTeam(q: Queryable, userId: string, team: string | null): Promise<void> {
  const value = team ? team.trim().toLowerCase().slice(0, 80) : null;
  await q.query(`UPDATE users SET team = $2, team_locked = $3 WHERE id = $1`, [userId, value, value !== null]);
}

export async function listRecentUsers(q: Queryable, limit = 50): Promise<User[]> {
  return (await q.query<User>(`SELECT * FROM users ORDER BY last_seen_at DESC LIMIT $1`, [limit])).rows;
}

export async function setAdmin(q: Queryable, userId: string, isAdmin: boolean): Promise<void> {
  await q.query(`UPDATE users SET is_admin = $2 WHERE id = $1`, [userId, isAdmin]);
}

export interface UserPreferences {
  /** Portal theme: light, dark, or system (follow the OS). */
  themePref?: ThemeSetting;
  /** Rail theme: tool (match the framed tool), or always light or dark. */
  railPref?: RailPref;
}

/** Per-person theme preferences. Values are validated here because they arrive from forms. */
export async function setUserPreferences(q: Queryable, userId: string, prefs: UserPreferences): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [userId];
  if (prefs.themePref !== undefined) {
    if (!isThemeSetting(prefs.themePref)) throw badRequest('Theme preference must be "light", "dark", or "system"');
    params.push(prefs.themePref);
    sets.push(`theme_pref = $${params.length}`);
  }
  if (prefs.railPref !== undefined) {
    if (!isRailPref(prefs.railPref)) throw badRequest('Rail preference must be "tool", "light", or "dark"');
    params.push(prefs.railPref);
    sets.push(`rail_pref = $${params.length}`);
  }
  if (!sets.length) return;
  await q.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);
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
