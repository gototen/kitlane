import { Hono } from "hono";
import { Readable } from "node:stream";
import type { Env, Services } from "../../context.js";
import { KitlaneError, badRequest, forbidden, notFound } from "../../errors.js";
import { userActor } from "../../types.js";
import * as entries from "../../services/entries.js";
import * as names from "../../services/names.js";
import * as versions from "../../services/versions.js";
import * as docs from "../../services/documents.js";
import * as tokens from "../../services/tokens.js";
import { listAuditForCollection, listAuditForEntry, listRecentAudit } from "../../services/audit.js";
import { searchEntries } from "../../services/search.js";
import { buildToday } from "../../services/today.js";
import { measurementReport } from "../../services/discovery.js";
import { findUserByHandle, getUser, listRecentUsers, setAdmin, setUserPreferences, setUserTeam } from "../../services/users.js";
import { isValidName } from "../../names.js";
import {
  adminPage,
  collectionPage,
  copyPage,
  homePage,
  measurementPage,
  mePage,
  nameHistoryPage,
  newEntryPage,
  searchPage,
  toolDetailPage,
} from "../../views/portal.js";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function tagsOf(v: unknown): string[] {
  return str(v).split(",").map((s) => s.trim()).filter(Boolean);
}
function flashUrl(base: string, flash?: string, error?: string): string {
  const u = new URLSearchParams();
  if (flash) u.set("flash", flash);
  if (error) u.set("error", error);
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
}

