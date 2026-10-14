import { Hono } from "hono";
import { Readable } from "node:stream";
import { portalOrigin, toolOrigin } from "../../config.js";
import type { Env, Services } from "../../context.js";
import { KitlaneError, badRequest, forbidden, notFound } from "../../errors.js";
import { userActor } from "../../types.js";
import * as entries from "../../services/entries.js";
import * as names from "../../services/names.js";
import * as versions from "../../services/versions.js";
import * as docs from "../../services/documents.js";
import { recommendFor, searchEntries } from "../../services/search.js";
import { recordDiscoveryEvent } from "../../services/discovery.js";
import { findUserByHandle, getUser, publicIdentity } from "../../services/users.js";
import { pseudonymousSessionKey } from "../../auth/identity.js";
import { drawerFragment } from "../../views/portal.js";
import { buildExport } from "../../services/export.js";

function entryJson(config: any, e: entries.CreateEntryInput extends never ? never : any) {
  return {
    id: e.id,
    kind: e.kind,
    mode: e.mode,
    title: e.title,
    purpose: e.purpose,
    tags: e.tags,
    names: e.names,
    creator: { id: e.creator_id, name: e.creator_name, team: e.creator_team },
    owner: { id: e.owner_id, name: e.owner_name },
    team: e.team,
    lifecycle: e.lifecycle,
    repoUrl: e.repo_url,
    externalUrl: e.external_url,
    frozen: e.frozen,
    featured: e.featured,
    copiedFrom: e.copied_from_entry_id ? { entryId: e.copied_from_entry_id, versionId: e.copied_from_version_id } : null,
    theme: e.theme ?? null,
    createdAt: e.created_at,
    launchUrl: `${portalOrigin(config)}/${e.names[0]}`,
    ...(e.mode === "hosted" ? { origin: toolOrigin(config, e.id) } : {}),
  };
}

