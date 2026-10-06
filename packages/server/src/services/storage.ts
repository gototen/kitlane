import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * Artifact storage boundary. V0.2 implements a local persistent volume. An object-storage
 * implementation can replace this without touching publishing or serving logic.
 */
export interface ArtifactStorage {
  createStaging(): Promise<string>;
  discardStaging(dir: string): Promise<void>;
  commitRelease(entryId: string, versionId: string, stagingDir: string): Promise<void>;
  copyRelease(fromEntryId: string, fromVersionId: string, toEntryId: string, toVersionId: string): Promise<void>;
  removeRelease(entryId: string, versionId: string): Promise<void>;
  releaseExists(entryId: string, versionId: string): Promise<boolean>;
  openFile(entryId: string, versionId: string, relPath: string): Promise<{ stream: Readable; size: number } | null>;
  readFile(entryId: string, versionId: string, relPath: string): Promise<Buffer | null>;
  listFiles(entryId: string, versionId: string): Promise<string[]>;
}

export class LocalArtifactStorage implements ArtifactStorage {
  constructor(private readonly root: string) {}

  private releasesDir(entryId: string, versionId: string): string {
    if (!/^[a-z0-9]+$/.test(entryId) || !/^[a-z0-9]+$/.test(versionId)) throw new Error("invalid identifiers");
    return path.join(this.root, "releases", entryId, versionId);
  }

  async createStaging(): Promise<string> {
    const dir = path.join(this.root, "staging", randomUUID());
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async discardStaging(dir: string): Promise<void> {
    if (!dir.startsWith(path.join(this.root, "staging"))) return;
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async commitRelease(entryId: string, versionId: string, stagingDir: string): Promise<void> {
    const target = this.releasesDir(entryId, versionId);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(stagingDir, target);
  }

  async copyRelease(fromEntryId: string, fromVersionId: string, toEntryId: string, toVersionId: string): Promise<void> {
    const from = this.releasesDir(fromEntryId, fromVersionId);
    const to = this.releasesDir(toEntryId, toVersionId);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.cp(from, to, { recursive: true, dereference: false, errorOnExist: true, force: false });
  }

  async removeRelease(entryId: string, versionId: string): Promise<void> {
    await fsp.rm(this.releasesDir(entryId, versionId), { recursive: true, force: true });
  }

  async releaseExists(entryId: string, versionId: string): Promise<boolean> {
    try {
      const st = await fsp.stat(this.releasesDir(entryId, versionId));
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  private resolveInside(entryId: string, versionId: string, relPath: string): string | null {
    const base = this.releasesDir(entryId, versionId);
    const normalized = path.posix.normalize("/" + relPath.replace(/\\/g, "/"));
    if (normalized.includes("\0")) return null;
    const full = path.join(base, normalized);
    const rel = path.relative(base, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return full;
  }

  async openFile(entryId: string, versionId: string, relPath: string): Promise<{ stream: Readable; size: number } | null> {
    const full = this.resolveInside(entryId, versionId, relPath);
    if (!full) return null;
    try {
      const st = await fsp.lstat(full);
      if (!st.isFile()) return null;
      return { stream: fs.createReadStream(full), size: st.size };
    } catch {
      return null;
    }
  }

  async readFile(entryId: string, versionId: string, relPath: string): Promise<Buffer | null> {
    const full = this.resolveInside(entryId, versionId, relPath);
    if (!full) return null;
    try {
      const st = await fsp.lstat(full);
      if (!st.isFile()) return null;
      return await fsp.readFile(full);
    } catch {
      return null;
    }
  }

  async listFiles(entryId: string, versionId: string): Promise<string[]> {
    const base = this.releasesDir(entryId, versionId);
    const out: string[] = [];
    const walk = async (dir: string, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(path.join(dir, ent.name), rel);
        else if (ent.isFile()) out.push(rel);
      }
    };
    await walk(base, "");
    return out.sort();
  }
}
