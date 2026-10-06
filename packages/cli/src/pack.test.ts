import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTarGz, globToRegExp, isExcluded, listFiles, packTarget, validateExtractPath } from "./pack.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitlane-cli-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content = "x") {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("default exclusions", () => {
  it("skips repository history, environment files, credentials, and node_modules", () => {
    for (const p of [".git/config", "a/.git/HEAD", "node_modules/x/index.js", "lib/node_modules/y.js", ".env", ".env.local", "config/.env.production", ".DS_Store", "certs/server.pem", "id_rsa", "keys/id_rsa.pub", ".npmrc", "x/.netrc", "secret.key", ".kitlaneignore"]) {
      expect(isExcluded(p), p).toBe(true);
    }
    for (const p of ["index.html", "assets/app.js", "environment.js", "keynote.pdf", "gitlog.txt"]) {
      expect(isExcluded(p), p).toBe(false);
    }
  });

  it("supports .kitlaneignore globs", () => {
    const re = (p: string) => globToRegExp(p)!;
    expect(re("*.map").test("app.js.map")).toBe(true);
    expect(re("*.map").test("dist/app.js.map")).toBe(true);
    expect(re("drafts/").test("drafts/a.html")).toBe(true);
    expect(re("drafts/").test("drafts")).toBe(true);
    expect(re("drafts/").test("notdrafts/a.html")).toBe(false);
    expect(re("/README.md").test("README.md")).toBe(true);
    expect(re("/README.md").test("docs/README.md")).toBe(false);
    expect(re("docs/**/*.md").test("docs/a/b/c.md")).toBe(true);
    expect(re("docs/**/*.md").test("docs/c.md")).toBe(true);
    expect(re("**/tmp").test("a/b/tmp/x")).toBe(true);
    expect(globToRegExp("# comment")).toBeNull();
    expect(globToRegExp("   ")).toBeNull();
  });

  it("lists files sorted, honours .kitlaneignore, and skips symlinks", async () => {
    write("index.html", "<h1>hi</h1>");
    write("assets/app.js", "1");
    write("assets/app.js.map", "{}");
    write(".env", "SECRET=1");
    write("node_modules/dep/index.js", "x");
    write(".kitlaneignore", "*.map\n# drafts\n drafts/\n");
    write("drafts/wip.html", "x");
    fs.symlinkSync("/etc/hosts", path.join(dir, "hosts.txt"));
    const { loadIgnorePatterns } = await import("./pack.js");
    const listing = await listFiles(dir, loadIgnorePatterns(dir));
    expect(listing.files.map((f) => f.path)).toEqual(["assets/app.js", "index.html"]);
    expect(listing.skippedSymlinks).toEqual(["hosts.txt"]);
  });

  it("packs a folder into gzip tar and refuses folders without index.html", async () => {
    write("app/index.html", "<h1>hi</h1>");
    write("app/a.js", "1");
    const packed = await packTarget(path.join(dir, "app"));
    expect(packed.files.map((f) => f.path)).toEqual(["a.js", "index.html"]);
    const out = path.join(dir, "out");
    const written = await extractTarGz(packed.stream, out);
    expect(written).toEqual(["a.js", "index.html"]);
    expect(fs.readFileSync(path.join(out, "index.html"), "utf8")).toBe("<h1>hi</h1>");
    write("bare/readme.md", "x");
    await expect(packTarget(path.join(dir, "bare"))).rejects.toThrow(/index\.html/);
  });

  it("packs a single HTML file as index.html", async () => {
    write("tool.html", "<h1>single</h1>");
    const packed = await packTarget(path.join(dir, "tool.html"));
    expect(packed.singleFile).toBe(true);
    expect(packed.files).toEqual([{ path: "index.html", size: 15 }]);
    const out = path.join(dir, "out2");
    expect(await extractTarGz(packed.stream, out)).toEqual(["index.html"]);
    write("notes.txt", "x");
    await expect(packTarget(path.join(dir, "notes.txt"))).rejects.toThrow(/HTML file/);
  });
});

describe("pull path validation", () => {
  it("accepts normal relative paths", () => {
    expect(validateExtractPath("index.html")).toBe("index.html");
    expect(validateExtractPath("./assets/app.js")).toBe("assets/app.js");
  });
  it("rejects absolute paths, traversal, backslashes, and control characters", () => {
    for (const p of ["/etc/passwd", "../x.html", "a/../../x.html", "a//b.html", "a\\b.html", "x\u0000.html", ""]) {
      expect(() => validateExtractPath(p), JSON.stringify(p)).toThrow();
    }
  });
  it("refuses archives with symlinks or escaping entries during extraction", async () => {
    const tar = (await import("tar-stream")).default;
    const zlib = await import("node:zlib");
    const make = (entries: { name: string; type?: any; linkname?: string; content?: string }[]) => {
      const pack = tar.pack();
      for (const e of entries) {
        if (e.type) pack.entry({ name: e.name, type: e.type, linkname: e.linkname, size: 0 });
        else pack.entry({ name: e.name, size: Buffer.byteLength(e.content ?? "x") }, e.content ?? "x");
      }
      pack.finalize();
      return pack.pipe(zlib.createGzip()) as unknown as Readable;
    };
    const out = path.join(dir, "pulled");
    await expect(extractTarGz(make([{ name: "index.html" }, { name: "evil", type: "symlink", linkname: "/etc/passwd" }]), out)).rejects.toThrow(/symlink/);
    await expect(extractTarGz(make([{ name: "index.html" }, { name: "../escape.js" }]), out)).rejects.toThrow(/traversal/);
    expect(fs.existsSync(path.join(dir, "escape.js"))).toBe(false);
  });
});
