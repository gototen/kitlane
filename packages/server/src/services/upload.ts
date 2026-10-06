import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import tar from "tar-stream";
import type { Limits } from "../config.js";
import { KitlaneError } from "../errors.js";
import { contentTypeFor, extensionOf } from "../mime.js";
import type { ManifestFile } from "../types.js";


/** Top-level paths reserved for the platform. Hosted assets can never shadow them. */
export const RESERVED_UPLOAD_PREFIXES = ["._kitlane", "_releases", ".auth", ".dev", ".kitlane", ".well-known"];
const REJECTED_SEGMENTS = new Set([".git", ".svn", ".hg"]);
const REJECTED_BASENAME = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc)$/i;
const MAX_PATH_LENGTH = 512;
const MAX_DEPTH = 32;

export function rejectUpload(message: string, details?: unknown): KitlaneError {
  return new KitlaneError("upload_rejected", message, details);
}

/** Validates and normalizes a path inside an uploaded tool. Throws on anything unsafe. */
export function validateUploadPath(raw: string, allowedExtensions: Set<string>): string {
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) throw rejectUpload(`Invalid path length: ${raw.slice(0, 60)}`);
  if (raw.includes("\0") || /[\u0000-\u001f\u007f]/.test(raw)) throw rejectUpload(`Control characters in path: ${raw.slice(0, 60)}`);
  if (raw.includes("\\")) throw rejectUpload(`Backslashes are not allowed in paths: ${raw}`);
  if (raw.startsWith("/")) throw rejectUpload(`Absolute paths are not allowed: ${raw}`);
  const trimmed = raw.replace(/^\.\//, "");
  const segments = trimmed.split("/");
  if (segments.length > MAX_DEPTH) throw rejectUpload(`Path too deep: ${raw}`);
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") throw rejectUpload(`Path traversal or empty segment rejected: ${raw}`);
    if (REJECTED_SEGMENTS.has(seg.toLowerCase())) throw rejectUpload(`Repository history is not deployable: ${raw}`);
  }
  const first = segments[0].toLowerCase();
  for (const reserved of RESERVED_UPLOAD_PREFIXES) {
    if (first === reserved || first.startsWith(reserved + ".") || first.startsWith(reserved + "-")) {
      throw rejectUpload(`"${segments[0]}" is a reserved platform path`);
    }
  }
  const base = segments[segments.length - 1];
  if (REJECTED_BASENAME.test(base)) throw rejectUpload(`Credential or environment files are not deployable: ${raw}`);
  const ext = extensionOf(base);
  if (!ext || !allowedExtensions.has(ext)) {
    throw rejectUpload(`Unsupported file type: ${raw}. Allowed extensions: ${[...allowedExtensions].sort().join(", ")}`);
  }
  return segments.join("/");
}

export interface StagedUpload {
  files: ManifestFile[];
  totalBytes: number;
  entry: string;
}

/**
 * Extracts a tar (optionally gzip-compressed) stream into stagingDir, enforcing size, count,
 * decompression, path, type, and symlink rules. Rejects rather than partially accepting.
 */
