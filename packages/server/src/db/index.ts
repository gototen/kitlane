export interface QueryResult<R> {
  rows: R[];
  rowCount: number;
}

export interface Queryable {
  query<R = any>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
  /** Runs one or more statements without parameters (used by migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: "pg" | "pglite";
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(url: string): Promise<Db> {
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    return openPglite(target === "memory" || target === "" ? undefined : target);
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return openPg(url);
  }
  throw new Error(`Unsupported KITLANE_DATABASE_URL: ${url}`);
}

async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const wrap = (q: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>;
    exec: (t: string) => Promise<unknown>;
  }): Queryable => ({
    async query(text, params) {
      const r = await q.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await q.exec(sql);
    },
  });
  const base = wrap(pg);
  // PGlite is a single connection; transactions are serialized through a queue.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "pglite",
    query: base.query,
    exec: base.exec,
    transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const run = () => pg.transaction(async (tx) => fn(wrap(tx as any)));
      const p = chain.then(run, run);
      chain = p.catch(() => undefined);
      return p;
    },
    close: () => pg.close(),
  };
}

async function openPg(url: string): Promise<Db> {
  const pgModule = await import("pg");
  const { Pool } = pgModule.default ?? (pgModule as any);
  const pool = new Pool({ connectionString: url, max: 10 });
  const wrap = (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }): Queryable => ({
    async query(text, params) {
      const r = await client.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(sql) {
      await client.query(sql);
    },
  });
  return {
    kind: "pg",
    query: wrap(pool).query,
    exec: wrap(pool).exec,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback failure; original error is more useful
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
