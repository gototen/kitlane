import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL, createHarness, jsonInit, type Harness } from "./test/harness.js";
import type { EntryWithNames, User } from "./types.js";
import * as docs from "./services/documents.js";
import { userActor } from "./types.js";

let h: Harness;
let alice: User, bob: User, carol: User, admin: User;
let prep: EntryWithNames, editor: EntryWithNames, viewer: EntryWithNames;
let aliceOnPrep: string, bobOnPrep: string, aliceOnEditor: string, bobOnViewer: string, carolOnEditor: string;
let collectionId: string;

const put = (origin: string, path: string, body: unknown, cookie: string, extraHeaders: Record<string, string> = {}) =>
  h.req(`${origin}${path}`, { ...jsonInit("PUT", body, origin), headers: { ...(jsonInit("PUT", body, origin).headers as any), ...extraHeaders }, cookie });
const post = (origin: string, path: string, body: unknown, cookie: string) => h.req(`${origin}${path}`, { ...jsonInit("POST", body, origin), cookie });
const get = (origin: string, path: string, cookie: string, headers: Record<string, string> = {}) => h.req(`${origin}${path}`, { cookie, headers });
const del = (origin: string, path: string, cookie: string, body?: unknown) => h.req(`${origin}${path}`, { ...jsonInit("DELETE", body, origin), cookie });

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user("alice", { team: "finance" });
  bob = await h.user("bob", { team: "marketing" });
  carol = await h.user("carol", { team: "research" });
  admin = await h.user("root", { admin: true });
  prep = await h.publish(alice, "prep", { "index.html": "<h1>prep</h1>" });
  editor = await h.publish(carol, "briefs-editor", { "index.html": "<h1>editor</h1>" });
  viewer = await h.publish(bob, "viewer", { "index.html": "<h1>viewer</h1>" });
  aliceOnPrep = await h.toolCookie(alice, prep.id);
  bobOnPrep = await h.toolCookie(bob, prep.id);
  aliceOnEditor = await h.toolCookie(alice, editor.id);
  bobOnViewer = await h.toolCookie(bob, viewer.id);
  carolOnEditor = await h.toolCookie(carol, editor.id);
});
afterAll(() => h.close());

