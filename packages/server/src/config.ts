import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AuthMode = "dev" | "gateway";

export interface Limits {
  maxUploadBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxDocBytes: number;
  maxBulkDocs: number;
  maxDocsPerCollection: number;
  personalQuotaBytes: number;
  sharedQuotaBytes: number;
  requestsPerMinute: number;
  listLimitMax: number;
}

export interface HostedPolicy {
  scriptSrc: string[];
  styleSrc: string[];
  connectSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  frameSrc: string[];
  permissionsPolicy: string;
  allowedExtensions: Set<string>;
}

export interface Config {
  installationId: string;
  port: number;
  host: string;
  databaseUrl: string;
  dataDir: string;
  portalUrl: URL;
  toolsDomain: string;
  shortcut: string;
  authMode: AuthMode;
  ingressSecret: string | null;
  secret: string;
  adminUsers: Set<string>;
  identityHeaders: { user: string; email: string; name: string; team: string };
  exposeEmail: boolean;
  toolCookieSameSite: "Lax" | "None" | "Strict";
  secureCookies: boolean;
  sessionTtlSeconds: number;
  discoveryRetentionDays: number;
  limits: Limits;
  hosted: HostedPolicy;
  publicDir: string;
  reportingContact: string | null;
}

const DEFAULT_EXTENSIONS = [
  "html", "htm", "js", "mjs", "cjs", "css", "map", "json", "webmanifest", "txt", "md", "csv", "xml",
  "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "ogg", "wav", "mp4", "webm",
  "pdf", "wasm",
];

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function envList(name: string): string[] {
  const v = env(name);
  if (!v) return [];
  return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

function loadOrCreateSecret(dataDir: string): string {
  const file = path.join(dataDir, "secret.key");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // fall through
  }
  const generated = randomBytes(32).toString("base64url");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;

  const dataDir = path.resolve(env("KITLANE_DATA_DIR", "./data")!);
  const portalUrl = new URL(env("KITLANE_PORTAL_URL", "http://kit.localhost:3000")!);
  const authMode = env("KITLANE_AUTH_MODE", "dev") as AuthMode;
  if (authMode !== "dev" && authMode !== "gateway") throw new Error("KITLANE_AUTH_MODE must be dev or gateway");

  const secureCookies = portalUrl.protocol === "https:";
  let secret = env("KITLANE_SECRET");
  if (!secret) {
    if (authMode === "gateway") throw new Error("KITLANE_SECRET is required in gateway mode");
    secret = loadOrCreateSecret(dataDir);
  }
  const ingressSecret = env("KITLANE_INGRESS_SECRET") ?? null;
  if (authMode === "gateway" && !ingressSecret) {
    throw new Error("KITLANE_INGRESS_SECRET is required in gateway mode so identity headers are only accepted from the trusted ingress");
  }

  const toolsDomain = env("KITLANE_TOOLS_DOMAIN", `sites.${portalUrl.host}`)!;
  const sameSite = (env("KITLANE_TOOL_COOKIE_SAMESITE", "Lax") as Config["toolCookieSameSite"]);
  if (!["Lax", "None", "Strict"].includes(sameSite)) throw new Error("KITLANE_TOOL_COOKIE_SAMESITE must be Lax, None, or Strict");

  const allowed = new Set((envList("KITLANE_ALLOWED_EXTENSIONS").length ? envList("KITLANE_ALLOWED_EXTENSIONS") : DEFAULT_EXTENSIONS).map((e) => e.toLowerCase().replace(/^\./, "")));

  return {
    installationId: env("KITLANE_INSTALLATION_ID", "default")!,
    port: envInt("KITLANE_PORT", Number(portalUrl.port) || 3000),
    host: env("KITLANE_HOST", "0.0.0.0")!,
    databaseUrl: env("KITLANE_DATABASE_URL", `pglite://${path.join(dataDir, "db")}`)!,
    dataDir,
    portalUrl,
    toolsDomain,
    shortcut: env("KITLANE_SHORTCUT", "kit")!,
    authMode,
    ingressSecret,
    secret,
    adminUsers: new Set(envList("KITLANE_ADMIN_USERS").map((s) => s.toLowerCase())),
    identityHeaders: {
      user: env("KITLANE_IDENTITY_HEADER_USER", "x-forwarded-user")!.toLowerCase(),
      email: env("KITLANE_IDENTITY_HEADER_EMAIL", "x-forwarded-email")!.toLowerCase(),
      name: env("KITLANE_IDENTITY_HEADER_NAME", "x-forwarded-preferred-username")!.toLowerCase(),
      team: env("KITLANE_IDENTITY_HEADER_TEAM", "x-forwarded-groups")!.toLowerCase(),
    },
    exposeEmail: env("KITLANE_EXPOSE_EMAIL", "false") === "true",
    toolCookieSameSite: sameSite,
    secureCookies,
    sessionTtlSeconds: envInt("KITLANE_SESSION_TTL_SECONDS", 12 * 3600),
    discoveryRetentionDays: envInt("KITLANE_DISCOVERY_RETENTION_DAYS", 90),
    limits: {
      maxUploadBytes: envInt("KITLANE_MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
      maxFiles: envInt("KITLANE_MAX_FILES", 2000),
      maxFileBytes: envInt("KITLANE_MAX_FILE_BYTES", 20 * 1024 * 1024),
      maxDocBytes: envInt("KITLANE_MAX_DOC_BYTES", 256 * 1024),
      maxBulkDocs: envInt("KITLANE_MAX_BULK_DOCS", 500),
      maxDocsPerCollection: envInt("KITLANE_MAX_DOCS_PER_COLLECTION", 20000),
      personalQuotaBytes: envInt("KITLANE_PERSONAL_QUOTA_BYTES", 20 * 1024 * 1024),
      sharedQuotaBytes: envInt("KITLANE_SHARED_QUOTA_BYTES", 200 * 1024 * 1024),
      requestsPerMinute: envInt("KITLANE_REQUESTS_PER_MINUTE", 600),
      listLimitMax: envInt("KITLANE_LIST_LIMIT_MAX", 200),
    },
    hosted: {
      scriptSrc: envList("KITLANE_HOSTED_SCRIPT_SRC"),
      styleSrc: envList("KITLANE_HOSTED_STYLE_SRC"),
      connectSrc: envList("KITLANE_HOSTED_CONNECT_SRC"),
      imgSrc: envList("KITLANE_HOSTED_IMG_SRC"),
      fontSrc: envList("KITLANE_HOSTED_FONT_SRC"),
      frameSrc: envList("KITLANE_HOSTED_FRAME_SRC"),
      permissionsPolicy: env("KITLANE_HOSTED_PERMISSIONS_POLICY", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()")!,
      allowedExtensions: allowed,
    },
    publicDir: env("KITLANE_PUBLIC_DIR", path.resolve(new URL("../public", import.meta.url).pathname))!,
    reportingContact: env("KITLANE_REPORTING_CONTACT") ?? null,
  };
}

export function portalOrigin(config: Config): string {
  return config.portalUrl.origin;
}

export function toolHost(config: Config, entryId: string): string {
  return `app-${entryId}.${config.toolsDomain}`;
}

export function toolOrigin(config: Config, entryId: string): string {
  return `${config.portalUrl.protocol}//${toolHost(config, entryId)}`;
}

/** Returns the entry ID encoded in a tool host, or null when the host is not a tool host. */
export function entryIdFromHost(config: Config, host: string): string | null {
  const suffix = `.${config.toolsDomain}`.toLowerCase();
  const h = host.toLowerCase();
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  const m = /^app-([a-z0-9]{6,32})$/.exec(label);
  return m ? m[1] : null;
}

export function isPortalHost(config: Config, host: string): boolean {
  return host.toLowerCase() === config.portalUrl.host.toLowerCase();
}
