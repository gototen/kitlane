/**
 * Kitlane browser SDK.
 *
 * Served on every hosted tool's origin at /._kitlane/sdk.js (global `kitlane`) and
 * /._kitlane/sdk.mjs (ES module). Requests go to reserved routes on the tool's own origin; the
 * trusted gateway maps the host to the registered tool and forwards verified identity. Nothing
 * here carries credentials; the browser session cookie for this origin does.
 */

export type FilterOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "contains";
export type Filter = [field: string, op: FilterOp, value: unknown];

export interface Doc<T = any> {
  id: string;
  data: T;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
}

export interface ListOptions {
  where?: Filter[];
  orderBy?: string;
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
}

export interface ListResult<T = any> {
  items: Doc<T>[];
  nextCursor: string | null;
  revision?: number;
}

export type BulkOp<T = any> = { op: "set"; id: string; data: T; ifRevision?: number } | { op: "delete"; id: string; ifRevision?: number };

export interface Identity {
  id: string;
  displayName: string;
  team?: string;
  email?: string;
}

export interface ToolInfo {
  id: string;
  names: string[];
  title: string;
  purpose: string;
  lifecycle: string;
  version: { id: string; number: number } | null;
  bindings: { name: string; collectionId: string; canWrite: boolean; frozen: boolean; revision: number }[];
  capabilities: { ai: boolean; personalStorage: boolean; sharedCollections: boolean };
  portalUrl: string;
  shortcut: string;
}

export interface SharedMeta {
  collectionId: string;
  name: string;
  description: string;
  revision: number;
  frozen: boolean;
  canWrite: boolean;
  writeBlockedReason: string | null;
  ownerId: string;
  originToolId: string;
}

export class KitlaneError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: any;
  constructor(code: string, message: string, status: number, details?: any) {
    super(message);
    this.name = "KitlaneError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
  /** For `conflict` errors: the document as it currently exists on the server (or null). */
  get current(): Doc | null | undefined {
    return this.details?.current;
  }
}

const BASE = "/._kitlane";

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { Accept: "application/json", ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    throw new KitlaneError("network", `Kitlane request failed: ${(err as Error).message}`, 0);
  }
  if (res.status === 304) return undefined as T;
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = json?.error ?? (res.status === 401 ? "unauthenticated" : res.status === 403 ? "forbidden" : "error");
    throw new KitlaneError(code, json?.message ?? `Request failed with status ${res.status}`, res.status, json?.details);
  }
  return json as T;
}

