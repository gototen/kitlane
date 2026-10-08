import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL, createHarness, jsonInit, type Harness } from "./test/harness.js";
import type { User } from "./types.js";

let h: Harness;
let invited: User, stranger: User, admin: User;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  h = await createHarness({ KITLANE_PUBLISHERS: "invited@example.test", KITLANE_BANNER: "Public demo: data is reset nightly.", KITLANE_REPORTING_CONTACT: "demo@example.test" });
  invited = await h.user("invited");
  stranger = await h.user("stranger");
  admin = await h.user("root", { admin: true });
});
afterAll(() => h.close());

describe("publishing allowlist (KITLANE_PUBLISHERS)", () => {
  let toolId: string;

  it("invited accounts and administrators can publish", async () => {
    const res = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "prep", title: "Prep" }), headers: { "content-type": "application/json", ...bearer(await h.token(invited)) } });
    expect(res.status).toBe(201);
    toolId = (await res.json()).tool.id;
    const up = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(invited)) }, body: await h.tarball({ "index.html": "<h1>v1</h1>" }) });
    expect(up.status).toBe(201);
    const byAdmin = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "admin-tool", title: "Admin tool" }), headers: { "content-type": "application/json", ...bearer(await h.token(admin)) } });
    expect(byAdmin.status).toBe(201);
  });

  it("strangers can browse, launch, and use tools but cannot publish, copy, or claim names", async () => {
    const cookie = await h.portalCookie(stranger);
    expect((await h.req(`${PORTAL}/`, { cookie })).status).toBe(200);
    expect((await h.req(`${PORTAL}/.search?q=prep`, { cookie })).status).toBe(200);
    expect((await h.req(`${PORTAL}/prep`, { cookie })).status).toBe(200);
    const toolCookie = await h.toolCookie(stranger, toolId);
    const write = await h.req(`${h.toolOrigin(toolId)}/._kitlane/data/user/prefs/x`, { ...jsonInit("PUT", { data: { a: 1 } }, h.toolOrigin(toolId)), cookie: toolCookie });
    expect(write.status).toBe(200);
    const t = await h.token(stranger);
    expect((await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name: "evil", title: "Evil" }), headers: { "content-type": "application/json", ...bearer(t) } })).status).toBe(403);
    expect((await h.req(`${PORTAL}/.api/cli/tools/${toolId}/copy`, { ...jsonInit("POST", { name: "prep-copy" }), headers: { "content-type": "application/json", ...bearer(t) } })).status).toBe(403);
    expect((await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(t) }, body: await h.tarball({ "index.html": "<h1>x</h1>" }) })).status).toBe(403);
    const form = await h.req(`${PORTAL}/.new`, { method: "POST", cookie, headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: "mode=external&name=evil&title=Evil&externalUrl=https%3A%2F%2Fexample.com", redirect: "manual" });
    expect(form.status).toBe(403);
    expect((await h.req(`${PORTAL}/.tool/${toolId}/copy`, { cookie })).status).toBe(403);
    const page = await (await h.req(`${PORTAL}/.new`, { cookie })).text();
    expect(page).toContain("limited to invited accounts");
    expect(page).toContain("demo@example.test");
  });

  it("even a co-maintainer outside the allowlist cannot upload versions", async () => {
    const add = await h.req(`${PORTAL}/.tool/${toolId}/maintainers/add`, { method: "POST", cookie: await h.portalCookie(invited), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body: `user=${stranger.id}`, redirect: "manual" });
    expect(add.status).toBe(303);
    const up = await h.req(`${PORTAL}/.api/cli/tools/${toolId}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(stranger)) }, body: await h.tarball({ "index.html": "<h1>x</h1>" }) });
    expect(up.status).toBe(403);
  });

  it("shows the banner on portal pages and in the drawer, and hides Make a copy from non-publishers", async () => {
    const cookie = await h.portalCookie(stranger);
    const home = await (await h.req(`${PORTAL}/`, { cookie })).text();
    expect(home).toContain("Public demo: data is reset nightly.");
    const detail = await (await h.req(`${PORTAL}/.tool/${toolId}`, { cookie })).text();
    expect(detail).not.toContain("Make a copy");
    const drawer = await (await h.req(`${PORTAL}/.api/shell/${toolId}/drawer`, { cookie })).text();
    expect(drawer).not.toContain("Make a copy");
    expect(drawer).toContain("Public demo");
    const invitedDetail = await (await h.req(`${PORTAL}/.tool/${toolId}`, { cookie: await h.portalCookie(invited) })).text();
    expect(invitedDetail).toContain("Make a copy");
  });
});
