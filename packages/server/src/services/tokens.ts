import type { Queryable } from "../db/index.js";
import { badRequest, notFound } from "../errors.js";
import { hashToken, newId, newToken } from "../ids.js";
import type { Actor, User } from "../types.js";
import { audit } from "./audit.js";

export interface AccessToken {
  id: string;
  user_id: string;
  label: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

/** Personal access tokens for the CLI. Distinct from browser sessions; shown once at creation. */
export async function createAccessToken(q: Queryable, actor: Actor, user: User, label: string, expiresInDays = 90): Promise<{ token: string; record: AccessToken }> {
  const l = label.trim().slice(0, 120);
  if (!l) throw badRequest("Label is required");
  const token = newToken("klp");
  const expires = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400_000) : null;
  const r = await q.query<AccessToken>(
    `INSERT INTO access_tokens (id, user_id, label, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId(12), user.id, l, hashToken(token), expires],
  );
  await audit(q, actor, { action: "token.created", targetType: "token", targetId: r.rows[0].id, details: { label: l, expiresAt: expires } });
  return { token, record: r.rows[0] };
}

export async function listAccessTokens(q: Queryable, userId: string): Promise<AccessToken[]> {
  return (await q.query<AccessToken>(`SELECT * FROM access_tokens WHERE user_id = $1 ORDER BY created_at DESC`, [userId])).rows;
}

export async function revokeAccessToken(q: Queryable, actor: Actor, userId: string, id: string): Promise<void> {
  const r = await q.query(`UPDATE access_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, userId]);
  if (!r.rowCount) throw notFound("Token not found");
  await audit(q, actor, { action: "token.revoked", targetType: "token", targetId: id });
}

export async function authenticateAccessToken(q: Queryable, token: string): Promise<User | null> {
  if (!token.startsWith("klp_")) return null;
  const r = await q.query<User & { token_id: string; expires_at: Date | null; revoked_at: Date | null }>(
    `SELECT u.*, t.id AS token_id, t.expires_at, t.revoked_at FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  await q.query(`UPDATE access_tokens SET last_used_at = now() WHERE id = $1`, [row.token_id]);
  const { token_id: _t, expires_at: _e, revoked_at: _r, ...user } = row;
  return user as User;
}
