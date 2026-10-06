import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { createClient } from "../client.js";
import { loadConfig, normalizePortal, saveConfig } from "../config.js";
import { parse, positional, type Command, type Ctx } from "../context.js";
import { printJson, println } from "../output.js";

function tryOpen(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // ignore: the URL is printed anyway
  }
}

export const login: Command = {
  name: "login",
  summary: "Store a personal access token for a portal",
  usage: "kitlane login <portal-url> [--token <token>]",
  async run(args, ctx: Ctx) {
    const { values, positionals } = parse(args, { token: { type: "string" } });
    const portal = normalizePortal(positional(positionals, 0, "portal URL (for example https://kit.example.com)"));
    let token = (values.token as string | undefined)?.trim();
    if (!token) {
      const tokensUrl = `${portal}/.me#tokens`;
      println(`Create a CLI access token in your browser, then paste it here.`);
      println(`  ${tokensUrl}`);
      tryOpen(tokensUrl);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        token = (await rl.question("Token: ")).trim();
      } finally {
        rl.close();
      }
    }
    if (!token) throw new Error("No token provided");
    const client = createClient(portal, token);
    const me = await client.get<{ displayName: string; shortcut: string }>("/me");
    const config = loadConfig();
    config.portals[portal] = { token, user: me.displayName };
    config.default = portal;
    saveConfig(config);
    if (ctx.json) return printJson({ portal, user: me.displayName, shortcut: me.shortcut });
    println(`Signed in to ${portal} as ${me.displayName}. Default portal set.`);
  },
};

export const logout: Command = {
  name: "logout",
  summary: "Forget the stored token for a portal",
  usage: "kitlane logout [portal-url]",
  async run(args, ctx) {
    const { positionals } = parse(args, {});
    const config = loadConfig();
    const portal = positionals[0] ? normalizePortal(positionals[0]) : config.default;
    if (!portal || !config.portals[portal]) throw new Error("Nothing to log out from");
    delete config.portals[portal];
    if (config.default === portal) config.default = Object.keys(config.portals)[0];
    saveConfig(config);
    if (ctx.json) return printJson({ portal, loggedOut: true });
    println(`Removed credentials for ${portal}. Revoke the token in the portal under My tools if it may have leaked.`);
  },
};

export const whoami: Command = {
  name: "whoami",
  summary: "Show the signed-in identity",
  usage: "kitlane whoami",
  async run(args, ctx) {
    parse(args, {});
    const { clientFor } = await import("../context.js");
    const client = clientFor(ctx);
    const me = await client.get("/me");
    if (ctx.json) return printJson(me);
    println(`${me.displayName} (${me.id}) at ${me.portal}  shortcut: ${me.shortcut}/${me.isAdmin ? "  administrator" : ""}`);
  },
};
