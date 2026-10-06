import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import tar from "tar-stream";

const DEFAULT_EXCLUDES = [/^\.git(\/|$)/, /^node_modules(\/|$)/, /^kitlane\.json$/, /^\.kitlaneignore$/, /(^|\/)\.env(\..*)?$/, /(^|\/)\.DS_Store$/, /\.(pem|key|p12|pfx)$/i, /(^|\/)\.npmrc$/];

export async function listDeployableFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, prefix: string) => {
    for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (DEFAULT_EXCLUDES.some((re) => re.test(rel))) continue;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) await walk(path.join(d, ent.name), rel);
      else if (ent.isFile()) out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

/** Packs a prepared folder (or a single HTML file as index.html) into a gzip tar stream. */
export async function packForUpload(target: string): Promise<Readable> {
  const pack = tar.pack();
  const st = await fsp.stat(target);
  (async () => {
    try {
      if (st.isFile()) {
        const buf = await fsp.readFile(target);
        await new Promise<void>((res, rej) => pack.entry({ name: "index.html", size: buf.length, mode: 0o644 }, buf, (e) => (e ? rej(e) : res())));
      } else {
        for (const rel of await listDeployableFiles(target)) {
          const buf = await fsp.readFile(path.join(target, rel));
          await new Promise<void>((res, rej) => pack.entry({ name: rel, size: buf.length, mode: 0o644 }, buf, (e) => (e ? rej(e) : res())));
        }
      }
      pack.finalize();
    } catch (err) {
      pack.destroy(err as Error);
    }
  })();
  return pack.pipe(zlib.createGzip());
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
