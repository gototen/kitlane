import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL, createHarness, jsonInit, type Harness } from "./test/harness.js";
import { measurementReport } from "./services/discovery.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("discovery measurement", () => {
  it("records rail, drawer, and recommendation events and computes the north star", async () => {
    const alice = await h.user("alice", { team: "finance" });
    const bob = await h.user("bob", { team: "marketing" });
    const prep = await h.publish(alice, "prep", { "index.html": "<h1>p</h1>" }, { tags: ["meetings"] });
    const meet = await h.publish(alice, "meet", { "index.html": "<h1>m</h1>" }, { tags: ["meetings"] });
    const cookie = await h.portalCookie(bob);
    const send = (body: unknown) => h.req(`${PORTAL}/.api/discovery`, { ...jsonInit("POST", body, PORTAL), cookie });
    expect((await send({ type: "rail_rendered", sourceEntryId: prep.id })).status).toBe(200);
    expect((await send({ type: "drawer_opened", sourceEntryId: prep.id })).status).toBe(200);
    expect((await send({ type: "recommendation_launched", sourceEntryId: prep.id, targetEntryId: meet.id, placement: 2, reason: "shared_tag" })).status).toBe(200);
    expect((await send({ type: "search", q: "secret query" })).status).toBe(400);
    // Bob returns to meet two days later via direct access.
    await h.db.query(`UPDATE discovery_events SET at = at - interval '3 days'`);
    const toolCookie = await h.toolCookie(bob, meet.id);
    const active = await h.db.query<{ active_version_id: string }>(`SELECT active_version_id FROM deployments WHERE entry_id = $1`, [meet.id]);
    const r = await h.req(`${h.toolOrigin(meet.id)}/_releases/${active.rows[0].active_version_id}/index.html`, { cookie: toolCookie, headers: { "sec-fetch-dest": "document" } });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 50));
    const report = await measurementReport(h.db, 30);
    expect(report.stages).toMatchObject({ opportunity: 1, engagement: 1, discovery: 1 });
    expect(report.stages.accessEvents).toBeGreaterThanOrEqual(1);
    expect(report.railOriginated.pairs).toBe(1);
    expect(report.railOriginated.returningWithin7Days).toBe(1);
    expect(report.railOriginated.crossTeamReturning).toBe(1);
    const events = await h.db.query(`SELECT * FROM discovery_events`);
    expect(JSON.stringify(events.rows)).not.toContain("secret query");
    // Creators testing their own tools are excluded.
    const aliceCookie = await h.portalCookie(alice);
    await h.req(`${PORTAL}/.api/discovery`, { ...jsonInit("POST", { type: "recommendation_launched", sourceEntryId: prep.id, targetEntryId: meet.id, placement: 1 }, PORTAL), cookie: aliceCookie });
    const report2 = await measurementReport(h.db, 30);
    expect(report2.railOriginated.pairs).toBe(1);
  });

  it("admin measurement page renders; non-admins are refused", async () => {
    const bob = await h.user("bob2");
    const admin = await h.user("root", { admin: true });
    expect((await h.req(`${PORTAL}/.admin/measurement`, { cookie: await h.portalCookie(bob) })).status).toBe(403);
    const ok = await h.req(`${PORTAL}/.admin/measurement`, { cookie: await h.portalCookie(admin) });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("North star");
  });
});
