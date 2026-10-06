import { createHmac } from "node:crypto";
import type { Context } from "hono";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { safeEqual } from "../ids.js";
import { upsertUserFromIdentity } from "../services/users.js";
import { authenticateAccessToken } from "../services/tokens.js";
import type { User } from "../types.js";
import { PORTAL_COOKIE, TOOL_COOKIE, getSessionUser, parseCookies } from "./sessions.js";

export type AuthSource = "gateway" | "dev-session" | "token" | "tool-session";

export interface Identity {
  user: User;
  source: AuthSource;
  sessionKey: string | null;
}

/**
 * Identity on the portal host. In gateway mode the only accepted evidence is the ingress-supplied
 * headers, and only when the ingress secret matches. In dev mode a host-only dev session cookie is
 * used. Bearer tokens are accepted only on CLI API routes.
 */
export async function portalIdentity(c: Context, config: Config, db: Db, opts: { allowBearer: boolean; allowBrowser: boolean }): Promise<Identity | null> {
  if (opts.allowBearer) {
    const auth = c.req.header("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) {
      const user = await authenticateAccessToken(db, auth.slice(7).trim());
      return user ? { user, source: "token", sessionKey: null } : null;
    }
  }
  if (!opts.allowBrowser) return null;
  if (config.authMode === "gateway") {
    const supplied = c.req.header("x-kitlane-ingress-secret");
    if (!supplied || !config.ingressSecret || !safeEqual(supplied, config.ingressSecret)) return null;
    const externalId = c.req.header(config.identityHeaders.user);
    if (!externalId) return null;
    const teamHeader = c.req.header(config.identityHeaders.team);
    const team = teamHeader ? teamHeader.split(",")[0].trim() || null : null;
    const user = await upsertUserFromIdentity(db, config, {
      externalId,
      email: c.req.header(config.identityHeaders.email) ?? null,
      displayName: c.req.header(config.identityHeaders.name) ?? null,
      team,
    });
    return { user, source: "gateway", sessionKey: externalId };
  }
  const cookies = parseCookies(c.req.header("cookie"));
  const sid = cookies[PORTAL_COOKIE(config)];
  if (!sid) return null;
  const user = await getSessionUser(db, sid, "portal", null);
  return user ? { user, source: "dev-session", sessionKey: sid } : null;
}

/** Identity on a tool host: only the host-only tool session for this specific tool counts. */
export async function toolIdentity(c: Context, config: Config, db: Db, toolId: string): Promise<Identity | null> {
  const cookies = parseCookies(c.req.header("cookie"));
  const sid = cookies[TOOL_COOKIE(config)];
  if (!sid) return null;
  const user = await getSessionUser(db, sid, "tool", toolId);
  return user ? { user, source: "tool-session", sessionKey: sid } : null;
}

/** Pseudonymous key for discovery analytics; never the raw session or external identifier. */
export function pseudonymousSessionKey(identity: Identity | null, config: Config): string | null {
  if (!identity?.sessionKey) return null;
  return createHmac("sha256", config.secret).update(`sess:${identity.sessionKey}`).digest("base64url").slice(0, 24);
}

/** Browser mutations must originate from the expected origin. Supplements authentication. */
export function checkBrowserOrigin(c: Context, expectedOrigin: string): boolean {
  const origin = c.req.header("origin");
  if (origin) return origin === expectedOrigin;
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const referer = c.req.header("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return false;
}