export function pagesApp(services: Services) {
  const { config, db, storage } = services;
  const app = new Hono<Env>();
  const user = (c: any) => c.get("identity")!.user;

  app.get("/", async (c) => {
    const u = user(c);
    const today = await buildToday(db, u.id, config.shortcut);
    return c.html(homePage(config, u, today, entries.canPublish(config, u)));
  });

  app.get("/.search", async (c) => {
    const u = user(c);
    const q = (c.req.query("q") ?? "").trim();
    const tag = c.req.query("tag") || null;
    const creatorId = c.req.query("creator") || null;
    const kind = (c.req.query("kind") || null) as "tool" | "resource" | null;
    const includeRetired = c.req.query("retired") === "1";
    const results = await searchEntries(db, { query: q, tag, creatorId, kind, includeRetired, limit: 100 });
    const creator = creatorId ? await getUser(db, creatorId) : null;
    const exact = q && results.some((e) => e.names.includes(q.toLowerCase()));
    const canClaim = Boolean(q) && !exact && isValidName(q) && !(await names.getName(db, q));
    return c.html(searchPage(config, u, { q, tag, creator: creatorId, kind, includeRetired }, results, creator, canClaim));
  });

  app.get("/.new", (c) => c.html(newEntryPage(config, user(c), { name: c.req.query("name") ?? "", error: c.req.query("error") ?? undefined, canPublish: entries.canPublish(config, user(c)) })));
  app.post("/.new", async (c) => {
    const u = user(c);
    entries.requirePublisher(config, u);
    const b = await c.req.parseBody();
    const mode = str(b.mode) === "hosted" ? "hosted" : "external";
    try {
      const entry = await db.transaction((tx) =>
        entries.createEntry(tx, userActor(u.id), u, {
          kind: mode === "hosted" ? "tool" : str(b.kind) === "resource" ? "resource" : "tool",
          mode,
          name: str(b.name),
          title: str(b.title),
          purpose: str(b.purpose),
          tags: tagsOf(b.tags),
          externalUrl: mode === "external" ? str(b.externalUrl) : null,
        }),
      );
      return c.redirect(flashUrl(`/.tool/${entry.id}`, mode === "hosted" ? `Name claimed. Publish files with: npx kitlane publish ./dist --name ${entry.names[0]}` : "Registered."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.html(newEntryPage(config, u, { name: str(b.name), error: err.message }), err.status as 400);
      throw err;
    }
  });

  app.get("/.me", async (c) => {
    const u = user(c);
    const [mine, toks, cols] = await Promise.all([entries.listEntries(db, { maintainerId: u.id, includeRetired: true, limit: 200 }), tokens.listAccessTokens(db, u.id), docs.listCollections(db, { ownerId: u.id })]);
    return c.html(mePage(config, u, mine, toks, c.req.query("token") ?? null, cols, c.req.query("flash")));
  });
  app.post("/.me/tokens", async (c) => {
    const u = user(c);
    const b = await c.req.parseBody();
    const { token } = await tokens.createAccessToken(db, userActor(u.id), u, str(b.label), Number(str(b.days) || 90));
    return c.redirect(`/.me?token=${encodeURIComponent(token)}#tokens`, 303);
  });
  app.post("/.me/tokens/:id/revoke", async (c) => {
    const u = user(c);
    await tokens.revokeAccessToken(db, userActor(u.id), u.id, c.req.param("id"));
    return c.redirect("/.me#tokens", 303);
  });
  // Theme preferences: `theme` (light|dark|system) for the portal, `rail` (tool|light|dark) for the shell rail.
  app.post("/.me/preferences", async (c) => {
    const u = user(c);
    const b = await c.req.parseBody();
    await setUserPreferences(db, u.id, {
      ...(b.theme !== undefined ? { themePref: str(b.theme) as any } : {}),
      ...(b.rail !== undefined ? { railPref: str(b.rail) as any } : {}),
    });
    return c.redirect("/.me?flash=Preferences+saved#preferences", 303);
  });

  // --- Tool detail and maintenance ---
  async function loadTool(c: any) {
    const u = user(c);
    const entry = await entries.requireEntry(db, c.req.param("id"));
    const canMaintain = u.is_admin || entry.owner_id === u.id || (await entries.isMaintainer(db, entry.id, u.id));
    return { u, entry, canMaintain, isOwner: u.is_admin || entry.owner_id === u.id };
  }
  async function requireMaintain(c: any) {
    const t = await loadTool(c);
    if (!t.canMaintain) throw forbidden("Only this tool's maintainers can do that");
    return t;
  }
  async function requireOwner(c: any) {
    const t = await loadTool(c);
    if (!t.isOwner) throw forbidden("Only this tool's owner can do that");
    return t;
  }
  async function requireAdmin(c: any) {
    const t = await loadTool(c);
    if (!t.u.is_admin) throw forbidden("Administrator access required");
    return t;
  }

  app.get("/.tool/:id", async (c) => {
    const { u, entry, canMaintain, isOwner } = await loadTool(c);
    const [maintainers, vers, active, history, lin, bindings, collections, audit, replacement] = await Promise.all([
      entries.listMaintainers(db, entry.id),
      versions.listVersions(db, entry.id),
      versions.getActiveVersion(db, entry.id),
      versions.listDeploymentHistory(db, entry.id),
      versions.lineage(db, entry),
      docs.listBindings(db, entry.id),
      docs.listCollections(db),
      canMaintain ? listAuditForEntry(db, entry.id) : Promise.resolve([]),
      entry.replacement_entry_id ? entries.getEntry(db, entry.replacement_entry_id) : Promise.resolve(null),
    ]);
    return c.html(
      toolDetailPage(config, { entry, user: u, canMaintain, isOwner, canPublish: entries.canPublish(config, u), maintainers, versions: vers, active, history, lineage: lin, bindings, collections, audit, replacement, flash: c.req.query("flash"), error: c.req.query("error") }),
    );
  });

  app.get("/.tool/:id/download/:versionId", async (c) => {
    const { entry } = await loadTool(c);
    const v = await versions.getVersion(db, c.req.param("versionId"));
    if (!v || v.entry_id !== entry.id) throw notFound("Version not found");
    if (entry.frozen) throw new KitlaneError("frozen", "This tool is frozen");
    const stream = await versions.packVersion(storage, entry.id, v);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${entry.names[0] ?? entry.id}-v${v.number}.tar.gz"`, "Cache-Control": "no-store" },
    });
  });

  app.get("/.tool/:id/copy", async (c) => {
    const { u, entry } = await loadTool(c);
    entries.requirePublisher(config, u);
    if (entry.mode !== "hosted") throw badRequest("Only hosted tools can be copied");
    return c.html(copyPage(config, u, entry));
  });
  app.post("/.tool/:id/copy", async (c) => {
    const { u, entry } = await loadTool(c);
    entries.requirePublisher(config, u);
    const b = await c.req.parseBody();
    const active = await versions.getActiveVersion(db, entry.id);
    if (!active) throw badRequest("This tool has no published version to copy");
    try {
      const created = await versions.copyTool(db, storage, userActor(u.id), u, entry, active, { name: str(b.name), title: str(b.title) });
      return c.redirect(flashUrl(`/.tool/${created.id}`, "Remix created. Pull the files, change them with whatever you like, and publish."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.html(copyPage(config, u, entry, err.message), err.status as 400);
      throw err;
    }
  });

  app.post("/.tool/:id/metadata", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    await entries.updateMetadata(db, userActor(u.id), entry, {
      title: str(b.title),
      purpose: str(b.purpose),
      tags: tagsOf(b.tags),
      team: str(b.team) || null,
      repoUrl: str(b.repoUrl) || null,
      ...(entry.mode === "external" ? { externalUrl: str(b.externalUrl) } : {}),
      // Optional theme field: light|dark|system, or "" to clear the declaration.
      ...(b.theme !== undefined ? { theme: (str(b.theme) || null) as any } : {}),
    });
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Saved."), 303);
  });
  app.post("/.tool/:id/lifecycle", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    await entries.setLifecycle(db, userActor(u.id), entry, str(b.lifecycle) as any, str(b.replacement) || null);
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Lifecycle updated."), 303);
  });
  app.post("/.tool/:id/rollback", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    const v = await versions.rollback(db, userActor(u.id), entry, str(b.versionId));
    return c.redirect(flashUrl(`/.tool/${entry.id}`, `Version ${v.number} is now active. Stored data is unchanged.`), 303);
  });
  app.post("/.tool/:id/names/claim", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    try {
      await db.transaction((tx) => names.claimName(tx, userActor(u.id), str(b.name), entry.id));
      return c.redirect(flashUrl(`/.tool/${entry.id}`, "Name added."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.tool/:id/names/release", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    try {
      await db.transaction((tx) => names.releaseName(tx, userActor(u.id), str(b.name), entry.id));
      return c.redirect(flashUrl(`/.tool/${entry.id}`, "Name released."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.tool/:id/maintainers/add", async (c) => {
    const { u, entry } = await requireOwner(c);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, "User not found"), 303);
    await entries.addMaintainer(db, userActor(u.id), entry, target);
    return c.redirect(flashUrl(`/.tool/${entry.id}`, `${target.display_name} is now a co-maintainer.`), 303);
  });
  app.post("/.tool/:id/maintainers/remove", async (c) => {
    const { u, entry } = await requireOwner(c);
    const b = await c.req.parseBody();
    await entries.removeMaintainer(db, userActor(u.id), entry, str(b.userId));
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Maintainer removed."), 303);
  });
  app.post("/.tool/:id/transfer", async (c) => {
    const { u, entry } = await requireOwner(c);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, "User not found"), 303);
    await entries.transferOwnership(db, userActor(u.id), entry, target);
    return c.redirect(flashUrl(`/.tool/${entry.id}`, `Ownership transferred to ${target.display_name}. Creator attribution is unchanged.`), 303);
  });
  app.post("/.tool/:id/recover", async (c) => {
    const { u, entry } = await requireAdmin(c);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, "User not found"), 303);
    await entries.transferOwnership(db, userActor(u.id), entry, target, true);
    return c.redirect(flashUrl(`/.tool/${entry.id}`, `Ownership recovered to ${target.display_name}.`), 303);
  });
  app.post("/.tool/:id/freeze", async (c) => {
    const { u, entry } = await requireAdmin(c);
    const b = await c.req.parseBody();
    const frozen = str(b.frozen) === "1";
    await entries.setFrozen(db, userActor(u.id), entry, frozen, str(b.reason) || null);
    return c.redirect(flashUrl(`/.tool/${entry.id}`, frozen ? "Tool frozen. Fresh asset and SDK access is blocked." : "Tool unfrozen."), 303);
  });
  app.post("/.tool/:id/featured", async (c) => {
    const { u, entry } = await requireAdmin(c);
    const b = await c.req.parseBody();
    await entries.setFeatured(db, userActor(u.id), entry, str(b.featured) === "1");
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Updated."), 303);
  });
  app.post("/.tool/:id/versions/:versionId/remove", async (c) => {
    const { u, entry } = await requireAdmin(c);
    const b = await c.req.parseBody();
    await versions.removeVersionContent(db, storage, userActor(u.id), entry, c.req.param("versionId"), str(b.reason) || "administrator removal");
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Version content removed. The audit record is preserved."), 303);
  });

  // --- Collections from a tool ---
  app.post("/.tool/:id/collections", async (c) => {
    const { u, entry } = await requireMaintain(c);
    if (entry.mode !== "hosted") throw badRequest("Only hosted tools own shared collections");
    const b = await c.req.parseBody();
    const owner = (await getUser(db, entry.owner_id))!;
    try {
      const col = await db.transaction((tx) => docs.createCollection(tx, userActor(u.id), config.installationId, entry, owner, str(b.name), str(b.description)));
      return c.redirect(flashUrl(`/.collection/${col.id}`, "Collection created. Everyone in this installation can read it."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.tool/:id/bindings/bind", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    try {
      await docs.bindCollection(db, userActor(u.id), entry, str(b.binding), str(b.collectionId));
      return c.redirect(flashUrl(`/.tool/${entry.id}`, "Bound as a read reference."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl(`/.tool/${entry.id}`, undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.tool/:id/bindings/unbind", async (c) => {
    const { u, entry } = await requireMaintain(c);
    const b = await c.req.parseBody();
    await docs.unbindCollection(db, userActor(u.id), entry, str(b.binding));
    return c.redirect(flashUrl(`/.tool/${entry.id}`, "Unbound."), 303);
  });

  // --- Collection management ---
  async function loadCollection(c: any) {
    const u = user(c);
    const col = await docs.requireCollection(db, c.req.param("cid"));
    return { u, col, canManage: docs.canManageCollection(col, u) };
  }
  async function requireManage(c: any) {
    const t = await loadCollection(c);
    if (!t.canManage) throw forbidden("Only the collection owner can do that");
    return t;
  }
  app.get("/.collection/:cid", async (c) => {
    const { u, col, canManage } = await loadCollection(c);
    const owner = await getUser(db, col.owner_id);
    const origin = await entries.getEntry(db, col.origin_tool_id);
    const boundRows = await db.query<{ tool_id: string; binding_name: string }>(`SELECT tool_id, binding_name FROM collection_bindings WHERE collection_id = $1`, [col.id]);
    const bound: { entry: any; binding: string }[] = [];
    for (const r of boundRows.rows) {
      const e = await entries.getEntry(db, r.tool_id);
      if (e) bound.push({ entry: e, binding: r.binding_name });
    }
    const grants = canManage ? await docs.listGrants(db, col.id) : await docs.listGrants(db, col.id);
    const updaters = canManage ? await docs.listUpdaterCredentials(db, col.id) : [];
    const audit = canManage ? await listAuditForCollection(db, col.id) : [];
    const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM shared_documents WHERE collection_id = $1`, [col.id]);
    return c.html(collectionPage(config, u, { ...col, owner_name: owner?.display_name ?? "?" }, origin, bound, grants, updaters, audit, canManage, count.rows[0].n, c.req.query("updater") ?? null, c.req.query("flash"), c.req.query("error")));
  });
  app.post("/.collection/:cid/grants", async (c) => {
    const { u, col } = await requireManage(c);
    const b = await c.req.parseBody();
    const type = str(b.type) === "tool" ? "tool" : "user";
    let subject = str(b.subject);
    if (type === "user") {
      const target = await findUserByHandle(db, subject);
      if (!target) return c.redirect(flashUrl(`/.collection/${col.id}`, undefined, "User not found"), 303);
      subject = target.id;
    }
    try {
      await docs.addGrant(db, userActor(u.id), col, type, subject);
      return c.redirect(flashUrl(`/.collection/${col.id}`, "Grant added."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl(`/.collection/${col.id}`, undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.collection/:cid/grants/:gid/revoke", async (c) => {
    const { u, col } = await requireManage(c);
    await docs.revokeGrant(db, userActor(u.id), col, c.req.param("gid"));
    return c.redirect(flashUrl(`/.collection/${col.id}`, "Grant revoked. It applies to the next write."), 303);
  });
  app.post("/.collection/:cid/updaters", async (c) => {
    const { u, col } = await requireManage(c);
    const b = await c.req.parseBody({ all: true });
    const ops = Array.isArray(b.operations) ? (b.operations as string[]) : [str(b.operations)];
    const days = Number(str(Array.isArray(b.days) ? b.days[0] : b.days) || 90);
    const { token } = await docs.createUpdaterCredential(db, userActor(u.id), {
      label: str(Array.isArray(b.label) ? b.label[0] : b.label),
      collectionIds: [col.id],
      operations: ops,
      expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000) : null,
    });
    return c.redirect(`/.collection/${col.id}?updater=${encodeURIComponent(token)}`, 303);
  });
  app.post("/.collection/:cid/updaters/:uid/revoke", async (c) => {
    const { u, col } = await requireManage(c);
    await docs.revokeUpdaterCredential(db, userActor(u.id), c.req.param("uid"));
    return c.redirect(flashUrl(`/.collection/${col.id}`, "Updater credential revoked."), 303);
  });
  app.post("/.collection/:cid/description", async (c) => {
    const { u, col } = await requireManage(c);
    const b = await c.req.parseBody();
    await docs.updateCollectionDescription(db, userActor(u.id), col, str(b.description));
    return c.redirect(flashUrl(`/.collection/${col.id}`, "Saved."), 303);
  });
  app.post("/.collection/:cid/transfer", async (c) => {
    const { u, col } = await requireManage(c);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl(`/.collection/${col.id}`, undefined, "User not found"), 303);
    await docs.transferCollectionOwnership(db, userActor(u.id), col, target);
    return c.redirect(flashUrl(`/.collection/${col.id}`, `Ownership transferred to ${target.display_name}.`), 303);
  });
  app.post("/.collection/:cid/freeze", async (c) => {
    const { u, col } = await loadCollection(c);
    if (!u.is_admin) throw forbidden("Administrator access required");
    const b = await c.req.parseBody();
    const frozen = str(b.frozen) === "1";
    await docs.setCollectionFrozen(db, userActor(u.id), col, frozen, str(b.reason) || null);
    return c.redirect(flashUrl(`/.collection/${col.id}`, frozen ? "Collection frozen for every tool and updater." : "Collection unfrozen."), 303);
  });

  // --- Name history ---
  app.get("/.h/:name", async (c) => {
    const u = user(c);
    const name = c.req.param("name").toLowerCase();
    const current = await names.getName(db, name);
    const entry = current?.entry_id ? await entries.getEntry(db, current.entry_id) : null;
    return c.html(nameHistoryPage(config, u, name, current, entry, await names.nameHistory(db, name)));
  });

  // --- Admin ---
  app.get("/.admin", async (c) => {
    const u = user(c);
    entries.requireAdmin(u);
    const frozen = (await entries.listEntries(db, { includeRetired: true, limit: 500 })).filter((e) => e.frozen);
    return c.html(adminPage(config, u, frozen, await names.listReservedNames(db), await listRecentAudit(db, 100), await listRecentUsers(db, 50), c.req.query("flash"), c.req.query("error")));
  });
  app.post("/.admin/users/team", async (c) => {
    const u = user(c);
    entries.requireAdmin(u);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl("/.admin", undefined, "User not found"), 303);
    const team = str(b.team).trim() || null;
    await setUserTeam(db, target.id, team);
    await db.query(`INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, details) VALUES ('user', $1, 'user.team_assigned', 'user', $2, $3::jsonb)`, [u.id, target.id, JSON.stringify({ team, previous: target.team })]);
    return c.redirect(flashUrl("/.admin", team ? `${target.display_name} is now in team "${team}" (assigned; label it as such in reports).` : `${target.display_name}'s assigned team was cleared.`), 303);
  });
  app.get("/.admin/measurement", async (c) => {
    const u = user(c);
    entries.requireAdmin(u);
    return c.html(measurementPage(config, u, await measurementReport(db, Number(c.req.query("days") ?? 30))));
  });
  app.post("/.admin/names/reserve", async (c) => {
    const u = user(c);
    const b = await c.req.parseBody();
    try {
      await names.reserveName(db, userActor(u.id), str(b.name), u.is_admin);
      return c.redirect(flashUrl("/.admin", "Reserved."), 303);
    } catch (err) {
      if (err instanceof KitlaneError) return c.redirect(flashUrl("/.admin", undefined, err.message), 303);
      throw err;
    }
  });
  app.post("/.admin/names/unreserve", async (c) => {
    const u = user(c);
    const b = await c.req.parseBody();
    await names.unreserveName(db, userActor(u.id), str(b.name), u.is_admin);
    return c.redirect(flashUrl("/.admin", "Unreserved."), 303);
  });
  app.post("/.admin/users/admin", async (c) => {
    const u = user(c);
    entries.requireAdmin(u);
    const b = await c.req.parseBody();
    const target = await findUserByHandle(db, str(b.user));
    if (!target) return c.redirect(flashUrl("/.admin", undefined, "User not found"), 303);
    await setAdmin(db, target.id, str(b.isAdmin) === "1");
    await db.query(`INSERT INTO audit_events (actor_type, actor_id, action, target_type, target_id, details) VALUES ('user', $1, 'user.admin_changed', 'user', $2, $3::jsonb)`, [u.id, target.id, JSON.stringify({ isAdmin: str(b.isAdmin) === "1" })]);
    return c.redirect(flashUrl("/.admin", "Updated."), 303);
  });

  app.get("/.export", async (c) => {
    const u = user(c);
    const { buildExport } = await import("../../services/export.js");
    const data = await buildExport(db, { includeSharedDocuments: c.req.query("includeShared") === "1", requestedBy: u.id });
    c.header("Content-Disposition", `attachment; filename="kitlane-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(data);
  });

  return app;
}
