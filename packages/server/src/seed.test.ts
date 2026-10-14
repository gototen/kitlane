import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createHarness } from "./test/harness.js";
import { runSeed } from "./seed.js";
import { getEntryByName } from "./services/entries.js";
import { getActiveVersion } from "./services/versions.js";

const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples");
// The seed publishes the built minified example; `npm run build` produces it (CI builds before testing).
const built = fs.existsSync(path.join(examples, "tz-minified/dist/index.html"));

describe("seed", () => {
  it.skipIf(!built)("publishes the demonstration tools with their declared themes and is idempotent", async () => {
    const h = await createHarness({ KITLANE_MAX_DOC_BYTES: String(256 * 1024), KITLANE_SHARED_QUOTA_BYTES: String(50 * 1024 * 1024), KITLANE_MAX_BULK_DOCS: "500" });
    const log = console.log;
    console.log = () => undefined;
    try {
      await runSeed(h.db, h.config);
      const focus = (await getEntryByName(h.db, "focus"))!;
      expect(focus.theme).toBe("dark");
      expect((await getActiveVersion(h.db, focus.id))!.detected_theme).toBe("dark");
      for (const name of ["prep", "briefs-editor", "meet"]) {
        const e = (await getEntryByName(h.db, name))!;
        expect(e.theme, name).toBe("system");
        expect((await getActiveVersion(h.db, e.id))!.detected_theme, name).toBe("system");
      }
      // Running again finds kit/prep and does nothing.
      await runSeed(h.db, h.config);
      expect((await h.db.query(`SELECT count(*)::int AS n FROM entries`)).rows[0].n).toBe(6);
    } finally {
      console.log = log;
      await h.close();
    }
  });
});
