import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/harness.js";
import { upsertUserFromIdentity } from "./users.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("identity adoption", () => {
  it("a real sign-in adopts a seeded synthetic user with the same email, once", async () => {
    const seeded = await upsertUserFromIdentity(h.db, h.config, { externalId: "dev:alice", displayName: "Alice", email: "alice@example.test", team: "finance" }, { devUser: true });
    const real = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-123", displayName: "alice", email: "Alice@Example.test", team: null });
    expect(real.id).toBe(seeded.id);
    expect(real.external_id).toBe("oidc-sub-123");
    expect(real.is_dev_user).toBe(false);
    expect(real.team).toBe("finance");
    // A later sign-in with the same subject is the same user; another real account with that email is not adopted.
    const again = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-123", displayName: "alice", email: "alice@example.test" });
    expect(again.id).toBe(seeded.id);
    const other = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-999", displayName: "impostor", email: "alice@example.test" });
    expect(other.id).not.toBe(seeded.id);
  });
  it("never adopts a real user's row", async () => {
    const real = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-bob", displayName: "bob", email: "bob@example.test" });
    const second = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-bob2", displayName: "bob2", email: "bob@example.test" });
    expect(second.id).not.toBe(real.id);
  });
});

describe("administrator-assigned teams", () => {
  it("an assigned team is kept across sign-ins until cleared", async () => {
    const { setUserTeam } = await import("./users.js");
    const u = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-carol", displayName: "carol", email: "carol@example.test", team: null });
    expect(u.team).toBeNull();
    await setUserTeam(h.db, u.id, " Research ");
    const again = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-carol", displayName: "carol", email: "carol@example.test", team: "example.test" });
    expect(again.team).toBe("research");
    expect(again.team_locked).toBe(true);
    await setUserTeam(h.db, u.id, null);
    const unlocked = await upsertUserFromIdentity(h.db, h.config, { externalId: "oidc-sub-carol", displayName: "carol", email: "carol@example.test", team: "example.test" });
    expect(unlocked.team).toBe("example.test");
    expect(unlocked.team_locked).toBe(false);
  });
  it("only administrators can assign teams, and the assignment is audited", async () => {
    const { PORTAL } = await import("../test/harness.js");
    const admin = await h.user("root2", { admin: true });
    const plain = await h.user("plain");
    const target = await h.user("target");
    const body = `user=${encodeURIComponent(target.email!)}&team=finance`;
    const denied = await h.req(`${PORTAL}/.admin/users/team`, { method: "POST", cookie: await h.portalCookie(plain), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body, redirect: "manual" });
    expect(denied.status).toBe(403);
    const ok = await h.req(`${PORTAL}/.admin/users/team`, { method: "POST", cookie: await h.portalCookie(admin), headers: { "content-type": "application/x-www-form-urlencoded", origin: PORTAL }, body, redirect: "manual" });
    expect(ok.status).toBe(303);
    const row = await h.db.query<{ team: string; team_locked: boolean }>(`SELECT team, team_locked FROM users WHERE id = $1`, [target.id]);
    expect(row.rows[0]).toEqual({ team: "finance", team_locked: true });
    const audit = await h.db.query(`SELECT 1 FROM audit_events WHERE action = 'user.team_assigned' AND target_id = $1`, [target.id]);
    expect(audit.rows).toHaveLength(1);
    const page = await (await h.req(`${PORTAL}/.admin`, { cookie: await h.portalCookie(admin) })).text();
    expect(page).toContain("Assign a team");
    expect(page).toContain("assigned");
  });
});