describe("personal documents", () => {
  const P = () => h.toolOrigin(prep.id);

  it("round-trips a document and lists it", async () => {
    const r = await put(P(), "/._kitlane/data/user/prefs/display", { data: { theme: "dark" } }, aliceOnPrep);
    expect(r.status).toBe(200);
    const doc = await r.json();
    expect(doc).toMatchObject({ id: "display", data: { theme: "dark" }, revision: 1 });
    const list = await (await get(P(), "/._kitlane/data/user/prefs", aliceOnPrep)).json();
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).toBeNull();
  });

  it("isolates records by user: bob cannot read, list, alter, or delete alice's", async () => {
    expect((await get(P(), "/._kitlane/data/user/prefs/display", bobOnPrep)).status).toBe(404);
    expect((await (await get(P(), "/._kitlane/data/user/prefs", bobOnPrep)).json()).items).toHaveLength(0);
    const r = await put(P(), "/._kitlane/data/user/prefs/display", { data: { theme: "light" } }, bobOnPrep);
    expect(r.status).toBe(200); // bob's own namespace
    const alice2 = await (await get(P(), "/._kitlane/data/user/prefs/display", aliceOnPrep)).json();
    expect(alice2.data).toEqual({ theme: "dark" });
    await del(P(), "/._kitlane/data/user/prefs/display", bobOnPrep);
    expect((await get(P(), "/._kitlane/data/user/prefs/display", aliceOnPrep)).status).toBe(200);
  });

  it("isolates records by tool: the same user cannot reach prep data through the editor tool", async () => {
    const r = await get(h.toolOrigin(editor.id), "/._kitlane/data/user/prefs/display", aliceOnEditor);
    expect(r.status).toBe(404);
    expect((await (await get(h.toolOrigin(editor.id), "/._kitlane/data/user/prefs", aliceOnEditor)).json()).items).toHaveLength(0);
  });

  it("ignores forged user/tool parameters in body, query, and headers", async () => {
    const r = await h.req(`${P()}/._kitlane/data/user/prefs/display?userId=${alice.id}&toolId=${prep.id}`, {
      ...jsonInit("PUT", { data: { theme: "forged" }, userId: alice.id, toolId: prep.id, user_id: alice.id }, P()),
      headers: { "content-type": "application/json", origin: P(), "x-forwarded-user": alice.external_id, "x-kitlane-user": alice.id },
      cookie: bobOnPrep,
    });
    expect(r.status).toBe(200);
    expect((await (await get(P(), "/._kitlane/data/user/prefs/display", aliceOnPrep)).json()).data).toEqual({ theme: "dark" });
  });

  it("requires same-origin for mutations and JSON content type", async () => {
    const cross = await h.req(`${P()}/._kitlane/data/user/prefs/x`, { ...jsonInit("PUT", { data: {} }, h.toolOrigin(editor.id)), cookie: aliceOnPrep });
    expect(cross.status).toBe(403);
    const noOrigin = await h.req(`${P()}/._kitlane/data/user/prefs/x`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}", cookie: aliceOnPrep });
    expect(noOrigin.status).toBe(403);
    const form = await h.req(`${P()}/._kitlane/data/user/prefs/x`, { method: "PUT", headers: { "content-type": "text/plain", origin: P() }, body: "{}", cookie: aliceOnPrep });
    expect(form.status).toBe(400);
  });

  it("detects conflicting edits with ifRevision and returns the current document", async () => {
    const ok = await put(P(), "/._kitlane/data/user/prefs/display", { data: { theme: "blue" }, ifRevision: 1 }, aliceOnPrep);
    expect(ok.status).toBe(200);
    expect((await ok.json()).revision).toBe(2);
    const stale = await put(P(), "/._kitlane/data/user/prefs/display", { data: { theme: "red" }, ifRevision: 1 }, aliceOnPrep);
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error).toBe("conflict");
    expect(body.details.current.revision).toBe(2);
    const createOnly = await put(P(), "/._kitlane/data/user/prefs/display", { data: {} , ifRevision: 0 }, aliceOnPrep);
    expect(createOnly.status).toBe(409);
    const headerStyle = await put(P(), "/._kitlane/data/user/prefs/display", { data: { theme: "green" } }, aliceOnPrep, { "if-match": 'W/"2"' });
    expect(headerStyle.status).toBe(200);
  });

  it("validates ids, collection names, payload shape, and size", async () => {
    expect((await put(P(), "/._kitlane/data/user/Bad%20Name/x", { data: {} }, aliceOnPrep)).status).toBe(400);
    expect((await put(P(), "/._kitlane/data/user/prefs/_meta", { data: {} }, aliceOnPrep)).status).toBe(400);
    expect((await put(P(), "/._kitlane/data/user/prefs/x", { data: [1, 2] }, aliceOnPrep)).status).toBe(400);
    expect((await put(P(), "/._kitlane/data/user/prefs/x", { data: "str" }, aliceOnPrep)).status).toBe(400);
    expect((await put(P(), "/._kitlane/data/user/prefs/x", { data: { big: "x".repeat(5000) } }, aliceOnPrep)).status).toBe(413);
  });

  it("filters, orders, and paginates", async () => {
    const ops = Array.from({ length: 6 }, (_, i) => ({ op: "set", id: `s${i}`, data: { n: i, kind: i % 2 ? "odd" : "even", tags: [`t${i}`] } }));
    const bulk = await post(P(), "/._kitlane/data/user/sessions/_bulk", { ops }, aliceOnPrep);
    expect(bulk.status).toBe(200);
    const odd = await (await get(P(), `/._kitlane/data/user/sessions?where=${encodeURIComponent(JSON.stringify(["kind", "eq", "odd"]))}`, aliceOnPrep)).json();
    expect(odd.items.map((d: any) => d.id)).toEqual(["s1", "s3", "s5"]);
    const gt = await (await get(P(), `/._kitlane/data/user/sessions?where=n:gt:3`, aliceOnPrep)).json();
    expect(gt.items.map((d: any) => d.data.n)).toEqual([4, 5]);
    const contains = await (await get(P(), `/._kitlane/data/user/sessions?where=${encodeURIComponent(JSON.stringify(["tags", "contains", ["t2"]]))}`, aliceOnPrep)).json();
    expect(contains.items.map((d: any) => d.id)).toEqual(["s2"]);
    const desc = await (await get(P(), `/._kitlane/data/user/sessions?orderBy=n&order=desc&limit=4`, aliceOnPrep)).json();
    expect(desc.items.map((d: any) => d.data.n)).toEqual([5, 4, 3, 2]);
    expect(desc.nextCursor).toBe("o:4");
    const page2 = await (await get(P(), `/._kitlane/data/user/sessions?orderBy=n&order=desc&limit=4&cursor=o:4`, aliceOnPrep)).json();
    expect(page2.items.map((d: any) => d.data.n)).toEqual([1, 0]);
    const keyset = await (await get(P(), `/._kitlane/data/user/sessions?limit=2`, aliceOnPrep)).json();
    expect(keyset.nextCursor).toBe("s1");
    const keyset2 = await (await get(P(), `/._kitlane/data/user/sessions?limit=2&cursor=s1`, aliceOnPrep)).json();
    expect(keyset2.items.map((d: any) => d.id)).toEqual(["s2", "s3"]);
    expect((await get(P(), `/._kitlane/data/user/sessions?where=n:like:3`, aliceOnPrep)).status).toBe(400);
    expect((await get(P(), `/._kitlane/data/user/sessions?orderBy=n;drop`, aliceOnPrep)).status).toBe(400);
  });

  it("bulk writes are atomic and bounded", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ op: "set", id: `b${i}`, data: { i } }));
    expect((await post(P(), "/._kitlane/data/user/bulk/_bulk", { ops: tooMany }, aliceOnPrep)).status).toBe(413);
    const mixed = [{ op: "set", id: "ok1", data: { a: 1 } }, { op: "set", id: "ok2", data: { a: 2 } }, { op: "set", id: "bad", data: { a: 3 }, ifRevision: 7 }];
    expect((await post(P(), "/._kitlane/data/user/bulk/_bulk", { ops: mixed }, aliceOnPrep)).status).toBe(409);
    expect((await (await get(P(), "/._kitlane/data/user/bulk", aliceOnPrep)).json()).items).toHaveLength(0);
    const replace = await post(P(), "/._kitlane/data/user/sessions/_bulk", { ops: [{ op: "set", id: "only", data: { n: 99 } }], replaceAll: true }, aliceOnPrep);
    expect(replace.status).toBe(200);
    expect((await (await get(P(), "/._kitlane/data/user/sessions", aliceOnPrep)).json()).items.map((d: any) => d.id)).toEqual(["only"]);
  });

  it("enforces the personal quota", async () => {
    const ops = Array.from({ length: 6 }, (_, i) => ({ op: "set", id: `q${i}`, data: { pad: "y".repeat(3500) } }));
    const r = await post(P(), "/._kitlane/data/user/quota/_bulk", { ops }, aliceOnPrep);
    expect(r.status).toBe(413);
    expect((await r.json()).error).toBe("quota_exceeded");
  });

  it("persists across sessions", async () => {
    const fresh = await h.toolCookie(alice, prep.id);
    const r = await get(P(), "/._kitlane/data/user/prefs/display", fresh);
    expect((await r.json()).data).toEqual({ theme: "green" });
  });
});

