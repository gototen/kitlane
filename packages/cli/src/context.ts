import fs from "node:fs";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { createClient, type Client } from "./client.js";
import { loadConfig, resolveCredentials } from "./config.js";

export interface Ctx {
  portalFlag?: string;
  json: boolean;
}

export interface Command {
  name: string;
  summary: string;
  usage: string;
  run(args: string[], ctx: Ctx): Promise<void>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type Options = NonNullable<ParseArgsConfig["options"]>;

export const SHARED_OPTIONS: Options = {
  portal: { type: "string" },
  json: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
};

/** parseArgs with the shared global flags merged in and friendlier errors. */
export function parse<O extends Options>(args: string[], options: O, opts: { allowPositionals?: boolean } = {}) {
  try {
    return parseArgs({ args, options: { ...SHARED_OPTIONS, ...options }, allowPositionals: opts.allowPositionals ?? true, strict: true });
  } catch (err) {
    throw new UsageError((err as Error).message.replace(/^Unknown option/, "Unknown option"));
  }
}

export function clientFor(ctx: Ctx, opts: { requireToken?: boolean } = {}): Client {
  const creds = resolveCredentials(ctx.portalFlag, loadConfig());
  if (opts.requireToken !== false && !creds.token) {
    throw new Error(`No token for ${creds.portal}. Run \`kitlane login ${creds.portal}\`.`);
  }
  return createClient(creds.portal, creds.token);
}

export type ThemeSetting = "light" | "dark" | "system";

export interface KitlaneJson {
  name?: string;
  title?: string;
  purpose?: string;
  tags?: string[];
  deploy?: string;
  repoUrl?: string;
  team?: string;
  /** The scheme the tool renders in, or "system" when it adapts to the OS; the shell matches its rail to it. */
  theme?: ThemeSetting;
}

/** The validated optional theme from kitlane.json; an empty value means "not declared". */
export function themeOf(meta: KitlaneJson | null): ThemeSetting | undefined {
  const value = meta?.theme as unknown;
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "light" || value === "dark" || value === "system") return value;
  throw new Error(`kitlane.json: "theme" must be "light", "dark", or "system" (got ${JSON.stringify(value)}).`);
}

export function readKitlaneJson(dir: string): KitlaneJson | null {
  const file = path.join(dir, "kitlane.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as KitlaneJson;
    return null;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

export function splitTags(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : value.split(",");
  return arr.map((s) => s.trim()).filter(Boolean);
}

export function positional(positionals: string[], index: number, what: string): string {
  const v = positionals[index];
  if (!v) throw new UsageError(`Missing ${what}`);
  return v;
}
