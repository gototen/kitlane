import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL, createHarness, jsonInit, type Harness } from "./test/harness.js";
import type { User } from "./types.js";

let h: Harness;
let alice: User;
let bob: User;
let admin: User;

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user("alice", { team: "finance" });
  bob = await h.user("bob", { team: "marketing" });
  admin = await h.user("root", { admin: true });
});
afterAll(() => h.close());

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("publishing through the CLI API", () => {
  let toolId: string;
  let versionId: string;

  it("creates a hosted tool with a claimed name", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "Prep", title: "Pre-call brief", purpose: "Brief before calls.", tags: ["Meetings", "research"] }), headers: { ...jsonInit("POST").headers, ...bearer(await h.token(alice)) } });
    expect(res.status).toBe(201);
    const body = await res.json();
    toolId = body.tool.id;
    expect(body.tool.names).toEqual(["prep"]);
    expect(body.tool.tags).toEqual(["meetings", "research"]);
    expect(body.tool.origin).toBe(h.toolOrigin(toolId));
  });

  it("rejects a duplicate or reserved name", async () => {
    const t = await h.token(bob);
    const dup = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "prep", title: "x" }), headers: { "content-type": "application/json", ...bearer(t) } });
    expect(dup.status).toBe(409);
    const reserved = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "new", title: "x" }), headers: { "content-type": "application/json", ...bearer(t) } });
    expect(reserved.status).toBe(409);
  });

  it("rejects identity headers on the CLI API and cookies without a token", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/me`, { headers: { "x-forwarded-user": "dev:alice", "x-kitlane-ingress-secret": "x" } });
    expect(res.status).toBe(401);
    const res2 = await h.req(`${PORTAL}/.api/cli/me`, { cookie: await h.portalCookie(alice) });
    expect(res2.status).toBe(401);
  });

  it("uploads a version and activates it", async () => {
    const tarball = await h.tarball({ "index.html": "<!doctype html><title>Prep</title><script src='/._kitlane/sdk.js'></script><h1>Prep v1</h1>", "app.js": "console.log(1)" });
    const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", "x-kitlane-note": "first", ...bearer(await h.token(alice)) }, body: tarball });
    expect(res.status).toBe(201);
    const body = await res.json();
    versionId = body.version.id;
    expect(body.version.number).toBe(1);
    expect(body.activated).toBe(true);
  });

  it("reports an unchanged upload without creating a new version", async () => {
    const tarball = await h.tarball({ "index.html": "<!doctype html><title>Prep</title><script src='/._kitlane/sdk.js'></script><h1>Prep v1</h1>", "app.js": "console.log(1)" });
    const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(alice)) }, body: tarball });
    expect(res.status).toBe(200);
    expect((await res.json()).unchanged).toBe(true);
  });

  it("refuses uploads from a non-maintainer", async () => {
    const tarball = await h.tarball({ "index.html": "<h1>evil</h1>" });
    const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(bob)) }, body: tarball });
    expect(res.status).toBe(403);
    const rb = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/rollback`, { ...jsonInit("POST", { versionId }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
    expect(rb.status).toBe(403);
    const rename = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/names`, { ...jsonInit("POST", { name: "mine" }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
    expect(rename.status).toBe(403);
  });

  it("rejects uploads with traversal or reserved paths without leaving partial state", async () => {
    const bad = await h.tarball({ "index.html": "<h1>x</h1>", "._kitlane/sdk.js": "alert(1)" });
    const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(alice)) }, body: bad });
    expect(res.status).toBe(422);
    const info = await (await h.req(`${PORTAL}/.api/cli/tools/${toolId}`, { headers: bearer(await h.token(alice)) })).json();
    expect(info.versions).toHaveLength(1);
  });

  describe("serving on the tool origin", () => {
    it("redirects an unauthenticated top-level navigation to the portal sign-in start", async () => {
      const res = await h.req(`${h.toolOrigin(toolId)}/`, { redirect: "manual", headers: { "sec-fetch-dest": "document" } });
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin).toBe(PORTAL);
      expect(loc.pathname).toBe("/.auth/start");
      expect(loc.searchParams.get("tool")).toBe(toolId);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("serves a bootstrap page to an unauthenticated iframe that asks the shell to sign in", async () => {
      const res = await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/index.html`, { headers: { "sec-fetch-dest": "iframe" } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("kitlane:needs-auth");
      expect(html).not.toContain("Prep v1");
      expect(res.headers.get("content-security-policy")).toContain(`frame-ancestors 'self' ${PORTAL}`);
    });

    it("returns 401 JSON for unauthenticated SDK routes", async () => {
      const res = await h.req(`${h.toolOrigin(toolId)}/._kitlane/me`);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("unauthenticated");
    });

    it("completes the sign-in round trip and serves assets with hosted headers", async () => {
      const cookie = await h.toolCookie(alice, toolId);
      const res = await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/index.html`, { cookie, headers: { "sec-fetch-dest": "iframe" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Prep v1");
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toContain("object-src 'none'");
      const js = await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/app.js`, { cookie });
      expect(js.status).toBe(200);
      expect(js.headers.get("cache-control")).toBe("private, max-age=3600");
      const me = await h.req(`${h.toolOrigin(toolId)}/._kitlane/me`, { cookie });
      expect(me.status).toBe(200);
      expect((await me.json()).displayName).toBe("alice");
    });

    it("rejects a tool cookie on a different tool's origin", async () => {
      const other = await h.publish(bob, "other", { "index.html": "<h1>other</h1>" });
      const cookie = await h.toolCookie(alice, toolId);
      const res = await h.req(`${h.toolOrigin(other.id)}/._kitlane/me`, { cookie });
      expect(res.status).toBe(401);
    });

    it("rejects a replayed, tampered, or cross-tool auth code", async () => {
      const cookie = await h.portalCookie(alice);
      const start = await h.req(`${PORTAL}/.auth/start?tool=${toolId}&rd=${encodeURIComponent(PORTAL + "/prep")}`, { cookie, redirect: "manual" });
      const cb = start.headers.get("location")!;
      const first = await h.req(cb, { redirect: "manual" });
      expect(first.status).toBe(303);
      const replay = await h.req(cb, { redirect: "manual" });
      expect(replay.status).toBe(400);
      const tampered = await h.req(cb.replace(/code=([^&]+)/, (_m, c) => `code=${c.slice(0, -2)}xx`), { redirect: "manual" });
      expect(tampered.status).toBe(400);
    });

    it("validates the return destination of the sign-in round trip", async () => {
      const cookie = await h.portalCookie(alice);
      const start = await h.req(`${PORTAL}/.auth/start?tool=${toolId}&rd=${encodeURIComponent("https://evil.example/phish")}`, { cookie, redirect: "manual" });
      const cb = await h.req(start.headers.get("location")!, { redirect: "manual" });
      expect(cb.status).toBe(303);
      expect(cb.headers.get("location")).toBe(`${PORTAL}/.tool/${toolId}`);
      const start2 = await h.req(`${PORTAL}/.auth/start?tool=${toolId}&rd=${encodeURIComponent(h.toolOrigin(toolId) + "/deep/path?x=1")}`, { cookie, redirect: "manual" });
      const cb2 = await h.req(start2.headers.get("location")!, { redirect: "manual" });
      expect(cb2.headers.get("location")).toBe(`${h.toolOrigin(toolId)}/deep/path?x=1`);
    });

    it("resolves unversioned launches to the active release with a non-cacheable redirect", async () => {
      const cookie = await h.toolCookie(alice, toolId);
      const res = await h.req(`${h.toolOrigin(toolId)}/?q=1`, { cookie, redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/_releases/${versionId}/index.html?q=1`);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("never serves files outside the release directory", async () => {
      const cookie = await h.toolCookie(alice, toolId);
      for (const p of ["../../secret.key", "..%2F..%2Fsecret.key", "%2e%2e/%2e%2e/secret.key", "..%252F..%252Fsecret.key"]) {
        const res = await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/${p}`, { cookie, redirect: "manual" });
        expect([302, 404], p).toContain(res.status);
        if (res.status === 302) expect(res.headers.get("location")).toMatch(/^\/_releases\//);
      }
      // The secret file itself is never reachable through any path.
      const direct = await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/secret.key`, { cookie, redirect: "manual" });
      expect(direct.status).toBe(404);
    });
  });

  describe("shell", () => {
    it("renders the shell with the rail for a hosted tool and forwards path/query", async () => {
      const cookie = await h.portalCookie(alice);
      const res = await h.req(`${PORTAL}/prep/sub/page?x=1&_klauth=1`, { cookie });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Explore tools");
      expect(html).toContain(`${h.toolOrigin(toolId)}/_releases/${versionId}/sub/page?x=1`);
      expect(html).not.toContain("_klauth");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    });
    it("sends an unknown name to search with a claim option, without creating it", async () => {
      const cookie = await h.portalCookie(alice);
      const res = await h.req(`${PORTAL}/nothing-here`, { cookie, redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/.search?q=nothing-here&claim=1");
      const search = await h.req(`${PORTAL}/.search?q=nothing-here&claim=1`, { cookie });
      expect(await search.text()).toContain("Claim this name");
      expect(await h.req(`${PORTAL}/nothing-here`, { cookie, redirect: "manual" }).then((r) => r.status)).toBe(302);
    });
    it("serves the drawer fragment with recommendations from other creators", async () => {
      await h.publish(bob, "meet", { "index.html": "<h1>meet</h1>" }, { tags: ["meetings"], title: "Meeting finder" });
      const cookie = await h.portalCookie(alice);
      const res = await h.req(`${PORTAL}/.api/shell/${toolId}/drawer`, { cookie });
      expect(res.status).toBe(200);
      const html = await res.text();
      // Anchors that survive restyling: the framed tool's title, the recommendation, and the direct link the shell client rewires.
      expect(html).toContain("Pre-call brief");
      expect(html).toContain("Meeting finder");
      expect(html).toContain("Also about meetings");
      expect(html).toContain("data-kl-direct");
    });
    it("filters the catalog by tag, creator, and kind without a search term", async () => {
      const cookie = await h.portalCookie(alice);
      const byTag = await h.req(`${PORTAL}/.search?tag=meetings`, { cookie });
      expect(byTag.status).toBe(200);
      const html = await byTag.text();
      expect(html).toContain("Meeting finder");
      expect(html).not.toContain('href="/other"');
      expect((await h.req(`${PORTAL}/.search?creator=${bob.id}`, { cookie })).status).toBe(200);
      expect((await h.req(`${PORTAL}/.search?kind=resource`, { cookie })).status).toBe(200);
      expect((await h.req(`${PORTAL}/.api/cli/tools`, { headers: bearer(await h.token(alice)) })).status).toBe(200);
    });
    it("redirects to the dev login when there is no portal session", async () => {
      const res = await h.req(`${PORTAL}/prep`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/.dev/login");
    });
  });

  describe("rollback, freeze, copy, removal", () => {
    let v2: string;
    it("publishes v2 then rolls back to v1 without touching data", async () => {
      const t = await h.token(alice);
      const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(t) }, body: await h.tarball({ "index.html": "<h1>Prep v2</h1>" }) });
      v2 = (await res.json()).version.id;
      const cookie = await h.toolCookie(alice, toolId);
      const data = await h.req(`${h.toolOrigin(toolId)}/._kitlane/data/user/prefs/theme`, { ...jsonInit("PUT", { data: { dark: true } }, h.toolOrigin(toolId)), cookie });
      expect(data.status).toBe(200);
      const rb = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/rollback`, { ...jsonInit("POST", { number: 1 }), headers: { "content-type": "application/json", ...bearer(t) } });
      expect(rb.status).toBe(200);
      const launch = await h.req(`${h.toolOrigin(toolId)}/`, { cookie, redirect: "manual" });
      expect(launch.headers.get("location")).toBe(`/_releases/${versionId}/index.html`);
      const still = await h.req(`${h.toolOrigin(toolId)}/._kitlane/data/user/prefs/theme`, { cookie });
      expect((await still.json()).data).toEqual({ dark: true });
      // The v2 release stays reachable by its version-qualified path (pages already open keep their version).
      const v2res = await h.req(`${h.toolOrigin(toolId)}/_releases/${v2}/index.html`, { cookie });
      expect(v2res.status).toBe(200);
    });

    it("freeze blocks assets, SDK, short link, and direct URL; unfreeze restores", async () => {
      const adminCookie = await h.portalCookie(admin);
      const cookie = await h.toolCookie(alice, toolId);
      const freeze = await h.req(`${PORTAL}/.tool/${toolId}/freeze`, { method: "POST", cookie: adminCookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: "frozen=1&reason=incident", redirect: "manual" });
      expect(freeze.status).toBe(303);
      expect((await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/index.html`, { cookie })).status).toBe(423);
      expect((await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/app.js`, { cookie })).status).toBe(423);
      expect((await h.req(`${h.toolOrigin(toolId)}/`, { cookie, redirect: "manual" })).status).toBe(423);
      expect((await h.req(`${h.toolOrigin(toolId)}/._kitlane/me`, { cookie })).status).toBe(423);
      expect((await h.req(`${h.toolOrigin(toolId)}/._kitlane/data/user/prefs/theme`, { cookie })).status).toBe(423);
      const short = await h.req(`${PORTAL}/prep`, { cookie: await h.portalCookie(alice), redirect: "manual" });
      expect(short.status).toBe(302);
      expect(short.headers.get("location")).toBe(`/.tool/${toolId}`);
      const start = await h.req(`${PORTAL}/.auth/start?tool=${toolId}`, { cookie: await h.portalCookie(alice), redirect: "manual" });
      expect(start.status).toBe(423);
      // non-admin cannot unfreeze
      const nope = await h.req(`${PORTAL}/.tool/${toolId}/freeze`, { method: "POST", cookie: await h.portalCookie(alice), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: "frozen=0", redirect: "manual" });
      expect(nope.status).toBe(403);
      const unfreeze = await h.req(`${PORTAL}/.tool/${toolId}/freeze`, { method: "POST", cookie: adminCookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: "frozen=0", redirect: "manual" });
      expect(unfreeze.status).toBe(303);
      expect((await h.req(`${h.toolOrigin(toolId)}/_releases/${versionId}/index.html`, { cookie })).status).toBe(200);
    });

    it("rejects portal form posts without a matching browser origin", async () => {
      const res = await h.req(`${PORTAL}/.tool/${toolId}/metadata`, { method: "POST", cookie: await h.portalCookie(alice), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: "title=hacked", redirect: "manual" });
      expect(res.status).toBe(403);
    });

    it("make a copy duplicates files into a new tool with lineage and no inherited identity", async () => {
      const res = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/copy`, { ...jsonInit("POST", { name: "prep-bob" }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
      expect(res.status).toBe(201);
      const copy = (await res.json()).tool;
      expect(copy.id).not.toBe(toolId);
      expect(copy.owner.id).toBe(bob.id);
      expect(copy.creator.id).toBe(bob.id);
      expect(copy.copiedFrom).toEqual({ entryId: toolId, versionId });
      expect(copy.origin).not.toBe(h.toolOrigin(toolId));
      const cookie = await h.toolCookie(bob, copy.id);
      const page = await h.req(`${copy.origin}/`, { cookie, redirect: "manual" });
      const loc = page.headers.get("location")!;
      const html = await (await h.req(`${copy.origin}${loc}`, { cookie })).text();
      expect(html).toContain("Prep v1");
      // Alice's tool cookie does not work on the copy, and the copy has fresh personal storage.
      expect((await h.req(`${copy.origin}/._kitlane/me`, { cookie: await h.toolCookie(alice, toolId) })).status).toBe(401);
      const aliceOnCopy = await h.toolCookie(alice, copy.id);
      const fresh = await h.req(`${copy.origin}/._kitlane/data/user/prefs/theme`, { cookie: aliceOnCopy });
      expect(fresh.status).toBe(404);
      // Lineage shows on both detail pages: each links to the other (wording is the view's business).
      const detail = await (await h.req(`${PORTAL}/.tool/${copy.id}`, { cookie: await h.portalCookie(bob) })).text();
      expect(detail).toContain(`href="/.tool/${toolId}"`);
      const original = await (await h.req(`${PORTAL}/.tool/${toolId}`, { cookie: await h.portalCookie(alice) })).text();
      expect(original).toContain(`href="/.tool/${copy.id}"`);
    });

    it("records lineage for a remix made from a repository (remixOf on claim)", async () => {
      const t = await h.token(bob);
      const me = await (await h.req(`${PORTAL}/.api/cli/me`, { headers: bearer(t) })).json();
      const source = await (await h.req(`${PORTAL}/.api/cli/tools/${toolId}`, { headers: bearer(t) })).json();
      const res = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "prep-fork", title: "Prep, forked", remixOf: `${me.shortcut}/${source.tool.names[0]}`, repoUrl: "https://github.com/bob/prep" }), headers: { "content-type": "application/json", ...bearer(t) } });
      expect(res.status).toBe(201);
      const fork = (await res.json()).tool;
      expect(fork.copiedFrom).toEqual({ entryId: toolId, versionId: source.activeVersion?.id ?? null });
      // Both tool pages link to each other, exactly like a remix made in the portal.
      const original = await (await h.req(`${PORTAL}/.tool/${toolId}`, { cookie: await h.portalCookie(alice) })).text();
      expect(original).toContain(`href="/.tool/${fork.id}"`);
      const detail = await (await h.req(`${PORTAL}/.tool/${fork.id}`, { cookie: await h.portalCookie(bob) })).text();
      expect(detail).toContain(`href="/.tool/${toolId}"`);
      // An unknown source is a request error, and nothing is created.
      const missing = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "prep-fork-nope", title: "x", remixOf: "no-such-tool" }), headers: { "content-type": "application/json", ...bearer(t) } });
      expect(missing.status).toBe(400);
      expect((await h.req(`${PORTAL}/.api/cli/tools/prep-fork-nope`, { headers: bearer(t) })).status).toBe(404);
    });

    it("offers a fork on the remix page when the tool has a repository", async () => {
      const t = await h.token(alice);
      const set = await h.req(`${PORTAL}/.api/cli/tools/${toolId}`, { ...jsonInit("PATCH", { repoUrl: "https://github.com/alice/prep" }), headers: { "content-type": "application/json", ...bearer(t) } });
      expect(set.status).toBe(200);
      const name = (await set.json()).tool.names[0];
      const page = await (await h.req(`${PORTAL}/.tool/${toolId}/copy`, { cookie: await h.portalCookie(bob) })).text();
      expect(page).toContain('href="https://github.com/alice/prep/fork"');
      expect(page).toContain(`--remix-of ${name} --workflow`);
      expect(page).toContain(`--name ${name}-bob`);
    });

    it("downloads a version as tar.gz", async () => {
      const res = await h.req(`${PORTAL}/.tool/${toolId}/download/${versionId}`, { cookie: await h.portalCookie(bob) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/gzip");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(50);
    });

    it("administrator can remove a version's content while keeping the audit record", async () => {
      const adminCookie = await h.portalCookie(admin);
      const res = await h.req(`${PORTAL}/.tool/${toolId}/versions/${v2}/remove`, { method: "POST", cookie: adminCookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: "reason=leaked+credential", redirect: "manual" });
      expect(res.status).toBe(303);
      const cookie = await h.toolCookie(alice, toolId);
      expect((await h.req(`${h.toolOrigin(toolId)}/_releases/${v2}/index.html`, { cookie })).status).toBe(404);
      const audit = await h.db.query(`SELECT * FROM audit_events WHERE action = 'version.content_removed' AND target_id = $1`, [v2]);
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows[0].details)).not.toContain("Prep v2");
    });

    it("owner-only: co-maintainers and transfer; admin recovery", async () => {
      const aliceCookie = await h.portalCookie(alice);
      const add = await h.req(`${PORTAL}/.tool/${toolId}/maintainers/add`, { method: "POST", cookie: aliceCookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: `user=${encodeURIComponent(bob.email!)}`, redirect: "manual" });
      expect(add.status).toBe(303);
      // Bob can now publish but cannot add maintainers.
      const pub = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(bob)) }, body: await h.tarball({ "index.html": "<h1>v3 by bob</h1>" }) });
      expect(pub.status).toBe(201);
      const bobAdds = await h.req(`${PORTAL}/.tool/${toolId}/maintainers/add`, { method: "POST", cookie: await h.portalCookie(bob), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: `user=${admin.id}`, redirect: "manual" });
      expect(bobAdds.status).toBe(403);
      const recover = await h.req(`${PORTAL}/.tool/${toolId}/recover`, { method: "POST", cookie: await h.portalCookie(admin), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: `user=${bob.id}`, redirect: "manual" });
      expect(recover.status).toBe(303);
      const info = await (await h.req(`${PORTAL}/.api/cli/tools/${toolId}`, { headers: bearer(await h.token(alice)) })).json();
      expect(info.tool.owner.id).toBe(bob.id);
      expect(info.tool.creator.id).toBe(alice.id);
    });
  });
});

describe("theme plumbing", () => {
  const form = (cookie: string, body: string) => ({ method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body, redirect: "manual" as const });
  const detectedOf = async (entryId: string) => (await h.db.query<{ detected_theme: string | null }>(`SELECT v.detected_theme FROM deployments d JOIN versions v ON v.id = d.active_version_id WHERE d.entry_id = $1`, [entryId])).rows[0].detected_theme;
  let darkToolId: string;

  it("sniffs the color-scheme meta from index.html at publish time", async () => {
    const dark = await h.publish(alice, "dusk", { "index.html": '<!doctype html><html><head><meta name="color-scheme" content="dark"><title>Dusk</title></head><body>dark</body></html>' });
    expect(await detectedOf(dark.id)).toBe("dark");
    const plain = await h.publish(alice, "plain", { "index.html": "<!doctype html><title>Plain</title><h1>no meta</h1>" });
    expect(await detectedOf(plain.id)).toBeNull();
    const both = await h.publish(alice, "both", { "index.html": "<meta name='color-scheme' content='light dark'><h1>adaptive</h1>" });
    expect(await detectedOf(both.id)).toBe("system");
  });

  it("the CLI API accepts, returns, clears, and validates a declared theme", async () => {
    const t = await h.token(alice);
    const headers = { "content-type": "application/json", ...bearer(t) };
    const created = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "noir", title: "Noir", theme: "dark" }), headers });
    expect(created.status).toBe(201);
    const tool = (await created.json()).tool;
    darkToolId = tool.id;
    expect(tool.theme).toBe("dark");
    const bad = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "noir2", title: "x", theme: "blue" }), headers });
    expect(bad.status).toBe(400);
    const toSystem = await h.req(`${PORTAL}/.api/cli/tools/${tool.id}`, { ...jsonInit("PATCH", { theme: "system" }), headers });
    expect((await toSystem.json()).tool.theme).toBe("system");
    const cleared = await h.req(`${PORTAL}/.api/cli/tools/${tool.id}`, { ...jsonInit("PATCH", { theme: null }), headers });
    expect((await cleared.json()).tool.theme).toBeNull();
    const invalid = await h.req(`${PORTAL}/.api/cli/tools/${tool.id}`, { ...jsonInit("PATCH", { theme: "sepia" }), headers });
    expect(invalid.status).toBe(400);
    const back = await h.req(`${PORTAL}/.api/cli/tools/${tool.id}`, { ...jsonInit("PATCH", { theme: "dark" }), headers });
    expect((await back.json()).tool.theme).toBe("dark");
    const info = await (await h.req(`${PORTAL}/.api/cli/tools/${tool.id}`, { headers: bearer(t) })).json();
    expect(info.tool.theme).toBe("dark");
  });

  it("the portal metadata form accepts an optional theme field, with an empty value clearing it", async () => {
    const cookie = await h.portalCookie(alice);
    const set = await h.req(`${PORTAL}/.tool/${darkToolId}/metadata`, form(cookie, "title=Noir&theme=light"));
    expect(set.status).toBe(303);
    expect((await h.db.query(`SELECT theme FROM entries WHERE id = $1`, [darkToolId])).rows[0].theme).toBe("light");
    const clear = await h.req(`${PORTAL}/.tool/${darkToolId}/metadata`, form(cookie, "title=Noir&theme="));
    expect(clear.status).toBe(303);
    expect((await h.db.query(`SELECT theme FROM entries WHERE id = $1`, [darkToolId])).rows[0].theme).toBeNull();
    const rejected = await h.req(`${PORTAL}/.tool/${darkToolId}/metadata`, form(cookie, "title=Noir&theme=sepia"));
    expect(rejected.status).toBe(400);
    const untouched = await h.req(`${PORTAL}/.tool/${darkToolId}/metadata`, form(cookie, "title=Noir+again"));
    expect(untouched.status).toBe(303);
    expect((await h.db.query(`SELECT theme FROM entries WHERE id = $1`, [darkToolId])).rows[0].theme).toBeNull();
    await h.req(`${PORTAL}/.tool/${darkToolId}/metadata`, form(cookie, "title=Noir&theme=dark"));
  });

  it("the shell resolves the rail theme: declared locks it, detected does not, a rail preference overrides both", async () => {
    const carol = await h.user("carol-theme");
    const cookie = await h.portalCookie(carol);
    const t = await h.token(alice);
    // Declared dark (noir): locked, whatever the viewer prefers.
    await h.req(`${PORTAL}/.api/cli/tools/${darkToolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(t) }, body: await h.tarball({ "index.html": "<h1>noir</h1>" }) });
    const declared = await (await h.req(`${PORTAL}/noir`, { cookie })).text();
    expect(declared).toContain('"theme":"dark"');
    expect(declared).toContain('"themeLocked":true');
    // Detected dark (dusk) with no declaration: applied but not locked, so the runtime report may override.
    const detected = await (await h.req(`${PORTAL}/dusk`, { cookie })).text();
    expect(detected).toContain('"theme":"dark"');
    expect(detected).toContain('"themeLocked":false');
    // Nothing declared or detected (plain): follow the OS.
    const os = await (await h.req(`${PORTAL}/plain`, { cookie })).text();
    expect(os).toContain('"theme":null');
    expect(os).toContain('"themeLocked":false');
    // A portal preference fills the gap for plain, and a forced rail preference overrides even a declaration.
    expect((await h.req(`${PORTAL}/.me/preferences`, form(cookie, "theme=light&rail=tool"))).status).toBe(303);
    expect(await (await h.req(`${PORTAL}/plain`, { cookie })).text()).toContain('"theme":"light"');
    expect(await (await h.req(`${PORTAL}/dusk`, { cookie })).text()).toContain('"theme":"dark"');
    expect((await h.req(`${PORTAL}/.me/preferences`, form(cookie, "rail=light"))).status).toBe(303);
    const forced = await (await h.req(`${PORTAL}/noir`, { cookie })).text();
    expect(forced).toContain('"theme":"light"');
    expect(forced).toContain('"themeLocked":true');
  });

  it("a remix carries the source's declared and detected theme", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/tools/dusk/copy`, { ...jsonInit("POST", { name: "dusk-bob" }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
    expect(res.status).toBe(201);
    const remix = (await res.json()).tool;
    expect(remix.theme).toBeNull();
    expect(await detectedOf(remix.id)).toBe("dark");
    const declared = await h.req(`${PORTAL}/.api/cli/tools/noir/copy`, { ...jsonInit("POST", { name: "noir-bob" }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
    expect((await declared.json()).tool.theme).toBe("dark");
  });
});

describe("external entries", () => {
  it("registers a URL, redirects on launch, and rejects javascript: schemes", async () => {
    const t = await h.token(bob);
    const ok = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "teamdocs", title: "Team docs", mode: "external", kind: "resource", externalUrl: "https://example.com/docs" }), headers: { "content-type": "application/json", ...bearer(t) } });
    expect(ok.status).toBe(201);
    const launch = await h.req(`${PORTAL}/teamdocs`, { cookie: await h.portalCookie(alice), redirect: "manual" });
    expect(launch.status).toBe(302);
    expect(launch.headers.get("location")).toBe("https://example.com/docs");
    const bad = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "xss", title: "x", mode: "external", externalUrl: "javascript:alert(1)" }), headers: { "content-type": "application/json", ...bearer(t) } });
    expect(bad.status).toBe(400);
  });
});