describe("shared collections", () => {
  const P = () => h.toolOrigin(prep.id);
  const E = () => h.toolOrigin(editor.id);
  const V = () => h.toolOrigin(viewer.id);

  it("only maintainers of the originating tool can create a collection", async () => {
    const bobToken = await h.token(bob);
    const denied = await h.req(`${PORTAL}/.api/cli/tools/${prep.id}/collections`, { ...jsonInit("POST", { name: "company-briefs" }), headers: { "content-type": "application/json", authorization: `Bearer ${bobToken}` } });
    expect(denied.status).toBe(403);
    const ok = await h.req(`${PORTAL}/.api/cli/tools/${prep.id}/collections`, { ...jsonInit("POST", { name: "company-briefs", description: "Synthetic briefs" }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(ok.status).toBe(201);
    collectionId = (await ok.json()).collection.id;
    const meta = await (await get(P(), "/._kitlane/data/shared/company-briefs/_meta", aliceOnPrep)).json();
    expect(meta).toMatchObject({ collectionId, canWrite: true, revision: 0 });
  });

  it("owner writes through the originating tool; ordinary readers cannot write", async () => {
    const w = await put(P(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Acme", summary: "Makes anvils" } }, aliceOnPrep);
    expect(w.status).toBe(200);
    expect((await w.json()).collectionRevision).toBe(1);
    const read = await get(P(), "/._kitlane/data/shared/company-briefs/acme", bobOnPrep);
    expect(read.status).toBe(200);
    expect((await read.json()).data.name).toBe("Acme");
    const denied = await put(P(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Evil" } }, bobOnPrep);
    expect(denied.status).toBe(403);
    expect((await denied.json()).details.reason).toBe("user_not_granted");
    const meta = await (await get(P(), "/._kitlane/data/shared/company-briefs/_meta", bobOnPrep)).json();
    expect(meta.canWrite).toBe(false);
  });

  it("is readable from another registered tool through a binding, without a read grant", async () => {
    const bind = await h.req(`${PORTAL}/.api/cli/tools/${viewer.id}/bindings`, { ...jsonInit("POST", { binding: "briefs", collectionId }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(bob)}` } });
    expect(bind.status).toBe(200);
    const r = await get(V(), "/._kitlane/data/shared/briefs", bobOnViewer);
    expect(r.status).toBe(200);
    const list = await r.json();
    expect(list.items[0].id).toBe("acme");
    expect(list.revision).toBe(1);
    expect(r.headers.get("etag")).toBe('W/"1"');
    const notModified = await get(V(), "/._kitlane/data/shared/briefs", bobOnViewer, { "if-none-match": 'W/"1"' });
    expect(notModified.status).toBe(304);
    // Even the owner cannot write from a tool that is not an allowed context.
    const aliceOnViewer = await h.toolCookie(alice, viewer.id);
    const denied = await put(V(), "/._kitlane/data/shared/briefs/acme", { data: { name: "x" } }, aliceOnViewer);
    expect(denied.status).toBe(403);
    expect((await denied.json()).details.reason).toBe("tool_not_granted");
  });

  it("a separate editor needs both a tool-context grant and a user grant", async () => {
    await h.req(`${PORTAL}/.api/cli/tools/${editor.id}/bindings`, { ...jsonInit("POST", { binding: "company-briefs", collectionId }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(carol)}` } });
    // Carol (editor owner) is not a writer; the editor tool is not a context yet.
    let r = await put(E(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Carol" } }, carolOnEditor);
    expect(r.status).toBe(403);
    expect((await r.json()).details.reason).toBe("user_and_tool_not_granted");
    // Carol cannot grant herself; only the owner can.
    const selfGrant = await h.req(`${PORTAL}/.api/cli/collections/${collectionId}/grants`, { ...jsonInit("POST", { type: "user", subject: carol.id }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(carol)}` } });
    expect(selfGrant.status).toBe(403);
    // Owner grants the editor tool as a context.
    const toolGrant = await h.req(`${PORTAL}/.api/cli/collections/${collectionId}/grants`, { ...jsonInit("POST", { type: "tool", subject: editor.id }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(toolGrant.status).toBe(201);
    r = await put(E(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Carol" } }, carolOnEditor);
    expect(r.status).toBe(403);
    expect((await r.json()).details.reason).toBe("user_not_granted");
    // Opening the editor does not make every visitor a writer, but the owner can now write there.
    r = await put(E(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Acme", summary: "Owner via editor" } }, aliceOnEditor);
    expect(r.status).toBe(200);
    // Owner grants Carol as a writer.
    const userGrant = await h.req(`${PORTAL}/.api/cli/collections/${collectionId}/grants`, { ...jsonInit("POST", { type: "user", subject: carol.email }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(userGrant.status).toBe(201);
    const grantId = (await userGrant.json()).grant.id;
    r = await put(E(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "Acme", summary: "Carol edited" }, ifRevision: 2 }, carolOnEditor);
    expect(r.status).toBe(200);
    // Readers in prep see the update on their next fetch.
    const seen = await (await get(P(), "/._kitlane/data/shared/company-briefs/acme", bobOnPrep)).json();
    expect(seen.data.summary).toBe("Carol edited");
    expect(seen.updatedBy).toBe(carol.id);
    // Revocation applies on the next write.
    const revoke = await h.req(`${PORTAL}/.api/cli/collections/${collectionId}/grants/${grantId}`, { method: "DELETE", headers: { authorization: `Bearer ${await h.token(alice)}` } });
    expect(revoke.status).toBe(200);
    r = await put(E(), "/._kitlane/data/shared/company-briefs/acme", { data: { name: "nope" } }, carolOnEditor);
    expect(r.status).toBe(403);
  });

  it("copies retain bindings as read references and inherit no writer rights", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/tools/${prep.id}/copy`, { ...jsonInit("POST", { name: "prep-copy" }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(res.status).toBe(201);
    const copy = (await res.json()).tool;
    const aliceOnCopy = await h.toolCookie(alice, copy.id);
    const read = await get(copy.origin, "/._kitlane/data/shared/company-briefs/acme", aliceOnCopy);
    expect(read.status).toBe(200);
    const write = await put(copy.origin, "/._kitlane/data/shared/company-briefs/acme", { data: { name: "from copy" } }, aliceOnCopy);
    expect(write.status).toBe(403);
    expect((await write.json()).details.reason).toBe("tool_not_granted");
    const tool = await (await get(copy.origin, "/._kitlane/tool", aliceOnCopy)).json();
    expect(tool.bindings).toEqual([expect.objectContaining({ name: "company-briefs", collectionId, canWrite: false })]);
    // The copy's owner may rebind the name to a new collection they own.
    const own = await h.req(`${PORTAL}/.api/cli/tools/${copy.id}/collections`, { ...jsonInit("POST", { name: "my-briefs" }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(own.status).toBe(201);
    const rebind = await h.req(`${PORTAL}/.api/cli/tools/${copy.id}/bindings`, { ...jsonInit("POST", { binding: "company-briefs", collectionId: (await own.json()).collection.id }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(rebind.status).toBe(200);
    const write2 = await put(copy.origin, "/._kitlane/data/shared/company-briefs/acme", { data: { name: "from copy" } }, aliceOnCopy);
    expect(write2.status).toBe(200);
    // The original collection is untouched.
    expect((await (await get(P(), "/._kitlane/data/shared/company-briefs/acme", bobOnPrep)).json()).data.summary).toBe("Carol edited");
  });

  it("shared bulk refresh is atomic and oversized refreshes are rejected", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ op: "set", id: `c${i}`, data: { i } }));
    const r = await post(P(), "/._kitlane/data/shared/company-briefs/_bulk", { ops: tooMany, replaceAll: true }, aliceOnPrep);
    expect(r.status).toBe(413);
    expect((await (await get(P(), "/._kitlane/data/shared/company-briefs", bobOnPrep)).json()).items.map((d: any) => d.id)).toEqual(["acme"]);
    const ok = await post(P(), "/._kitlane/data/shared/company-briefs/_bulk", { ops: [{ op: "set", id: "acme", data: { name: "Acme", summary: "refreshed" } }, { op: "set", id: "globex", data: { name: "Globex" } }], replaceAll: true }, aliceOnPrep);
    expect(ok.status).toBe(200);
    const after = await (await get(P(), "/._kitlane/data/shared/company-briefs", bobOnPrep)).json();
    expect(after.items.map((d: any) => d.id)).toEqual(["acme", "globex"]);
  });

  it("shared documents are audited by identifier only, personal documents are not audited", async () => {
    const shared = await h.db.query(`SELECT * FROM audit_events WHERE collection_id = $1 AND action LIKE 'shared_document.%'`, [collectionId]);
    expect(shared.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(shared.rows.map((r: any) => r.details))).not.toContain("Carol edited");
    const personal = await h.db.query(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'personal%'`);
    expect(personal.rows[0].n).toBe(0);
  });
});

describe("updater credentials", () => {
  let token: string;
  let updaterId: string;
  const U = (p: string) => `${PORTAL}/.api/updater${p}`;

  it("are issued by the collection owner with explicit scopes", async () => {
    const denied = await h.req(`${PORTAL}/.api/cli/updaters`, { ...jsonInit("POST", { label: "x", collectionIds: [collectionId], operations: ["write"] }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(bob)}` } });
    expect(denied.status).toBe(403);
    const res = await h.req(`${PORTAL}/.api/cli/updaters`, { ...jsonInit("POST", { label: "nightly", collectionIds: [collectionId], operations: ["read", "write", "bulk"] }), headers: { "content-type": "application/json", authorization: `Bearer ${await h.token(alice)}` } });
    expect(res.status).toBe(201);
    const body = await res.json();
    token = body.token;
    updaterId = body.updater.id;
    expect(token.startsWith("klu_")).toBe(true);
  });

  it("update shared data within scope; readers see it on the next fetch", async () => {
    const r = await h.req(U(`/collections/${collectionId}/documents/_bulk`), { ...jsonInit("POST", { ops: [{ op: "set", id: "acme", data: { name: "Acme", summary: "nightly refresh" } }] }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    const seen = await (await get(h.toolOrigin(prep.id), "/._kitlane/data/shared/company-briefs/acme", bobOnPrep)).json();
    expect(seen.data.summary).toBe("nightly refresh");
    expect(seen.updatedBy).toBe(updaterId);
    const list = await h.req(U(`/collections/${collectionId}/documents?limit=1`), { headers: { authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
  });

  it("cannot escape collection or operation scope, reach personal data, or publish", async () => {
    const other = await h.db.transaction((tx) => docs.createCollection(tx, userActor(bob.id), h.config.installationId, viewer, bob, "bob-things"));
    const cross = await h.req(U(`/collections/${other.id}/documents/x`), { ...jsonInit("PUT", { data: {} }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
    expect(cross.status).toBe(403);
    const delOp = await h.req(U(`/collections/${collectionId}/documents/acme`), { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    expect(delOp.status).toBe(403);
    const replaceAll = await h.req(U(`/collections/${collectionId}/documents/_bulk`), { ...jsonInit("POST", { ops: [{ op: "set", id: "acme", data: {} }], replaceAll: true }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
    expect(replaceAll.status).toBe(403);
    // Not a CLI token: cannot publish or read the catalog API.
    const cli = await h.req(`${PORTAL}/.api/cli/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(cli.status).toBe(401);
    // Not a session: cannot reach personal routes on a tool origin.
    const personal = await h.req(`${h.toolOrigin(prep.id)}/._kitlane/data/user/prefs/display`, { headers: { authorization: `Bearer ${token}` } });
    expect(personal.status).toBe(401);
    // A header claiming a tool changes nothing.
    const claimed = await h.req(U(`/collections/${other.id}/documents/x`), { ...jsonInit("PUT", { data: {} }), headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-kitlane-tool": prep.id, host: "evil" } });
    expect(claimed.status).toBe(403);
  });

  it("collection freeze blocks every path; revocation stops subsequent writes", async () => {
    const col = await docs.requireCollection(h.db, collectionId);
    await docs.setCollectionFrozen(h.db, userActor(admin.id), col, true, "test");
    expect((await h.req(U(`/collections/${collectionId}/documents/acme`), { ...jsonInit("PUT", { data: {} }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } })).status).toBe(423);
    expect((await get(h.toolOrigin(prep.id), "/._kitlane/data/shared/company-briefs/acme", bobOnPrep)).status).toBe(423);
    expect((await put(h.toolOrigin(prep.id), "/._kitlane/data/shared/company-briefs/acme", { data: {} }, aliceOnPrep)).status).toBe(423);
    // Tool freeze is separate: the collection stays readable through other tools when only a tool is frozen.
    await docs.setCollectionFrozen(h.db, userActor(admin.id), col, false, null);
    expect((await get(h.toolOrigin(viewer.id), "/._kitlane/data/shared/briefs/acme", bobOnViewer)).status).toBe(200);
    const revoke = await h.req(`${PORTAL}/.api/cli/updaters/${updaterId}`, { method: "DELETE", headers: { authorization: `Bearer ${await h.token(alice)}` } });
    expect(revoke.status).toBe(200);
    expect((await h.req(U(`/collections/${collectionId}/documents/acme`), { ...jsonInit("PUT", { data: {} }), headers: { "content-type": "application/json", authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe("export", () => {
  it("excludes personal records, credentials, tokens, and sessions", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/export?includeShared=1`, { headers: { authorization: `Bearer ${await h.token(bob)}` } });
    expect(res.status).toBe(200);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.sharedCollections.length).toBeGreaterThan(0);
    expect(data.sharedDocuments.length).toBeGreaterThan(0);
    // The personal document written earlier in this file ends as { theme: "green" }; entries carry a declared
    // theme column of their own, so the personal payload value is the marker for "personal data excluded".
    expect(text).not.toContain('"theme":"green"');
    expect(data).not.toHaveProperty("personalDocuments");
    expect(data.excludes).toContain("personal_documents");
    expect(text).not.toContain("klu_");
    expect(text).not.toContain("klp_");
    expect(text).not.toContain("kls_");
    expect(text).not.toContain("token_hash");
    expect(data.excludes).toContain("personal_documents");
  });
});
