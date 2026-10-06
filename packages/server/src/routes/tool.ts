import { Hono } from "hono";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { entryIdFromHost, portalOrigin, toolOrigin } from "../config.js";
import type { Env, Services } from "../context.js";
import { KitlaneError, badRequest, forbidden, notFound, unauthenticated } from "../errors.js";
import { contentTypeFor } from "../mime.js";
import { checkBrowserOrigin, toolIdentity } from "../auth/identity.js";
import { TOOL_COOKIE, consumeToolAuthCode, cookieHeader } from "../auth/sessions.js";
import { getEntry } from "../services/entries.js";
import { getActiveVersion, getVersion } from "../services/versions.js";
import { recordDiscoveryEvent } from "../services/discovery.js";
import { publicIdentity } from "../services/users.js";
import * as docs from "../services/documents.js";
import { bootstrapAuthPage, frozenPage } from "../views/pages.js";
import type { EntryWithNames, Version } from "../types.js";

function hostedHeaders(services: Services, entry: EntryWithNames, version: Version | null, isHtml: boolean): Record<string, string> {
  const { config } = services;
  const h = config.hosted;
  const join = (base: string[], extra: string[]) => [...base, ...extra].join(" ");
  const csp = [
    `default-src 'self'`,
    `script-src ${join(["'self'", "'unsafe-inline'"], h.scriptSrc)}`,
    `style-src ${join(["'self'", "'unsafe-inline'"], h.styleSrc)}`,
    `img-src ${join(["'self'", "data:", "blob:"], h.imgSrc)}`,
    `font-src ${join(["'self'", "data:"], h.fontSrc)}`,
    `connect-src ${join(["'self'"], h.connectSrc)}`,
    `media-src 'self' data: blob:`,
    `worker-src 'self' blob:`,
    `frame-src ${h.frameSrc.length ? h.frameSrc.join(" ") : "'none'"}`,
    `frame-ancestors 'self' ${portalOrigin(config)}`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": h.permissionsPolicy,
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": isHtml ? "no-store" : "private, max-age=3600",
    "X-Kitlane-Tool": entry.id,
    ...(version ? { "X-Kitlane-Version": version.id } : {}),
  };
}

function apiHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
}

