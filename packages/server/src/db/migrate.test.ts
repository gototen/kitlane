import { describe, expect, it } from "vitest";
import { openDatabase } from "./index.js";
import { migrate } from "./migrate.js";

describe("migrations", () => {
  it("applies 003_theme on top of 001 and 002 against a scratch database, once", async () => {
    const db = await openDatabase("pglite://memory");
    try {
      expect(await migrate(db)).toEqual(["001_init", "002_team_lock", "003_theme"]);
      expect(await migrate(db)).toEqual([]);
      const cols = await db.query<{ table_name: string; column_name: string; column_default: string | null }>(
        `SELECT table_name, column_name, column_default FROM information_schema.columns
         WHERE (table_name, column_name) IN (('entries','theme'), ('versions','detected_theme'), ('users','theme_pref'), ('users','rail_pref'))
         ORDER BY table_name, column_name`,
      );
      expect(cols.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual(["entries.theme", "users.rail_pref", "users.theme_pref", "versions.detected_theme"]);
      expect(cols.rows.find((r) => r.column_name === "theme_pref")!.column_default).toContain("system");
      expect(cols.rows.find((r) => r.column_name === "rail_pref")!.column_default).toContain("tool");
      // The CHECK constraints reject anything outside the three settings.
      await expect(db.query(`INSERT INTO users (id, external_id, display_name, theme_pref) VALUES ('u1', 'x', 'x', 'blue')`)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
