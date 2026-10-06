import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractUploadToStaging, validateUploadPath } from "./upload.js";
import type { Limits } from "../config.js";

const allowed = new Set(["html", "js", "css", "png", "json", "svg"]);
const limits: Limits = { maxUploadBytes: 50_000, maxFiles: 5, maxFileBytes: 20_000, maxDocBytes: 1, maxBulkDocs: 1, maxDocsPerCollection: 1, personalQuotaBytes: 1, sharedQuotaBytes: 1, requestsPerMinute: 1, listLimitMax: 1 };

async function tarOf(entries: { name: string; content?: string | Buffer; type?: any; linkname?: string; size?: number }[], gzip = true): Promise<Readable> {
  const pack = tar.pack();
  for (const e of entries) {
    const buf = e.content === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content);
    if (e.type && e.type !== "file") pack.entry({ name: e.name, type: e.type, linkname: e.linkname, size: 0 });
    else pack.entry({ name: e.name, size: e.size ?? buf.length }, buf);
  }
  pack.finalize();
  return gzip ? pack.pipe(zlib.createGzip()) : pack;
}

describe("validateUploadPath", () => {
  it("accepts normal relative paths", () => {
    expect(validateUploadPath("index.html", allowed)).toBe("index.html");
    expect(validateUploadPath("./assets/app.js", allowed)).toBe("assets/app.js");
  });
  it("rejects traversal, absolute, reserved, credential, and unsupported paths", () => {
    const bad = ["../x.html", "a/../../x.html", "/etc/passwd.html", "._kitlane/me.js", "_releases/x/index.html", ".auth/callback.html", ".git/config.json", ".env", "secrets/.env.local", "key.pem", "app.exe", "no-extension", "a\\b.html", "x\u0000.html"];
    for (const p of bad) expect(() => validateUploadPath(p, allowed), p).toThrow();
  });
});

describe("extractUploadToStaging", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-upload-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("extracts a valid archive and hashes files", async () => {
    const res = await extractUploadToStaging(await tarOf([{ name: "index.html", content: "<h1>hi</h1>" }, { name: "assets/a.js", content: "1" }]), dir, limits, allowed, { gzip: true });
    expect(res.files.map((f) => f.path)).toEqual(["assets/a.js", "index.html"]);
    expect(res.files[1].sha256).toHaveLength(64);
    expect(fs.existsSync(path.join(dir, "assets/a.js"))).toBe(true);
  });
  it("requires index.html at the root", async () => {
    await expect(extractUploadToStaging(await tarOf([{ name: "app/index.html", content: "x" }]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/index\.html/);
  });
  it("rejects symlinks", async () => {
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }, { name: "evil.js", type: "symlink", linkname: "/etc/passwd" }]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/regular files/);
  });
  it("rejects path traversal inside the archive", async () => {
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }, { name: "../escape.js", content: "x" }]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/traversal/);
    expect(fs.existsSync(path.join(path.dirname(dir), "escape.js"))).toBe(false);
  });
  it("rejects reserved platform paths", async () => {
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }, { name: "._kitlane/sdk.js", content: "x" }]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/reserved/);
  });
  it("rejects too many files", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `f${i}.js`, content: "x" }));
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }, ...many]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/Too many files/);
  });
  it("rejects a file over the per-file limit and a total over the upload limit", async () => {
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: Buffer.alloc(25_000, 65) }]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/per-file limit/);
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.js`, content: Buffer.alloc(15_000, 66) }));
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }, ...files]), dir, limits, allowed, { gzip: true })).rejects.toThrow(/total limit/);
  });
  it("rejects an archive that decompresses far beyond the limit (bomb)", async () => {
    // 10 MB of zeros compresses to ~10 KB.
    const big = Buffer.alloc(10 * 1024 * 1024, 0);
    await expect(extractUploadToStaging(await tarOf([{ name: "index.html", content: big }]), dir, limits, allowed, { gzip: true })).rejects.toThrow();
  });
  it("accepts an uncompressed tar when told so", async () => {
    const res = await extractUploadToStaging(await tarOf([{ name: "index.html", content: "x" }], false), dir, limits, allowed, { gzip: false });
    expect(res.files).toHaveLength(1);
  });
});
