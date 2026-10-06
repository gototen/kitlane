import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import tar from "tar-stream";
import { Readable } from "node:stream";
import { createApp } from "../app.js";
import { loadConfig, portalOrigin, toolOrigin, type Config } from "../config.js";
import { createServices, type Services } from "../context.js";
import { openDatabase, type Db } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { LocalArtifactStorage } from "../services/storage.js";
import { upsertUserFromIdentity } from "../services/users.js";
import { createPortalSession, PORTAL_COOKIE, TOOL_COOKIE } from "../auth/sessions.js";
import { createAccessToken } from "../services/tokens.js";
import * as entries from "../services/entries.js";
import * as versions from "../services/versions.js";
import { userActor, type EntryWithNames, type User } from "../types.js";

export const PORTAL = "http://kit.test:3000";

export interface Harness {
  app: ReturnType<typeof createApp>;
  db: Db;
  config: Config;
  services: Services;
  dataDir: string;
  user(name: string, opts?: { team?: string | null; admin?: boolean }): Promise<User>;
  portalCookie(user: User): Promise<string>;
  token(user: User): Promise<string>;
  toolCookie(user: User, toolId: string): Promise<string>;
  req(url: string, init?: RequestInit & { cookie?: string }): Promise<Response>;
  tarball(files: Record<string, string | Buffer>, opts?: { gzip?: boolean }): Promise<Buffer>;
  publish(user: User, name: string, files: Record<string, string | Buffer>, extra?: Partial<entries.CreateEntryInput>): Promise<EntryWithNames>;
  toolOrigin(id: string): string;
  close(): Promise<void>;
}

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitlane-test-"));
  const config = loadConfig({
    KITLANE_DATA_DIR: dataDir,
    KITLANE_DATABASE_URL: "pglite://memory",
    KITLANE_PORTAL_URL: PORTAL,
    KITLANE_TOOLS_DOMAIN: "sites.kit.test:3000",
    KITLANE_AUTH_MODE: "dev",
    KITLANE_SECRET: "test-secret-test-secret-test-secret-1234",
    KITLANE_ADMIN_USERS: "",
    KITLANE_MAX_UPLOAD_BYTES: String(2 * 1024 * 1024),
    KITLANE_MAX_FILES: "50",
    KITLANE_MAX_FILE_BYTES: String(1024 * 1024),
    KITLANE_MAX_DOC_BYTES: "4096",
    KITLANE_MAX_BULK_DOCS: "10",
    KITLANE_PERSONAL_QUOTA_BYTES: "20000",
    KITLANE_SHARED_QUOTA_BYTES: "200000",
    KITLANE_REQUESTS_PER_MINUTE: "100000",
    ...envOverrides,
  });
  const db = await openDatabase(config.databaseUrl);
  await migrate(db);
  const storage = new LocalArtifactStorage(dataDir);
  const services = createServices(config, db, storage);
  const app = createApp(services);

  const h: Harness = {
    app,
    db,
    config,
    services,
    dataDir,
    async user(name, opts = {}) {
      const u = await upsertUserFromIdentity(db, config, { externalId: `dev:${name}`, displayName: name, email: `${name}@example.test`, team: opts.team === undefined ? null : opts.team }, { devUser: true });
      if (opts.admin) {
        await db.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [u.id]);
        return { ...u, is_admin: true };
      }
      return u;
    },
    async portalCookie(user) {
      const sid = await createPortalSession(db, config, user);
      return `${PORTAL_COOKIE(config)}=${sid}`;
    },
    async token(user) {
      const { token } = await createAccessToken(db, userActor(user.id), user, "test");
      return token;
    },
    async toolCookie(user, toolId) {
      const cookie = await h.portalCookie(user);
      const start = await h.req(`${PORTAL}/.auth/start?tool=${toolId}&rd=${encodeURIComponent(`${PORTAL}/x`)}`, { cookie, redirect: "manual" });
      if (start.status !== 302) throw new Error(`auth start failed: ${start.status} ${await start.text()}`);
      const cb = await h.req(start.headers.get("location")!, { redirect: "manual" });
      if (cb.status !== 303) throw new Error(`auth callback failed: ${cb.status} ${await cb.text()}`);
      const setCookie = cb.headers.get("set-cookie") ?? "";
      const m = new RegExp(`${TOOL_COOKIE(config)}=([^;]+)`).exec(setCookie);
      if (!m) throw new Error(`no tool cookie in ${setCookie}`);
      return `${TOOL_COOKIE(config)}=${m[1]}`;
    },
    async req(url, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (init.cookie) headers.set("cookie", init.cookie);
      const { cookie: _c, ...rest } = init;
      return app.request(url, { ...rest, headers });
    },
    async tarball(files, opts = {}) {
      const pack = tar.pack();
      for (const [name, content] of Object.entries(files)) {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
        pack.entry({ name, size: buf.length, mode: 0o644 }, buf);
      }
      pack.finalize();
      const chunks: Buffer[] = [];
      const stream = opts.gzip === false ? pack : pack.pipe(zlib.createGzip());
      for await (const chunk of stream as Readable) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    },
    async publish(user, name, files, extra = {}) {
      const entry = await db.transaction((tx) => entries.createEntry(tx, userActor(user.id), user, { kind: "tool", mode: "hosted", name, title: extra.title ?? name, purpose: extra.purpose ?? "", tags: extra.tags ?? [], ...extra }));
      const body = Readable.from([await h.tarball(files)]);
      await versions.publishUpload(db, storage, config, userActor(user.id), entry, body, { gzip: true });
      return (await entries.getEntry(db, entry.id))!;
    },
    toolOrigin: (id) => toolOrigin(config, id),
    async close() {
      await db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return h;
}

export function jsonInit(method: string, body?: unknown, origin?: string): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", accept: "application/json", ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export { portalOrigin };
