import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL, createHarness, jsonInit, type Harness } from "./test/harness.js";
import { buildToday } from "./services/today.js";
import * as entries from "./services/entries.js";
import { userActor, type User } from "./types.js";

let h: Harness;
let alice: User;
let bob: User;
let carol: User;
let admin: User;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function publish(user: User, name: string, title: string, purpose: string, tags: string[]): Promise<string> {
  const create = await h.req(`${PORTAL}/.api/cli/tools`, { ...jsonInit("POST", { name, title, purpose, tags }), headers: { "content-type": "application/json", ...bearer(await h.token(user)) } });
  expect(create.status).toBe(201);
  const id = (await create.json()).tool.id;
  const tarball = await h.tarball({ "index.html": `<!doctype html><title>${title}</title><h1>${title}</h1>` });
  const up = await h.req(`${PORTAL}/.api/cli/tools/${id}/versions`, { method: "POST", headers: { "content-type": "application/gzip", ...bearer(await h.token(user)) }, body: tarball });
  expect(up.status).toBe(201);
  return id;
}

beforeAll(async () => {
  h = await createHarness();
  alice = await h.user("alice", { team: "finance" });
  bob = await h.user("bob", { team: "marketing" });
  carol = await h.user("carol", { team: "research" });
  admin = await h.user("root", { admin: true });
});
afterAll(() => h.close());

describe("the Today page picks", () => {
  it("shows an empty shelf honestly", async () => {
    const t = await buildToday(h.db, bob.id, "kit");
    expect(t.stories).toEqual([]);
    expect(t.collection).toBeNull();
    expect(t.totalTools).toBe(0);
    expect(t.counts).toEqual({ newTools: 0, newRemixes: 0, days: 7 });
  });

  it("leads with the newest original tool, then a remix, then another team, then the steadiest", async () => {
    const prep = await publish(alice, "prep", "Pre-call brief", "Briefs before calls.", ["meetings", "research"]);
    await publish(bob, "focus", "Focus timer", "A timer with a log.", ["productivity"]);
    const meet = await publish(carol, "meet", "Meeting time finder", "Times across cities.", ["meetings"]);
    await entries.setLifecycle(h.db, userActor(alice.id), (await entries.getEntry(h.db, prep))!, "maintained");
    await entries.setLifecycle(h.db, userActor(bob.id), (await entries.getEntryByName(h.db, "focus"))!, "maintained");
    // Bob remixes prep through the CLI API (the route keeps its historical name).
    const remix = await h.req(`${PORTAL}/.api/cli/tools/${prep}/copy`, { ...jsonInit("POST", { name: "prep-eng", title: "Pre-call brief, engineering edition" }), headers: { "content-type": "application/json", ...bearer(await h.token(bob)) } });
    expect(remix.status).toBe(201);

    const t = await buildToday(h.db, bob.id, "kit");
    const slots = t.stories.map((s) => s.slot);
    expect(slots[0]).toBe("newest");
    expect(t.stories[0].entry.copied_from_entry_id).toBeNull();
    expect(slots).toContain("remix");
    const remixStory = t.stories.find((s) => s.slot === "remix")!;
    expect(remixStory.entry.names).toEqual(["prep-eng"]);
    expect(remixStory.byline).toContain("remix of alice’s");
    expect(remixStory.byline).toContain("Pre-call brief");
    expect(slots).toContain("team");
    const teamStory = t.stories.find((s) => s.slot === "team")!;
    expect(teamStory.label).toMatch(/^New from /);
    const earlierTeams = t.stories.slice(0, slots.indexOf("team")).map((s) => s.entry.creator_team);
    expect(earlierTeams).not.toContain(teamStory.entry.creator_team);
    expect(slots).toContain("steady");
    expect(t.stories.find((s) => s.slot === "steady")!.entry.lifecycle).toBe("maintained");
    // No tool appears twice.
    expect(new Set(t.stories.map((s) => s.entry.id)).size).toBe(t.stories.length);
    // The most common tag becomes the set, and the person's own tools are listed.
    expect(t.collection?.tag).toBe("meetings");
    expect(t.collection?.entries.map((e) => e.id).sort()).toEqual([meet, prep, remixStory.entry.id].sort());
    expect(t.mine.map((e) => e.names[0]).sort()).toEqual(["focus", "prep-eng"]);
    expect(t.counts.newTools).toBe(3);
    expect(t.counts.newRemixes).toBe(1);
  });

  it("lets an administrator take the lead with the featured flag", async () => {
    const focus = (await entries.getEntryByName(h.db, "focus"))!;
    await entries.setFeatured(h.db, userActor(admin.id), focus, true);
    const t = await buildToday(h.db, bob.id, "kit");
    expect(t.stories[0].slot).toBe("featured");
    expect(t.stories[0].entry.id).toBe(focus.id);
    expect(t.stories[0].label).toBe("Featured");
    await entries.setFeatured(h.db, userActor(admin.id), focus, false);
  });

  it("drops frozen and retired tools from every slot", async () => {
    const meet = (await entries.getEntryByName(h.db, "meet"))!;
    await entries.setFrozen(h.db, userActor(admin.id), meet, true, "test");
    const t = await buildToday(h.db, bob.id, "kit");
    expect(t.stories.some((s) => s.entry.id === meet.id)).toBe(false);
    expect(t.collection?.entries.some((e) => e.id === meet.id)).toBe(false);
    await entries.setFrozen(h.db, userActor(admin.id), meet, false, null);
  });
});
