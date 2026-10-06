#!/usr/bin/env node
import { createRequire } from "node:module";
import { describeError } from "./client.js";
import { loadConfig, resolveCredentials } from "./config.js";
import { UsageError, type Command, type Ctx } from "./context.js";
import { println, warn } from "./output.js";
import { login, logout, whoami } from "./commands/login.js";
import { init } from "./commands/init.js";
import { publish } from "./commands/publish.js";
import { register } from "./commands/register.js";
import { search, tool, tools } from "./commands/tools.js";
import { rollback } from "./commands/rollback.js";
import { pull } from "./commands/pull.js";
import { copy } from "./commands/copy.js";
import { names } from "./commands/names.js";
import { lifecycle } from "./commands/lifecycle.js";
import { collections } from "./commands/collections.js";
import { updaters } from "./commands/updaters.js";
import { exportCmd } from "./commands/export.js";

const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;

const GROUPS: { title: string; commands: Command[] }[] = [
  { title: "Account", commands: [login, logout, whoami] },
  { title: "Publish", commands: [init, publish, register, rollback, names, lifecycle] },
  { title: "Discover and adapt", commands: [tools, tool, search, pull, copy] },
  { title: "Data", commands: [collections, updaters, exportCmd] },
];

const COMMANDS = new Map<string, Command>();
for (const g of GROUPS) for (const c of g.commands) COMMANDS.set(c.name, c);

export function helpText(): string {
  const lines = [
    `kitlane ${VERSION}: publish, discover, and adapt the tools your colleagues make`,
    "",
    "Usage: kitlane <command> [options]",
    "",
  ];
  const width = Math.max(...[...COMMANDS.keys()].map((k) => k.length)) + 2;
  for (const g of GROUPS) {
    lines.push(`${g.title}:`);
    for (const c of g.commands) lines.push(`  ${c.name.padEnd(width)}${c.summary}`);
    lines.push("");
  }
  lines.push("Global options:");
  lines.push("  --portal <url>   Portal to talk to (default: KITLANE_URL or the last login)");
  lines.push("  --json           Machine-readable output");
  lines.push("  --help, -h       Show help (kitlane <command> --help for usage)");
  lines.push("  --version        Show version");
  lines.push("");
  lines.push("Environment: KITLANE_URL and KITLANE_TOKEN override the stored configuration.");
  lines.push("Guidance for people and agents: run `kitlane init` to write KITLANE.md into a project.");
  return lines.join("\n");
}

/** Pulls the global flags out of argv so subcommands can parse the rest strictly. */
export function splitGlobal(argv: string[]): { command: string | undefined; rest: string[]; ctx: Ctx; help: boolean; version: boolean } {
  const rest: string[] = [];
  const ctx: Ctx = { json: false };
  let help = false;
  let version = false;
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") ctx.json = true;
    else if (a === "--portal") ctx.portalFlag = argv[++i];
    else if (a.startsWith("--portal=")) ctx.portalFlag = a.slice("--portal=".length);
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--version" || a === "-v") version = true;
    else if (!command && !a.startsWith("-")) command = a;
    else rest.push(a);
  }
  return { command, rest, ctx, help, version };
}

async function main(argv: string[]): Promise<number> {
  const { command, rest, ctx, help, version } = splitGlobal(argv);
  if (version) {
    println(VERSION);
    return 0;
  }
  if (!command || command === "help") {
    println(helpText());
    return command ? 0 : help ? 0 : 1;
  }
  const cmd = COMMANDS.get(command);
  if (!cmd) {
    warn(`Unknown command "${command}".\n`);
    warn(helpText());
    return 1;
  }
  if (help) {
    println(`${cmd.summary}\n\nUsage:\n  ${cmd.usage}`);
    return 0;
  }
  try {
    await cmd.run(rest, ctx);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      warn(`${err.message}\n\nUsage:\n  ${cmd.usage}`);
      return 1;
    }
    let portal: string | null = null;
    try {
      portal = resolveCredentials(ctx.portalFlag, loadConfig()).portal;
    } catch {
      portal = null;
    }
    const message = describeError(err, portal);
    if (ctx.json) warn(JSON.stringify({ error: (err as any)?.code ?? "error", message, details: (err as any)?.details ?? undefined }));
    else warn(`kitlane ${command}: ${message}`);
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    warn(`kitlane: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