export function apiApp(services: Services) {
  const { config, db, storage } = services;
  const app = new Hono<Env>();
  const user = (c: any) => c.get("identity")!.user;

  // ---------------- Browser JSON API (shell) ----------------
  app.get("/shell/:id/drawer", async (c) => {
    const u = user(c);
    const entry = await entries.requireEntry(db, c.req.param("id"));
    const [recs, maintainers] = await Promise.all([recommendFor(db, entry, 5), entries.listMaintainers(db, entry.id)]);
    const canCopy = entry.mode === "hosted" && !entry.frozen && entries.canPublish(config, u) && Boolean(await versions.getActiveVersion(db, entry.id));
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(drawerFragment(config, entry, maintainers.map((m) => m.display_name), recs, canCopy).toString());
  });

  app.post("/discovery", async (c) => {
    const identity = c.get("identity")!;
    const body = await c.req.json().catch(() => ({}));
    const type = String(body.type ?? "");
    if (!["rail_rendered", "drawer_opened", "recommendation_launched"].includes(type)) throw badRequest("Unknown event type");
    const placement = Number.isInteger(body.placement) ? Number(body.placement) : null;
    await recordDiscoveryEvent(db, {
      type: type as any,
      userId: identity.user.id,
      sessionKey: pseudonymousSessionKey(identity, config),
      sourceEntryId: typeof body.sourceEntryId === "string" ? body.sourceEntryId.slice(0, 40) : null,
      targetEntryId: typeof body.targetEntryId === "string" ? body.targetEntryId.slice(0, 40) : null,
      placement,
      reason: typeof body.reason === "string" ? body.reason : null,
      via: "shell",
      userTeam: identity.user.team,
    });
    return c.json({ ok: true });
  });

  app.get("/search", async (c) => {
    const results = await searchEntries(db, { query: c.req.query("q") ?? "", limit: 30 });
    return c.json({ results: results.map((e) => entryJson(config, e)) });
  });

  // ---------------- CLI API (bearer token) ----------------
  const cli = new Hono<Env>();

  cli.get("/me", (c) => c.json({ ...publicIdentity(user(c), config), email: user(c).email, isAdmin: user(c).is_admin, portal: portalOrigin(config), shortcut: config.shortcut }));

  cli.get("/tools", async (c) => {
    const u = user(c);
    const mine = c.req.query("mine") === "1";
    const list = mine ? await entries.listEntries(db, { maintainerId: u.id, includeRetired: true, limit: 500 }) : await searchEntries(db, { query: c.req.query("q") ?? "", includeRetired: c.req.query("retired") === "1", limit: 200 });
    return c.json({ tools: list.map((e) => entryJson(config, e)) });
  });

  async function resolveTool(c: any) {
    const ref = c.req.param("id");
    const e = (await entries.getEntry(db, ref)) ?? (await entries.getEntryByName(db, ref));
    if (!e) throw notFound(`No tool with ID or name "${ref}"`);
    return e;
  }
  async function resolveMaintained(c: any) {
    const e = await resolveTool(c);
    await entries.requireMaintainer(db, e, user(c));
    return e;
  }

  cli.post("/tools", async (c) => {
    const u = user(c);
    entries.requirePublisher(config, u);
    const b = await c.req.json();
    const mode = b.mode === "external" ? "external" : "hosted";
    const entry = await db.transaction((tx) =>
      entries.createEntry(tx, userActor(u.id), u, {
        kind: mode === "hosted" ? "tool" : b.kind === "resource" ? "resource" : "tool",
        mode,
        name: String(b.name ?? ""),
        title: String(b.title ?? b.name ?? ""),
        purpose: typeof b.purpose === "string" ? b.purpose : "",
        tags: Array.isArray(b.tags) ? b.tags : [],
        team: typeof b.team === "string" ? b.team : null,
        repoUrl: typeof b.repoUrl === "string" ? b.repoUrl : null,
        externalUrl: typeof b.externalUrl === "string" ? b.externalUrl : null,
        ...(b.theme !== undefined ? { theme: b.theme } : {}),
      }),
    );
    return c.json({ tool: entryJson(config, entry) }, 201);
  });

  cli.get("/tools/:id", async (c) => {
    const e = await resolveTool(c);
    const [active, vers, bindings, maintainers] = await Promise.all([versions.getActiveVersion(db, e.id), versions.listVersions(db, e.id), docs.listBindings(db, e.id), entries.listMaintainers(db, e.id)]);
    return c.json({
      tool: entryJson(config, e),
      activeVersion: active ? { id: active.id, number: active.number, createdAt: active.created_at } : null,
      versions: vers.map((v) => ({ id: v.id, number: v.number, createdAt: v.created_at, createdBy: v.created_by_name, fileCount: v.file_count, totalBytes: Number(v.total_bytes), note: v.note, removed: v.removed, active: active?.id === v.id })),
      bindings: bindings.map((b) => ({ name: b.binding_name, collectionId: b.collection_id, collectionName: b.collection_name, originTool: b.origin_tool_id, frozen: b.frozen })),
      maintainers: maintainers.map((m) => ({ id: m.id, name: m.display_name, owner: m.id === e.owner_id })),
    });
  });

  cli.patch("/tools/:id", async (c) => {
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    await entries.updateMetadata(db, userActor(user(c).id), e, {
      ...(b.title !== undefined ? { title: String(b.title) } : {}),
      ...(b.purpose !== undefined ? { purpose: String(b.purpose) } : {}),
      ...(b.tags !== undefined ? { tags: Array.isArray(b.tags) ? b.tags : String(b.tags).split(",") } : {}),
      ...(b.team !== undefined ? { team: b.team ? String(b.team) : null } : {}),
      ...(b.repoUrl !== undefined ? { repoUrl: b.repoUrl ? String(b.repoUrl) : null } : {}),
      ...(b.externalUrl !== undefined ? { externalUrl: String(b.externalUrl) } : {}),
      // null clears the declaration; the service rejects anything but the three settings.
      ...(b.theme !== undefined ? { theme: b.theme === null ? null : b.theme } : {}),
    });
    return c.json({ tool: entryJson(config, (await entries.getEntry(db, e.id))!) });
  });

  cli.post("/tools/:id/lifecycle", async (c) => {
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    await entries.setLifecycle(db, userActor(user(c).id), e, b.lifecycle, b.replacement ?? null);
    return c.json({ ok: true });
  });

  // Upload: body is a tar (optionally gzip) stream.
  cli.post("/tools/:id/versions", async (c) => {
    entries.requirePublisher(config, user(c));
    const e = await resolveMaintained(c);
    if (!c.req.raw.body) throw badRequest("Missing upload body");
    const ct = (c.req.header("content-type") ?? "").toLowerCase();
    const gzip = ct.includes("gzip") || c.req.header("content-encoding") === "gzip";
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > config.limits.maxUploadBytes * 2) throw new KitlaneError("payload_too_large", "Upload too large");
    const body = Readable.fromWeb(c.req.raw.body as any);
    const result = await versions.publishUpload(db, storage, config, userActor(user(c).id), e, body, {
      gzip,
      note: c.req.header("x-kitlane-note") ?? null,
      activate: c.req.query("activate") !== "0",
    });
    return c.json(
      {
        version: { id: result.version.id, number: result.version.number, fileCount: result.version.file_count, totalBytes: Number(result.version.total_bytes) },
        unchanged: result.unchanged,
        activated: result.activated,
        launchUrl: `${portalOrigin(config)}/${e.names[0]}`,
        origin: toolOrigin(config, e.id),
      },
      result.unchanged ? 200 : 201,
    );
  });

  cli.post("/tools/:id/rollback", async (c) => {
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    let versionId = String(b.versionId ?? "");
    if (!versionId && b.number !== undefined) {
      const r = await db.query<{ id: string }>(`SELECT id FROM versions WHERE entry_id = $1 AND number = $2`, [e.id, Number(b.number)]);
      if (!r.rows[0]) throw notFound("No such version number");
      versionId = r.rows[0].id;
    }
    const v = await versions.rollback(db, userActor(user(c).id), e, versionId);
    return c.json({ active: { id: v.id, number: v.number } });
  });

  cli.get("/tools/:id/versions/:vid/download", async (c) => {
    const e = await resolveTool(c);
    if (e.frozen) throw new KitlaneError("frozen", "This tool is frozen");
    const v = await versions.getVersion(db, c.req.param("vid"));
    if (!v || v.entry_id !== e.id) throw notFound("Version not found");
    const stream = await versions.packVersion(storage, e.id, v);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": "application/gzip", "Cache-Control": "no-store" } });
  });
  cli.get("/tools/:id/download", async (c) => {
    const e = await resolveTool(c);
    if (e.frozen) throw new KitlaneError("frozen", "This tool is frozen");
    const v = await versions.getActiveVersion(db, e.id);
    if (!v) throw notFound("No active version");
    const stream = await versions.packVersion(storage, e.id, v);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": "application/gzip", "Cache-Control": "no-store", "X-Kitlane-Version": v.id } });
  });

  cli.post("/tools/:id/copy", async (c) => {
    const u = user(c);
    entries.requirePublisher(config, u);
    const e = await resolveTool(c);
    const b = await c.req.json();
    const active = await versions.getActiveVersion(db, e.id);
    if (!active) throw badRequest("No active version to copy");
    const created = await versions.copyTool(db, storage, userActor(u.id), u, e, active, { name: String(b.name ?? ""), title: b.title ? String(b.title) : undefined });
    return c.json({ tool: entryJson(config, created) }, 201);
  });

  cli.post("/tools/:id/names", async (c) => {
    entries.requirePublisher(config, user(c));
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    const name = await db.transaction((tx) => names.claimName(tx, userActor(user(c).id), String(b.name ?? ""), e.id));
    return c.json({ name }, 201);
  });
  cli.delete("/tools/:id/names/:name", async (c) => {
    const e = await resolveMaintained(c);
    await db.transaction((tx) => names.releaseName(tx, userActor(user(c).id), c.req.param("name"), e.id));
    return c.json({ ok: true });
  });

  cli.get("/tools/:id/collections", async (c) => {
    const e = await resolveTool(c);
    const bindings = await docs.listBindings(db, e.id);
    return c.json({ bindings: bindings.map((b) => ({ name: b.binding_name, collectionId: b.collection_id, collectionName: b.collection_name, originTool: b.origin_tool_id, ownerId: b.owner_id, frozen: b.frozen, revision: b.revision })) });
  });
  cli.post("/tools/:id/collections", async (c) => {
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    const owner = (await getUser(db, e.owner_id))!;
    const col = await db.transaction((tx) => docs.createCollection(tx, userActor(user(c).id), config.installationId, e, owner, String(b.name ?? ""), typeof b.description === "string" ? b.description : ""));
    return c.json({ collection: { id: col.id, name: col.name, ownerId: col.owner_id, originToolId: col.origin_tool_id } }, 201);
  });
  cli.post("/tools/:id/bindings", async (c) => {
    const e = await resolveMaintained(c);
    const b = await c.req.json();
    await docs.bindCollection(db, userActor(user(c).id), e, String(b.binding ?? ""), String(b.collectionId ?? ""));
    return c.json({ ok: true });
  });
  cli.delete("/tools/:id/bindings/:binding", async (c) => {
    const e = await resolveMaintained(c);
    await docs.unbindCollection(db, userActor(user(c).id), e, c.req.param("binding"));
    return c.json({ ok: true });
  });

  cli.get("/collections", async (c) => {
    const list = await docs.listCollections(db, c.req.query("mine") === "1" ? { ownerId: user(c).id } : {});
    return c.json({ collections: list.map((x) => ({ id: x.id, name: x.name, description: x.description, ownerId: x.owner_id, ownerName: x.owner_name, originToolId: x.origin_tool_id, originToolTitle: x.origin_tool_title, revision: x.revision, frozen: x.frozen, documents: x.doc_count })) });
  });
  cli.get("/collections/:cid", async (c) => {
    const col = await docs.requireCollection(db, c.req.param("cid"));
    const grants = await docs.listGrants(db, col.id);
    return c.json({ collection: col, grants: grants.map((g) => ({ id: g.id, type: g.grant_type, subjectId: g.subject_id, subjectName: g.subject_name, grantedAt: g.granted_at })) });
  });
  cli.post("/collections/:cid/grants", async (c) => {
    const col = await docs.requireCollection(db, c.req.param("cid"));
    if (!docs.canManageCollection(col, user(c))) throw forbidden("Only the collection owner can manage grants");
    const b = await c.req.json();
    const type = b.type === "tool" ? "tool" : "user";
    let subject = String(b.subject ?? "");
    if (type === "user") {
      const target = await findUserByHandle(db, subject);
      if (!target) throw notFound("User not found");
      subject = target.id;
    } else {
      const t = (await entries.getEntry(db, subject)) ?? (await entries.getEntryByName(db, subject));
      if (!t) throw notFound("Tool not found");
      subject = t.id;
    }
    const g = await docs.addGrant(db, userActor(user(c).id), col, type, subject);
    return c.json({ grant: { id: g.id, type: g.grant_type, subjectId: g.subject_id } }, 201);
  });
  cli.delete("/collections/:cid/grants/:gid", async (c) => {
    const col = await docs.requireCollection(db, c.req.param("cid"));
    if (!docs.canManageCollection(col, user(c))) throw forbidden("Only the collection owner can manage grants");
    await docs.revokeGrant(db, userActor(user(c).id), col, c.req.param("gid"));
    return c.json({ ok: true });
  });
  cli.post("/collections/:cid/freeze", async (c) => {
    const col = await docs.requireCollection(db, c.req.param("cid"));
    entries.requireAdmin(user(c));
    const b = await c.req.json();
    await docs.setCollectionFrozen(db, userActor(user(c).id), col, Boolean(b.frozen), b.reason ?? null);
    return c.json({ ok: true });
  });

  cli.get("/updaters", async (c) => {
    const u = user(c);
    const all = await docs.listUpdaterCredentials(db);
    const mine = [] as typeof all;
    for (const cred of all) {
      if (u.is_admin || cred.created_by === u.id) mine.push(cred);
    }
    return c.json({ updaters: mine.map((x) => ({ id: x.id, label: x.label, collectionIds: x.collection_ids, operations: x.operations, createdAt: x.created_at, expiresAt: x.expires_at, revokedAt: x.revoked_at, lastUsedAt: x.last_used_at })) });
  });
  cli.post("/updaters", async (c) => {
    const u = user(c);
    const b = await c.req.json();
    const ids: string[] = Array.isArray(b.collectionIds) ? b.collectionIds.map(String) : [];
    for (const id of ids) {
      const col = await docs.requireCollection(db, id);
      if (!docs.canManageCollection(col, u)) throw forbidden(`Only the owner of collection ${id} can issue updater credentials for it`);
    }
    const days = b.expiresInDays === undefined ? 90 : Number(b.expiresInDays);
    const { credential, token } = await docs.createUpdaterCredential(db, userActor(u.id), {
      label: String(b.label ?? ""),
      collectionIds: ids,
      operations: Array.isArray(b.operations) ? b.operations.map(String) : ["read", "write", "bulk"],
      expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000) : null,
    });
    return c.json({ updater: { id: credential.id, label: credential.label, collectionIds: credential.collection_ids, operations: credential.operations, expiresAt: credential.expires_at }, token }, 201);
  });
  cli.delete("/updaters/:id", async (c) => {
    const u = user(c);
    const r = await db.query<{ created_by: string }>(`SELECT created_by FROM updater_credentials WHERE id = $1`, [c.req.param("id")]);
    if (!r.rows[0]) throw notFound("Updater credential not found");
    if (!u.is_admin && r.rows[0].created_by !== u.id) throw forbidden("Only the creator or an administrator can revoke this credential");
    await docs.revokeUpdaterCredential(db, userActor(u.id), c.req.param("id"));
    return c.json({ ok: true });
  });

  cli.get("/export", async (c) => c.json(await buildExport(db, { includeSharedDocuments: c.req.query("includeShared") === "1", requestedBy: user(c).id })));

  cli.get("/search", async (c) => {
    const results = await searchEntries(db, { query: c.req.query("q") ?? "", limit: 50 });
    return c.json({ results: results.map((e) => entryJson(config, e)) });
  });

  app.route("/cli", cli);
  return app;
}