function listQuery(opts: ListOptions = {}): string {
  const p = new URLSearchParams();
  for (const f of opts.where ?? []) p.append("where", JSON.stringify(f));
  if (opts.orderBy) p.set("orderBy", opts.orderBy);
  if (opts.order) p.set("order", opts.order);
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.cursor) p.set("cursor", opts.cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export class Collection<T = any> {
  constructor(protected readonly base: string) {}

  get(id: string): Promise<Doc<T> | null> {
    return request<Doc<T>>("GET", `${this.base}/${encodeURIComponent(id)}`).catch((err) => {
      if (err instanceof KitlaneError && err.code === "not_found") return null;
      throw err;
    });
  }

  /** Saves a document. Pass `ifRevision` to detect conflicting edits (0 = must not exist yet). */
  set(id: string, data: T, opts: { ifRevision?: number } = {}): Promise<Doc<T>> {
    return request<Doc<T>>("PUT", `${this.base}/${encodeURIComponent(id)}`, { data, ifRevision: opts.ifRevision });
  }

  async delete(id: string, opts: { ifRevision?: number } = {}): Promise<boolean> {
    const r = await request<{ deleted: boolean }>("DELETE", `${this.base}/${encodeURIComponent(id)}`, opts.ifRevision !== undefined ? { ifRevision: opts.ifRevision } : undefined);
    return r.deleted;
  }

  list(opts: ListOptions = {}): Promise<ListResult<T>> {
    return request<ListResult<T>>("GET", `${this.base}${listQuery(opts)}`);
  }

  /** Iterates every document, following cursors. */
  async all(opts: Omit<ListOptions, "cursor"> = {}): Promise<Doc<T>[]> {
    const out: Doc<T>[] = [];
    let cursor: string | null = null;
    do {
      const page: ListResult<T> = await this.list({ ...opts, cursor, limit: opts.limit ?? 200 });
      out.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  /** Atomic bounded bulk write. `replaceAll` replaces the entire collection contents. */
  bulk(ops: BulkOp<T>[], opts: { replaceAll?: boolean } = {}): Promise<{ applied: number; collectionRevision?: number }> {
    return request("POST", `${this.base}/_bulk`, { ops, replaceAll: Boolean(opts.replaceAll) });
  }
}

export class SharedCollection<T = any> extends Collection<T> {
  meta(): Promise<SharedMeta> {
    return request<SharedMeta>("GET", `${this.base}/_meta`);
  }

  /** Lists with an ETag; returns null when the collection revision has not changed. */
  async listIfChanged(revision: number | null | undefined, opts: ListOptions = {}): Promise<ListResult<T> | null> {
    const r = await request<ListResult<T> | undefined>("GET", `${this.base}${listQuery(opts)}`, undefined, revision != null ? { "If-None-Match": `W/"${revision}"` } : {});
    return r ?? null;
  }
}

function validName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new KitlaneError("bad_request", `Invalid collection name "${name}"`, 400);
  return name;
}

let meCache: Promise<Identity> | null = null;
let toolCache: Promise<ToolInfo> | null = null;

export const kitlane = {
  /** Minimal approved identity: an opaque user ID and display name (team/email per installation policy). */
  me(): Promise<Identity> {
    return (meCache ??= request<Identity>("GET", "/me").catch((err) => {
      meCache = null;
      throw err;
    }));
  },

  /** Information about this tool: names, active version, shared bindings and whether you can write to them. */
  tool(): Promise<ToolInfo> {
    return (toolCache ??= request<ToolInfo>("GET", "/tool").catch((err) => {
      toolCache = null;
      throw err;
    }));
  },

  /** Personal storage: scoped to this tool and the signed-in user, persistent across sessions and devices. */
  user: {
    collection<T = any>(name: string): Collection<T> {
      return new Collection<T>(`/data/user/${validName(name)}`);
    },
  },

  /** Shared collections (readable by everyone in the installation) through this tool's named bindings. */
  shared: {
    collection<T = any>(binding: string): SharedCollection<T> {
      return new SharedCollection<T>(`/data/shared/${validName(binding)}`);
    },
  },

  /** Optional AI gateway. Not enabled in this release; calls report the missing capability. */
  ai: {
    async chat(_input: unknown): Promise<never> {
      throw new KitlaneError("capability_unavailable", "AI is not enabled on this Kitlane installation", 501);
    },
  },

  /** Shell integration (the Explore tools rail is in the parent frame). */
  shell: {
    isFramed(): boolean {
      try {
        return window.parent !== window;
      } catch {
        return true;
      }
    },
    /** Asks the shell to update the browser tab title. The shell validates the sender. */
    setTitle(title: string): void {
      if (!kitlane.shell.isFramed()) {
        document.title = title;
        return;
      }
      try {
        window.parent.postMessage({ type: "kitlane:title", title: String(title).slice(0, 200) }, "*");
      } catch {
        // ignore
      }
    },
  },

  /** Fires when the page regains focus or becomes visible; handy for refreshing shared data. */
  onRefresh(handler: () => void, opts: { intervalMs?: number } = {}): () => void {
    const onVis = () => {
      if (document.visibilityState === "visible") handler();
    };
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", onVis);
    const timer = opts.intervalMs ? window.setInterval(handler, Math.max(15_000, opts.intervalMs)) : null;
    return () => {
      window.removeEventListener("focus", handler);
      document.removeEventListener("visibilitychange", onVis);
      if (timer) window.clearInterval(timer);
    };
  },

  KitlaneError,
};

export type Kitlane = typeof kitlane;
export default kitlane;

declare global {
  interface Window {
    kitlane: Kitlane;
  }
}
