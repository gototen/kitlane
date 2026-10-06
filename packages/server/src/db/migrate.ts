import type { Db } from "./index.js";
import { migrations } from "./migrations.js";

export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [m.name]);
    });
    ran.push(m.name);
  }
  return ran;
}