export async function extractUploadToStaging(input: Readable, stagingDir: string, limits: Limits, allowedExtensions: Set<string>, opts: { gzip: boolean }): Promise<StagedUpload> {
  const files: ManifestFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;

  // Count decompressed bytes so a tiny compressed bomb cannot expand without bound.
  let decompressed = 0;
  const extract = tar.extract();
  let failure: Error | null = null;
  let destroyed = false;
  const fail = (err: Error) => {
    if (!failure) failure = err;
    if (destroyed) return;
    destroyed = true;
    extract.destroy(err);
  };
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      decompressed += chunk.length;
      if (decompressed > limits.maxUploadBytes + 10 * 1024 * 1024 && !failure) {
        fail(rejectUpload(`Archive expands beyond the ${limits.maxUploadBytes} byte limit`));
      }
      cb(null, chunk);
    },
  });
  // Late errors on torn-down streams must never surface as unhandled events.
  counter.on("error", () => undefined);
  extract.on("error", () => undefined);

  extract.on("entry", (header, stream, next) => {
    // When extraction is aborted the in-flight entry stream is destroyed too; keep that quiet.
    stream.on("error", () => undefined);
    (async () => {
      if (failure) {
        stream.resume();
        return;
      }
      const type = (header.type ?? "file") as string;
      if (type === "pax-global-header" || type === "pax-header" || type === "gnu-long-path" || type === "gnu-long-link-path") {
        stream.resume();
        await new Promise<void>((r) => stream.on("end", () => r()));
        next();
        return;
      }
      if (type === "directory") {
        stream.resume();
        await new Promise<void>((r) => stream.on("end", () => r()));
        next();
        return;
      }
      if (type !== "file") {
        throw rejectUpload(`Only regular files are deployable; "${header.name}" is a ${type}`);
      }
      const relPath = validateUploadPath(header.name, allowedExtensions);
      const key = relPath.toLowerCase();
      if (seen.has(key)) throw rejectUpload(`Duplicate path (case-insensitive): ${relPath}`);
      seen.add(key);
      fileCount += 1;
      if (fileCount > limits.maxFiles) throw rejectUpload(`Too many files (limit ${limits.maxFiles})`);
      const declared = header.size ?? 0;
      if (declared > limits.maxFileBytes) throw rejectUpload(`"${relPath}" exceeds the per-file limit of ${limits.maxFileBytes} bytes`);
      if (totalBytes + declared > limits.maxUploadBytes) throw rejectUpload(`Upload exceeds the total limit of ${limits.maxUploadBytes} bytes`);

      const target = path.join(stagingDir, relPath);
      const rel = path.relative(stagingDir, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw rejectUpload(`Path escapes staging: ${relPath}`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const hash = createHash("sha256");
      let written = 0;
      const hasher = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          written += chunk.length;
          if (written > limits.maxFileBytes) {
            cb(rejectUpload(`"${relPath}" exceeds the per-file limit`));
            return;
          }
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      await pipeline(stream, hasher, fs.createWriteStream(target, { flags: "wx", mode: 0o644 }));
      totalBytes += written;
      if (totalBytes > limits.maxUploadBytes) throw rejectUpload(`Upload exceeds the total limit of ${limits.maxUploadBytes} bytes`);
      files.push({ path: relPath, size: written, sha256: hash.digest("hex"), contentType: contentTypeFor(relPath) });
      next();
    })().catch((err) => fail(err instanceof KitlaneError ? err : rejectUpload(String(err?.message ?? err))));
  });

  const done = new Promise<void>((resolve, reject) => {
    extract.on("finish", () => (failure ? reject(failure) : resolve()));
    extract.on("error", (err) => reject(failure ?? err));
  });

  try {
    const gunzip = opts.gzip ? zlib.createGunzip() : null;
    gunzip?.on("error", () => undefined);
    const run = gunzip
      ? pipeline(input, gunzip, counter, extract as unknown as NodeJS.WritableStream)
      : pipeline(input, counter, extract as unknown as NodeJS.WritableStream);
    await Promise.all([
      run.catch((err: any) => {
        fail(err instanceof KitlaneError ? err : rejectUpload(`Could not read archive: ${err?.message ?? err}`));
      }),
      done,
    ]);
  } catch (err) {
    throw failure ?? err;
  }
  if (failure) throw failure;

  if (!files.some((f) => f.path === "index.html")) {
    throw rejectUpload("The upload must contain index.html at its root (a single HTML file is packaged as index.html automatically by the CLI)");
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, totalBytes, entry: "index.html" };
}

export function manifestHash(files: ManifestFile[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(`${f.path}\0${f.sha256}\n`);
  return h.digest("hex");
}
