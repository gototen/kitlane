import type { Queryable } from "../db/index.js";
import type { Config } from "../config.js";
import { badRequest } from "../errors.js";
import { newToken, sign, verifySignature } from "../ids.js";
import { portalOrigin, toolOrigin } from "../config.js";
import type { User } from "../types.js";

export const PORTAL_COOKIE = (config: Config) => (config.secureCookies ? "__Host-kitlane_portal" : "kitlane_portal");
export const TOOL_COOKIE = (config: Config) => (config.secureCookies ? "__Host-kitlane_tool" : "kitlane_tool");

export interface SessionRow {
  id: string;
  user_id: string;
  tool_id: string | null;
  kind: "portal" | "tool";
  pending: boolean;
  return_to: string | null;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function ttl(config: Config): Date {
  return new Date(Date.now() + config.sessionTtlSeconds * 1000);
}

/** Development-only portal session. In gateway mode the ingress authenticates the portal. */
export async function createPortalSession(q: Queryable, config: Config, user: User): Promise<string> {
  const id = newToken("kls");
  await q.query(`INSERT INTO sessions (id, user_id, tool_id, kind, pending, expires_at) VALUES ($1, $2, NULL, 'portal', FALSE, $3)`, [id, user.id, ttl(config)]);
  return id;
}

export async function getSessionUser(q: Queryable, sessionId: string, kind: "portal" | "tool", toolId: string | null): Promise<User | null> {
  const r = await q.query<User>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.kind = $2 AND NOT s.pending AND s.expires_at > now() AND ($3::text IS NULL OR s.tool_id = $3)`,
    [sessionId, kind, toolId],
  );
  return r.rows[0] ?? null;
}

export async function deleteSession(q: Queryable, sessionId: string): Promise<void> {
  await q.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export async function pruneSessions(q: Queryable): Promise<number> {
  const r = await q.query(`DELETE FROM sessions WHERE expires_at < now() OR (pending AND created_at < now() - interval '10 minutes')`);
  return r.rowCount;
}

/**
 * Validates where a sign-in round trip may return to: only the portal origin or the specific
 * tool's own origin. Anything else falls back to the portal page for that tool.
 */
export function safeReturnUrl(config: Config, toolId: string, candidate: string | null | undefined): string {
  const fallback = `${portalOrigin(config)}/.tool/${toolId}`;
  if (!candidate) return fallback;
  let url: URL;
  try {
    url = new URL(candidate, portalOrigin(config));
  } catch {
    return fallback;
  }
  if (url.protocol !== config.portalUrl.protocol) return fallback;
  if (url.origin !== portalOrigin(config) && url.origin !== toolOrigin(config, toolId)) return fallback;
  if (url.pathname.startsWith("//")) return fallback;
  return url.toString();
}

/** Portal-only return validation for development login. */
export function safePortalPath(config: Config, candidate: string | null | undefined): string {
  if (!candidate) return "/";
  let url: URL;
  try {
    url = new URL(candidate, portalOrigin(config));
  } catch {
    return "/";
  }
  if (url.origin !== portalOrigin(config) || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search;
}

/**
 * Mints a one-time, short-lived, signed code that lets a tool origin establish its own host-only
 * session for the already-authenticated portal user. The code is bound to the tool.
 */
export async function mintToolAuthCode(q: Queryable, config: Config, user: User, toolId: string, returnTo: string): Promise<string> {
  const id = newToken("klc");
  const expires = new Date(Date.now() + 60_000);
  await q.query(`INSERT INTO sessions (id, user_id, tool_id, kind, pending, return_to, expires_at) VALUES ($1, $2, $3, 'tool', TRUE, $4, $5)`, [id, user.id, toolId, returnTo, expires]);
  const payload = `${id}.${toolId}`;
  return `${payload}.${sign(config.secret, payload)}`;
}

/** Consumes a code on the tool host. Returns the activated session ID and validated return URL. */
export async function consumeToolAuthCode(q: Queryable, config: Config, code: string, toolId: string): Promise<{ sessionId: string; returnTo: string } | null> {
  const parts = code.split(".");
  if (parts.length !== 3) return null;
  const [id, codeTool, sig] = parts;
  if (codeTool !== toolId) return null;
  if (!verifySignature(config.secret, `${id}.${codeTool}`, sig)) return null;
  const r = await q.query<SessionRow>(
    `UPDATE sessions SET pending = FALSE, consumed_at = now(), expires_at = $3
     WHERE id = $1 AND tool_id = $2 AND kind = 'tool' AND pending AND expires_at > now() AND consumed_at IS NULL
     RETURNING *`,
    [id, toolId, ttl(config)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { sessionId: row.id, returnTo: safeReturnUrl(config, toolId, row.return_to) };
}

export function cookieHeader(name: string, value: string, opts: { secure: boolean; sameSite: "Lax" | "None" | "Strict"; maxAge: number }): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", `SameSite=${opts.sameSite}`, `Max-Age=${opts.maxAge}`];
  if (opts.secure || opts.sameSite === "None") parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

export function assertReturnParam(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw badRequest("Invalid return URL");
  return value;
}
