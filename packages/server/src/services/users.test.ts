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
