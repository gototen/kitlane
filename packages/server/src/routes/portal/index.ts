import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { portalOrigin, toolOrigin } from "../../config.js";
import type { Env, Services } from "../../context.js";
import { KitlaneError, badRequest, notFound, unauthenticated } from "../../errors.js";
import { checkBrowserOrigin, portalIdentity } from "../../auth/identity.js";
import { PORTAL_COOKIE, assertReturnParam, clearCookieHeader, cookieHeader, createPortalSession, deleteSession, mintToolAuthCode, parseCookies, safePortalPath, safeReturnUrl } from "../../auth/sessions.js";
import { contentTypeFor } from "../../mime.js";
import { getEntry, getEntryByName, listMaintainers } from "../../services/entries.js";
import { getActiveVersion } from "../../services/versions.js";
import { listUsers, upsertUserFromIdentity } from "../../services/users.js";
import { recordDiscoveryEvent } from "../../services/discovery.js";
import { isValidName } from "../../names.js";
import { devLoginPage } from "../../views/pages.js";
import { shellPage } from "../../views/shell.js";
import { pagesApp } from "./pages.js";
import { apiApp } from "./api.js";
import { updaterApp } from "./updater.js";

const RESERVED_QUERY_PREFIX = "_kl";

export function portalApp(services: Services) {
  const { config, db } = services;
  const app = new Hono<Env>();

  // --- Public routes ---
  app.get("/.static/*", (c) => {
    const rel = c.req.path.slice("/.static/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(rel)) throw notFound();
    const full = path.join(config.publicDir, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw notFound();
    c.header("Content-Type", contentTypeFor(rel));
    c.header("Cache-Control", "public, max-age=300");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(fs.readFileSync(full));
  });

  // Used by the TLS ingress for on-demand certificates: is this host one of ours?
  app.get("/.well-known/kitlane/host-check", async (c) => {
    const domain = (c.req.query("domain") ?? "").toLowerCase();
    if (domain === config.portalUrl.hostname) return c.text("ok");
    const suffix = `.${config.toolsDomain.split(":")[0]}`;
    if (domain.endsWith(suffix)) {
      const m = /^app-([a-z0-9]{6,32})$/.exec(domain.slice(0, -suffix.length));
      if (m && (await getEntry(db, m[1]))) return c.text("ok");
    }
    return c.text("unknown host", 404);
  });

  // --- Updater API: scoped bearer credential only; never browser identity ---
  app.route("/.api/updater", updaterApp(services));

  // --- Development identity (local only) ---
  if (config.authMode === "dev") {
    app.get("/.dev/login", async (c) => {
      const users = (await listUsers(db)).filter((u) => u.is_dev_user);
      return c.html(devLoginPage(config, users, safePortalPath(config, c.req.query("rd"))));
    });
    app.post("/.dev/login", async (c) => {
      const body = await c.req.parseBody();
      const rd = safePortalPath(config, typeof body.rd === "string" ? body.rd : null);
      let userId = typeof body.user === "string" ? body.user : null;
      if (!userId && typeof body.new_name === "string" && body.new_name.trim()) {
        const slug = body.new_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
        const u = await upsertUserFromIdentity(
          db,
          config,
          { externalId: `dev:${slug}-${Date.now().toString(36)}`, displayName: body.new_name.trim(), email: `${slug}@example.test`, team: typeof body.new_team === "string" && body.new_team.trim() ? body.new_team.trim() : null },
          { devUser: true },
        );
        if (body.new_admin === "1") await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [u.id]);
        userId = u.id;
      }
      if (!userId) throw badRequest("Pick a user");
      const r = await db.query(`SELECT * FROM users WHERE id = $1 AND is_dev_user`, [userId]);
      if (!r.rows[0]) throw badRequest("Unknown development user");
      const sid = await createPortalSession(db, config, r.rows[0]);
      c.header("Set-Cookie", cookieHeader(PORTAL_COOKIE(config), sid, { secure: config.secureCookies, sameSite: "Lax", maxAge: config.sessionTtlSeconds }));
      return c.redirect(rd, 303);
    });
    app.post("/.dev/logout", async (c) => {
      const sid = parseCookies(c.req.header("cookie"))[PORTAL_COOKIE(config)];
      if (sid) await deleteSession(db, sid);
      c.header("Set-Cookie", clearCookieHeader(PORTAL_COOKIE(config), config.secureCookies));
      return c.redirect("/.dev/login", 303);
    });
  }

  // --- Identity for everything else ---
  app.use("*", async (c, next) => {
    const p = c.req.path;
    const isCli = p.startsWith("/.api/cli/");
    const identity = await portalIdentity(c, config, db, { allowBearer: isCli, allowBrowser: !isCli });
    c.set("identity", identity);
    if (!identity) {
      if (p.startsWith("/.api/")) throw unauthenticated();
      if (config.authMode === "dev") return c.redirect(`/.dev/login?rd=${encodeURIComponent(p + new URL(c.req.url).search)}`, 302);
      throw unauthenticated("The trusted gateway did not supply an identity");
    }
    // Browser-origin check for mutations (CLI bearer requests are exempt: they have no ambient cookie).
    if (!isCli && c.req.method !== "GET" && c.req.method !== "HEAD" && !checkBrowserOrigin(c, portalOrigin(config))) {
      throw new KitlaneError("forbidden", "Cross-origin request rejected");
    }
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!p.startsWith("/.api/")) {
      c.header("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src ${toolOrigin(config, "*").replace("app-*", "*")}; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`);
    }
    await next();
  });

  // --- Sign-in round trip start: mint a one-time code for the tool origin ---
  app.get("/.auth/start", async (c) => {
    const identity = c.get("identity")!;
    const toolId = c.req.query("tool") ?? "";
    const entry = await getEntry(db, toolId);
    if (!entry || entry.mode !== "hosted") throw notFound("Unknown tool");
    if (entry.frozen) throw new KitlaneError("frozen", "This tool is frozen");
    const rd = safeReturnUrl(config, entry.id, assertReturnParam(c.req.query("rd")));
    const code = await mintToolAuthCode(db, config, identity.user, entry.id, rd);
    return c.redirect(`${toolOrigin(config, entry.id)}/.auth/callback?code=${encodeURIComponent(code)}`, 302);
  });

  app.route("/.api", apiApp(services));
  app.route("/", pagesApp(services));

  // --- Name resolution: kit/<name> and kit/<name>/path ---
  app.get("/:name", (c) => resolveName(c, c.req.param("name"), ""));
  app.get("/:name/*", (c) => {
    const name = c.req.param("name");
    return resolveName(c, name, c.req.path.slice(name.length + 2));
  });

  async function resolveName(c: any, rawName: string, rest: string) {
    if (rawName.startsWith(".") || rawName.startsWith("_")) throw notFound();
    const name = rawName.toLowerCase();
    const identity = c.get("identity")!;
    const entry = await getEntryByName(db, name);
    if (!entry) {
      if (!isValidName(rawName)) throw notFound();
      // Merely visiting an unknown name never creates it: show search + an option to claim.
      return c.redirect(`/.search?q=${encodeURIComponent(name)}&claim=1`, 302);
    }
    if (entry.frozen && entry.mode === "hosted") {
      return c.redirect(`/.tool/${entry.id}`, 302);
    }
    if (entry.mode === "external") {
      if (entry.frozen) return c.redirect(`/.tool/${entry.id}`, 302);
      recordDiscoveryEvent(db, { type: "portal_launched", userId: identity.user.id, sessionKey: null, targetEntryId: entry.id, via: "redirect", userTeam: identity.user.team }).catch(() => undefined);
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      return c.redirect(entry.external_url!, 302);
    }
    const active = await getActiveVersion(db, entry.id);
    if (!active) return c.redirect(`/.tool/${entry.id}`, 302);
    const url = new URL(c.req.url);
    const forwarded = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (!k.startsWith(RESERVED_QUERY_PREFIX)) forwarded.append(k, v);
    const qs = forwarded.toString();
    const safeRest = rest.split("/").filter((s) => s && s !== "." && s !== "..").join("/");
    const iframeSrc = `${toolOrigin(config, entry.id)}/_releases/${active.id}/${safeRest || "index.html"}${qs ? "?" + qs : ""}`;
    const directUrl = `${toolOrigin(config, entry.id)}/${safeRest}${qs ? "?" + qs : ""}`;
    const maintainers = (await listMaintainers(db, entry.id)).map((m) => m.display_name);
    const replacement = entry.replacement_entry_id ? await getEntry(db, entry.replacement_entry_id) : null;
    return c.html(shellPage(config, { entry, iframeSrc, directUrl, maintainers, replacement, userName: identity.user.display_name }));
  }

  return app;
}
