import type { Readable } from "node:stream";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Client {
  portal: string;
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  del<T = any>(path: string): Promise<T>;
  upload<T = any>(path: string, stream: Readable, headers?: Record<string, string>): Promise<T>;
  download(path: string): Promise<Response>;
}

async function parseError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const code = json?.error ?? (res.status === 401 ? "unauthenticated" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : "error");
  const message = json?.message ?? (text && text.length < 300 ? text : `Request failed with status ${res.status}`);
  return new ApiError(res.status, code, message, json?.details);
}

export function createClient(portal: string, token: string | null): Client {
  const base = `${portal}/.api/cli`;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "user-agent": "kitlane-cli/0.2.0",
    ...extra,
  });

  async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: headers(body !== undefined ? { "content-type": "application/json" } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(0, "network", `Could not reach ${portal}: ${(err as Error).message}`);
    }
    if (!res.ok) throw await parseError(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    portal,
    get: (p) => send("GET", p),
    post: (p, b) => send("POST", p, b ?? {}),
    patch: (p, b) => send("PATCH", p, b ?? {}),
    del: (p) => send("DELETE", p),
    async upload(path, stream, extra = {}) {
      let res: Response;
      try {
        res = await fetch(base + path, {
          method: "POST",
          headers: headers({ "content-type": "application/gzip", ...extra }),
          body: stream as unknown as ReadableStream,
          // Node's fetch needs this for streaming request bodies.
          duplex: "half",
        } as RequestInit);
      } catch (err) {
        throw new ApiError(0, "network", `Upload to ${portal} failed: ${(err as Error).message}`);
      }
      if (!res.ok) throw await parseError(res);
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as any;
    },
    async download(path) {
      let res: Response;
      try {
        res = await fetch(base + path, { headers: headers({ accept: "application/gzip" }) });
      } catch (err) {
        throw new ApiError(0, "network", `Could not reach ${portal}: ${(err as Error).message}`);
      }
      if (!res.ok) throw await parseError(res);
      return res;
    },
  };
}

/** Turns an error into a one-paragraph, actionable message for the terminal. */
export function describeError(err: unknown, portal: string | null): string {
  if (err instanceof ApiError) {
    const where = portal ?? "the portal";
    switch (err.status) {
      case 0:
        return err.message;
      case 401:
        return `Not signed in to ${where} (${err.message}). Run \`kitlane login ${portal ?? "<portal-url>"}\`.`;
      case 403:
        return `Not allowed: ${err.message}`;
      case 404:
        return `Not found: ${err.message}`;
      case 409:
        return `Conflict: ${err.message}`;
      case 413:
        return `Too large: ${err.message}`;
      case 422: {
        const details = err.details !== undefined ? `\n${typeof err.details === "string" ? err.details : JSON.stringify(err.details, null, 2)}` : "";
        return `Upload rejected: ${err.message}${details}`;
      }
      case 423:
        return `Frozen: ${err.message}`;
      default:
        return `${err.message} (HTTP ${err.status}, ${err.code})`;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
