import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import tar from "tar-stream";

/** Files that are never deployable by default: repository history, environment files, credentials. */
export const DEFAULT_EXCLUDES: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)\.DS_Store$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)id_rsa[^/]*$/,
  /(^|\/)\.kitlaneignore$/,
];

/**
 * Converts a gitignore-like pattern into a RegExp matched against a relative POSIX path.
 * Supports `*` (within a segment), `**` (any depth), a trailing `/` (directory), a leading `/`
 * (anchored to the root), and `#` comments. Returns null for blank lines and comments.
 */
export function globToRegExp(pattern: string): RegExp | null {
  const raw = pattern.trim();
  if (!raw || raw.startsWith("#")) return null;
  let p = raw;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  // Unanchored patterns without a slash match at any depth, as in gitignore.
  const prefix = anchored || p.includes("/") ? "^" : "(?:^|/)";
  const suffix = dirOnly ? "(?:/|$)" : "(?:/.*)?$";
  return new RegExp(`${prefix}${re}${suffix}`);
}

export function loadIgnorePatterns(dir: string): RegExp[] {
  try {
    const text = fs.readFileSync(path.join(dir, ".kitlaneignore"), "utf8");
    return text
      .split(/\r?\n/)
      .map(globToRegExp)
      .filter((r): r is RegExp => Boolean(r));
  } catch {
    return [];
  }
}

export function isExcluded(rel: string, extra: RegExp[] = []): boolean {
  return DEFAULT_EXCLUDES.some((re) => re.test(rel)) || extra.some((re) => re.test(rel));
}

export interface FileListing {
  files: { path: string; size: number }[];
  skippedSymlinks: string[];
  totalBytes: number;
}

/** Lists deployable files under dir as sorted relative POSIX paths. Symlinks are skipped. */
export async function listFiles(dir: string, extraIgnore: RegExp[] = []): Promise<FileListing> {
  const files: { path: string; size: number }[] = [];
  const skippedSymlinks: string[] = [];
  const walk = async (d: string, prefix: string) => {
    const entries = await fsp.readdir(d, { withFileTypes: true });
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        skippedSymlinks.push(rel);
        continue;
      }
      if (isExcluded(rel, extraIgnore)) continue;
      if (ent.isDirectory()) await walk(path.join(d, ent.name), rel);
      else if (ent.isFile()) {
        const st = await fsp.stat(path.join(d, ent.name));
        files.push({ path: rel, size: st.size });
      }
    }
  };
  await walk(dir, "");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, skippedSymlinks, totalBytes: files.reduce((n, f) => n + f.size, 0) };
}

export interface Packed {
  stream: Readable;
  files: { path: string; size: number }[];
  totalBytes: number;
  singleFile: boolean;
  skippedSymlinks: string[];
}

/**
 * Packs a single HTML file (as index.html) or a prepared folder into a gzip tar stream.
 * Throws when a folder has no index.html at its root.
 */
export async function packTarget(target: string): Promise<Packed> {
  const abs = path.resolve(target);
  let st: fs.Stats;
  try {
    st = await fsp.stat(abs);
  } catch {
    throw new Error(`Path not found: ${target}`);
  }
  const pack = tar.pack();
  let files: { path: string; size: number }[];
  let skippedSymlinks: string[] = [];
  let singleFile = false;
  if (st.isFile()) {
    if (!/\.html?$/i.test(abs)) throw new Error(`A single file must be an HTML file; got ${path.basename(abs)}. Publish a folder with index.html instead.`);
    singleFile = true;
    files = [{ path: "index.html", size: st.size }];
    const buf = await fsp.readFile(abs);
    pack.entry({ name: "index.html", size: buf.length, mode: 0o644 }, buf);
    pack.finalize();
  } else if (st.isDirectory()) {
    const listing = await listFiles(abs, loadIgnorePatterns(abs));
    files = listing.files;
    skippedSymlinks = listing.skippedSymlinks;
    if (!files.some((f) => f.path === "index.html")) {
      throw new Error(`${target} has no index.html at its root. Hosted tools need an entry page named index.html.`);
    }
    (async () => {
      try {
        for (const f of files) {
          const buf = await fsp.readFile(path.join(abs, f.path));
          await new Promise<void>((res, rej) => pack.entry({ name: f.path, size: buf.length, mode: 0o644 }, buf, (e) => (e ? rej(e) : res())));
        }
        pack.finalize();
      } catch (err) {
        pack.destroy(err as Error);
      }
    })();
  } else {
    throw new Error(`${target} is neither a file nor a directory`);
  }
  const gzip = zlib.createGzip();
  return { stream: pack.pipe(gzip), files, totalBytes: files.reduce((n, f) => n + f.size, 0), singleFile, skippedSymlinks };
}

/**
 * Validates a path inside a downloaded archive before extraction. Rejects absolute paths,
 * traversal, empty segments, backslashes, and control characters. Returns the normalized path.
 */
export function validateExtractPath(name: string): string {
  if (!name || name.length > 1024) throw new Error(`Invalid path length in archive: ${name.slice(0, 60)}`);
  if (/[\u0000-\u001f\u007f]/.test(name) || name.includes("\\")) throw new Error(`Unsafe characters in archive path: ${name.slice(0, 60)}`);
  if (name.startsWith("/")) throw new Error(`Absolute path in archive rejected: ${name}`);
  const segments = name.replace(/^\.\//, "").split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") throw new Error(`Path traversal or empty segment rejected: ${name}`);
  }
  return segments.join("/");
}

/** Extracts a gzip tar into dir. Only regular files are written; everything else is rejected. */
export async function extractTarGz(input: Readable, dir: string): Promise<string[]> {
  const written: string[] = [];
  const extract = tar.extract();
  let failure: Error | null = null;
  const fail = (err: Error) => {
    if (!failure) failure = err;
    extract.destroy(err);
  };
  extract.on("error", () => undefined);
  extract.on("entry", (header, stream, next) => {
    stream.on("error", () => undefined);
    (async () => {
      if (failure) {
        stream.resume();
        return;
      }
      const type = (header.type ?? "file") as string;
      if (type === "directory" || type === "pax-global-header" || type === "pax-header") {
        stream.resume();
        await new Promise<void>((r) => stream.on("end", () => r()));
        next();
        return;
      }
      if (type !== "file") throw new Error(`Archive entry "${header.name}" is a ${type}; only regular files are extracted`);
      const rel = validateExtractPath(header.name);
      const target = path.join(dir, rel);
      const relCheck = path.relative(dir, target);
      if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) throw new Error(`Path escapes target directory: ${header.name}`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await pipeline(stream, fs.createWriteStream(target, { mode: 0o644 }));
      written.push(rel);
      next();
    })().catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
  const done = new Promise<void>((resolve, reject) => {
    extract.on("finish", () => (failure ? reject(failure) : resolve()));
    extract.on("error", (err) => reject(failure ?? err));
  });
  const gunzip = zlib.createGunzip();
  gunzip.on("error", () => undefined);
  await Promise.all([
    pipeline(input, gunzip, extract as unknown as NodeJS.WritableStream).catch((err: any) => fail(err instanceof Error ? err : new Error(String(err)))),
    done,
  ]);
  if (failure) throw failure;
  return written.sort();
}

export async function dirIsEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length === 0;
  } catch (err: any) {
    if (err?.code === "ENOENT") return true;
    throw err;
  }
}
