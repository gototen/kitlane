import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PortalConfig {
  token: string;
  user?: string;
}

export interface CliConfig {
  default?: string;
  portals: Record<string, PortalConfig>;
}

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim() ? process.env.XDG_CONFIG_HOME : path.join(os.homedir(), ".config");
  return path.join(base, "kitlane", "config.json");
}

export function loadConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { default: parsed.default, portals: parsed.portals ?? {} };
  } catch {
    return { portals: {} };
  }
}

export function saveConfig(config: CliConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort
  }
}

/** Normalizes a portal URL to its origin (scheme + host + port). */
export function normalizePortal(input: string): string {
  let url: URL;
  try {
    url = new URL(input.includes("://") ? input : `https://${input}`);
  } catch {
    throw new Error(`Not a valid portal URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Portal URL must be http(s): ${input}`);
  return url.origin;
}

export interface Credentials {
  portal: string;
  token: string | null;
}

/**
 * Resolution order: --portal flag, then KITLANE_URL, then the configured default.
 * Token: KITLANE_TOKEN, then the token stored for that portal.
 */
export function resolveCredentials(flagPortal: string | undefined, config: CliConfig = loadConfig()): Credentials {
  const envPortal = process.env.KITLANE_URL?.trim();
  const chosen = flagPortal ?? (envPortal ? envPortal : undefined) ?? config.default;
  if (!chosen) {
    throw new Error("No portal configured. Run `kitlane login <portal-url>` or set KITLANE_URL.");
  }
  const portal = normalizePortal(chosen);
  const envToken = process.env.KITLANE_TOKEN?.trim();
  const token = envToken ? envToken : (config.portals[portal]?.token ?? null);
  return { portal, token };
}
