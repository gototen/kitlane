import { Hono } from "hono";
import type { Env, Services } from "../../context.js";
import { KitlaneError, badRequest, notFound, unauthenticated } from "../../errors.js";
import * as docs from "../../services/documents.js";

/**
 * External updater API. Authenticated only by a scoped updater credential (Bearer klu_...).
 * It never trusts identity headers or a claimed tool header, and cannot reach personal storage.
 */
export function updaterApp(services: Services) {
  const { config, db, limiter } = services;
  const app = new Hono<Env & { Variables: { updater: docs.UpdaterCredential } }>();

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const auth = c.req.header("authorization") ?? "";
    if (!auth.toLowerCase().startsWith("bearer ")) throw unauthenticated("Updater credential required");
    const cred = await docs.authenticateUpdater(db, auth.slice(7).trim());
    if (!cred) throw unauthenticated("Invalid, expired, or revoked updater credential");
    if (!limiter.hit(`updater:${cred.id}`)) throw new KitlaneError("rate_limited", "Too many requests");
    c.set("updater", cred);
    await next();
  });

  async function collectionOf(c: any, op: docs.UpdaterOperation): Promise<docs.SharedCollection> {
    const cred: docs.UpdaterCredential = c.get("updater");
    const col = await docs.getCollection(db, c.req.param("cid"));
    if (!col) throw notFound("Collection not found");
    docs.requireUpdaterScope(cred, col.id, op);
    return col;
  }
  const writer = (c: any): docs.Writer => ({ type: "updater", id: c.get("updater").id });

  async function readJson(c: any): Promise<any> {
    try {
      return await c.req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
  }

  app.get("/collections/:cid", async (c) => {
    const col = await collectionOf(c, "read");
    return c.json({ id: col.id, name: col.name, description: col.description, revision: col.revision, frozen: col.frozen });
  });

  app.get("/collections/:cid/documents", async (c) => {
    const col = await collectionOf(c, "read");
    const q = c.req.query();
    const result = await docs.listShared(db, col, { limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor ?? null, where: docs.parseFilters(c.req.queries("where")), orderBy: q.orderBy ?? null, order: q.order === "desc" ? "desc" : "asc" }, config.limits);
    c.header("ETag", `W/"${col.revision}"`);
    return c.json(result);
  });

  app.post("/collections/:cid/documents/_bulk", async (c) => {
    const col = await collectionOf(c, "bulk");
    const body = await readJson(c);
    const ops = docs.validateBulk(body?.ops, config.limits);
    if (ops.some((o) => o.op === "delete")) docs.requireUpdaterScope(c.get("updater"), col.id, "delete");
    if (body?.replaceAll) docs.requireUpdaterScope(c.get("updater"), col.id, "delete");
    return c.json(await docs.bulkShared(db, col, ops, Boolean(body?.replaceAll), writer(c), config.limits));
  });

  app.get("/collections/:cid/documents/:docId", async (c) => {
    const col = await collectionOf(c, "read");
    const doc = await docs.getShared(db, col, c.req.param("docId"));
    if (!doc) throw notFound("Document not found");
    return c.json(doc);
  });

  app.put("/collections/:cid/documents/:docId", async (c) => {
    const col = await collectionOf(c, "write");
    const body = await readJson(c);
    const ifRevision = body?.ifRevision;
    if (ifRevision !== undefined && (!Number.isInteger(ifRevision) || ifRevision < 0)) throw badRequest("ifRevision must be a non-negative integer");
    return c.json(await docs.setShared(db, col, c.req.param("docId"), body?.data, ifRevision, writer(c), config.limits));
  });

  app.delete("/collections/:cid/documents/:docId", async (c) => {
    const col = await collectionOf(c, "delete");
    const body = c.req.header("content-length") && c.req.header("content-length") !== "0" ? await readJson(c) : {};
    return c.json(await docs.deleteShared(db, col, c.req.param("docId"), body?.ifRevision, writer(c)));
  });

  return app;
}