export function toolApp(services: Services) {
  const { config, db, storage, limiter } = services;
  const app = new Hono<Env>();

  // Resolve the tool from the host and load identity. The host is set by trusted routing.
  app.use("*", async (c, next) => {
    const entryId = entryIdFromHost(config, new URL(c.req.url).host);
    if (!entryId) throw notFound("Unknown tool host");
    const entry = await getEntry(db, entryId);
    if (!entry || entry.mode !== "hosted") throw notFound("Unknown tool host");
    c.set("entry", entry);
    c.set("identity", await toolIdentity(c, config, db, entry.id));
    await next();
  });

  // --- Sign-in round trip: the portal mints a one-time code; this host sets its own cookie. ---
  app.get("/.auth/callback", async (c) => {
    const entry = c.get("entry");
    const code = c.req.query("code") ?? "";
    const result = await consumeToolAuthCode(db, config, code, entry.id);
    if (!result) {
      return c.html(bootstrapAuthPage(config, entry, `${portalOrigin(config)}/.auth/start?tool=${entry.id}&rd=${encodeURIComponent(toolOrigin(config, entry.id) + "/")}`, "That sign-in link expired. Continue to sign in again."), 400);
    }
    c.header("Set-Cookie", cookieHeader(TOOL_COOKIE(config), result.sessionId, { secure: config.secureCookies, sameSite: config.toolCookieSameSite, maxAge: config.sessionTtlSeconds }));
    c.header("Cache-Control", "no-store");
    return c.redirect(result.returnTo, 303);
  });

  // --- SDK script: served on every tool origin; hosted files can never shadow it. ---
  app.get("/._kitlane/sdk.js", (c) => serveSdk(c, "sdk.js"));
  app.get("/._kitlane/sdk.mjs", (c) => serveSdk(c, "sdk.mjs"));
  function serveSdk(c: any, file: string) {
    const full = path.join(config.publicDir, file);
    if (!fs.existsSync(full)) return c.text("SDK bundle not built. Run `npm run build` in the repository.", 500);
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(fs.readFileSync(full));
  }

  app.get("/._kitlane/session", (c) => {
    for (const [k, v] of Object.entries(apiHeaders())) c.header(k, v);
    return c.json({ authenticated: Boolean(c.get("identity")), tool: c.get("entry").id });
  });

  // --- Everything under /._kitlane/ (except the SDK and session probe) needs identity + freeze gate ---
  app.use("/._kitlane/*", async (c, next) => {
    if (c.req.path === "/._kitlane/session" || c.req.path.startsWith("/._kitlane/sdk.")) return next();
    const entry = c.get("entry");
    for (const [k, v] of Object.entries(apiHeaders())) c.header(k, v);
    if (entry.frozen) throw new KitlaneError("frozen", "This tool has been frozen by an administrator");
    const identity = c.get("identity");
    if (!identity) throw unauthenticated();
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!checkBrowserOrigin(c, toolOrigin(config, entry.id))) throw forbidden("Cross-origin request rejected");
      const ct = c.req.header("content-type") ?? "";
      if (!ct.includes("application/json")) throw badRequest("Send application/json");
    }
    if (!limiter.hit(`${entry.id}:${identity.user.id}`)) throw new KitlaneError("rate_limited", "Too many requests; slow down");
    await next();
  });

  app.get("/._kitlane/me", (c) => c.json(publicIdentity(c.get("identity")!.user, config)));

  app.get("/._kitlane/tool", async (c) => {
    const entry = c.get("entry");
    const identity = c.get("identity")!;
    const version = await getActiveVersion(db, entry.id);
    const bindings = await docs.listBindings(db, entry.id);
    const out = [] as { name: string; collectionId: string; canWrite: boolean; frozen: boolean; revision: number }[];
    for (const b of bindings) {
      const col = await docs.getCollection(db, b.collection_id);
      const decision = col ? await docs.decideBrowserWrite(db, col, identity.user, entry.id) : null;
      out.push({ name: b.binding_name, collectionId: b.collection_id, canWrite: Boolean(decision?.allowed), frozen: b.frozen, revision: b.revision });
    }
    return c.json({
      id: entry.id,
      names: entry.names,
      title: entry.title,
      purpose: entry.purpose,
      lifecycle: entry.lifecycle,
      version: version ? { id: version.id, number: version.number } : null,
      bindings: out,
      capabilities: { ai: false, personalStorage: true, sharedCollections: true },
      portalUrl: portalOrigin(config),
      shortcut: config.shortcut,
    });
  });

  app.all("/._kitlane/ai/*", () => {
    throw new KitlaneError("capability_unavailable", "AI is not enabled on this installation. See docs/deferred/ai-adapter.md.");
  });
  app.all("/._kitlane/ai", () => {
    throw new KitlaneError("capability_unavailable", "AI is not enabled on this installation. See docs/deferred/ai-adapter.md.");
  });

  // --- Personal documents ---
  const scopeOf = (c: any, collection: string): docs.PersonalScope => ({
    installationId: config.installationId,
    toolId: c.get("entry").id,
    userId: c.get("identity")!.user.id,
    collection,
  });

  function listOpts(c: any): docs.ListOptions {
    const q = c.req.query();
    const whereRaw = c.req.queries("where") ?? [];
    return {
      limit: q.limit ? Number(q.limit) : undefined,
      cursor: q.cursor ?? null,
      where: docs.parseFilters(whereRaw.length ? whereRaw : undefined),
      orderBy: q.orderBy ?? null,
      order: q.order === "desc" ? "desc" : "asc",
    };
  }

  async function readJson(c: any): Promise<any> {
    try {
      return await c.req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
  }

  function ifRevisionOf(body: any, c: any): number | undefined {
    const header = c.req.header("if-match");
    const v = body?.ifRevision ?? (header ? Number(header.replace(/W\/|"/g, "")) : undefined);
    if (v === undefined || v === null) return undefined;
    if (!Number.isInteger(v) || v < 0) throw badRequest("ifRevision must be a non-negative integer");
    return v;
  }

  app.get("/._kitlane/data/user/:collection", async (c) => {
    const result = await docs.listPersonal(db, scopeOf(c, c.req.param("collection")), listOpts(c), config.limits);
    return c.json(result);
  });
  app.post("/._kitlane/data/user/:collection/_bulk", async (c) => {
    const body = await readJson(c);
    const ops = docs.validateBulk(body?.ops, config.limits);
    const result = await docs.bulkPersonal(db, scopeOf(c, c.req.param("collection")), ops, Boolean(body?.replaceAll), config.limits);
    return c.json(result);
  });
  app.get("/._kitlane/data/user/:collection/:docId", async (c) => {
    const doc = await docs.getPersonal(db, scopeOf(c, c.req.param("collection")), c.req.param("docId"));
    if (!doc) throw notFound("Document not found");
    return c.json(doc);
  });
  app.put("/._kitlane/data/user/:collection/:docId", async (c) => {
    const body = await readJson(c);
    const doc = await docs.setPersonal(db, scopeOf(c, c.req.param("collection")), c.req.param("docId"), body?.data, ifRevisionOf(body, c), config.limits);
    return c.json(doc);
  });
  app.delete("/._kitlane/data/user/:collection/:docId", async (c) => {
    const body = c.req.header("content-length") && c.req.header("content-length") !== "0" ? await readJson(c) : {};
    const deleted = await docs.deletePersonal(db, scopeOf(c, c.req.param("collection")), c.req.param("docId"), ifRevisionOf(body, c));
    return c.json({ deleted });
  });

  // --- Shared collections (through this tool's bindings) ---
  async function bindingOf(c: any): Promise<docs.SharedCollection> {
    const col = await docs.resolveBinding(db, c.get("entry").id, c.req.param("binding"));
    if (!col) throw notFound(`This tool has no binding named "${c.req.param("binding")}"`);
    return col;
  }
  async function writerOf(c: any, col: docs.SharedCollection): Promise<docs.Writer> {
    const decision = await docs.decideBrowserWrite(db, col, c.get("identity")!.user, c.get("entry").id);
    docs.requireWrite(decision);
    return { type: "user", id: c.get("identity")!.user.id };
  }

  app.get("/._kitlane/data/shared/:binding/_meta", async (c) => {
    const col = await bindingOf(c);
    const decision = await docs.decideBrowserWrite(db, col, c.get("identity")!.user, c.get("entry").id);
    return c.json({ collectionId: col.id, name: col.name, description: col.description, revision: col.revision, frozen: col.frozen, canWrite: decision.allowed, writeBlockedReason: decision.reason, ownerId: col.owner_id, originToolId: col.origin_tool_id });
  });
  app.get("/._kitlane/data/shared/:binding", async (c) => {
    const col = await bindingOf(c);
    const etag = `W/"${col.revision}"`;
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const result = await docs.listShared(db, col, listOpts(c), config.limits);
    c.header("ETag", etag);
    return c.json(result);
  });
  app.post("/._kitlane/data/shared/:binding/_bulk", async (c) => {
    const col = await bindingOf(c);
    const writer = await writerOf(c, col);
    const body = await readJson(c);
    const ops = docs.validateBulk(body?.ops, config.limits);
    return c.json(await docs.bulkShared(db, col, ops, Boolean(body?.replaceAll), writer, config.limits));
  });
  app.get("/._kitlane/data/shared/:binding/:docId", async (c) => {
    const col = await bindingOf(c);
    const doc = await docs.getShared(db, col, c.req.param("docId"));
    if (!doc) throw notFound("Document not found");
    return c.json(doc);
  });
  app.put("/._kitlane/data/shared/:binding/:docId", async (c) => {
    const col = await bindingOf(c);
    const writer = await writerOf(c, col);
    const body = await readJson(c);
    return c.json(await docs.setShared(db, col, c.req.param("docId"), body?.data, ifRevisionOf(body, c), writer, config.limits));
  });
  app.delete("/._kitlane/data/shared/:binding/:docId", async (c) => {
    const col = await bindingOf(c);
    const writer = await writerOf(c, col);
    const body = c.req.header("content-length") && c.req.header("content-length") !== "0" ? await readJson(c) : {};
    return c.json(await docs.deleteShared(db, col, c.req.param("docId"), ifRevisionOf(body, c), writer));
  });

  // --- Hosted assets ---
  async function requireAssetAccess(c: any, entry: EntryWithNames) {
    const dest = (c.req.header("sec-fetch-dest") ?? "").toLowerCase();
    if (entry.frozen) {
      return c.html(frozenPage(config, entry), 423, hostedHeaders(services, entry, null, true));
    }
    if (!c.get("identity")) {
      const here = toolOrigin(config, entry.id) + c.req.path + (new URL(c.req.url).search || "");
      const start = `${portalOrigin(config)}/.auth/start?tool=${entry.id}&rd=${encodeURIComponent(here)}`;
      if (dest === "iframe" || dest === "frame") {
        return c.html(bootstrapAuthPage(config, entry, start), 200, { ...hostedHeaders(services, entry, null, true), "Cache-Control": "no-store" });
      }
      if (dest === "" || dest === "document" || dest === "empty") {
        c.header("Cache-Control", "no-store");
        return c.redirect(start, 302);
      }
      return c.text("Sign in required", 401, { "Cache-Control": "no-store" });
    }
    return null;
  }

  app.get("/_releases/:versionId/*", async (c) => {
    const entry = c.get("entry");
    const blocked = await requireAssetAccess(c, entry);
    if (blocked) return blocked;
    const version = await getVersion(db, c.req.param("versionId"));
    if (!version || version.entry_id !== entry.id || version.removed) throw notFound("Release not found");
    let rel = decodeURIComponent(c.req.path.slice(`/_releases/${version.id}/`.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let file = await storage.openFile(entry.id, version.id, rel);
    let served = rel;
    if (!file && !path.posix.basename(rel).includes(".")) {
      // Single-page apps: unknown extensionless paths fall back to the release entry page.
      file = await storage.openFile(entry.id, version.id, "index.html");
      served = "index.html";
    }
    if (!file) throw notFound("File not found in this release");
    const isHtml = contentTypeFor(served).startsWith("text/html");
    const headers = { ...hostedHeaders(services, entry, version, isHtml), "Content-Type": contentTypeFor(served), "Content-Length": String(file.size) };
    if (isHtml && served === "index.html") {
      const dest = (c.req.header("sec-fetch-dest") ?? "").toLowerCase();
      const identity = c.get("identity")!;
      recordDiscoveryEvent(db, {
        type: "tool_accessed",
        userId: identity.user.id,
        sessionKey: null,
        targetEntryId: entry.id,
        via: dest === "iframe" || dest === "frame" ? "shell" : "direct",
        userTeam: identity.user.team,
      }).catch((err) => console.error("[kitlane] discovery event failed", err));
    }
    return new Response(Readable.toWeb(file.stream) as ReadableStream, { status: 200, headers });
  });

  // Unversioned launch: resolve to the active release with a non-cacheable redirect.
  app.get("/*", async (c) => {
    const entry = c.get("entry");
    if (c.req.path.startsWith("/._kitlane/") || c.req.path.startsWith("/.auth/")) throw notFound();
    const blocked = await requireAssetAccess(c, entry);
    if (blocked) return blocked;
    const active = await getActiveVersion(db, entry.id);
    if (!active) return c.html(frozenPage(config, entry, "This tool has no published version yet."), 404, hostedHeaders(services, entry, null, true));
    const rest = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
    const search = new URL(c.req.url).search;
    c.header("Cache-Control", "no-store");
    return c.redirect(`/_releases/${active.id}/${rest}${search}`, 302);
  });

  return app;
}
