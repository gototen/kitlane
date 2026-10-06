import { clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const rollback: Command = {
  name: "rollback",
  summary: "Make an earlier version active (stored data is unchanged)",
  usage: "kitlane rollback <tool> --version <number|id>",
  async run(args, ctx) {
    const { values, positionals } = parse(args, { version: { type: "string" } });
    const ref = positional(positionals, 0, "tool name or ID");
    const version = (values.version as string | undefined)?.trim();
    if (!version) throw new Error("--version <number|id> is required");
    const client = clientFor(ctx);
    const body = /^\d+$/.test(version) ? { number: Number(version) } : { versionId: version };
    const result = await client.post(`/tools/${encodeURIComponent(ref)}/rollback`, body);
    if (ctx.json) return printJson(result);
    println(`Active version is now v${result.active.number} (${result.active.id}). Documents and personal data are unchanged.`);
  },
};
