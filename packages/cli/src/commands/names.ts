import { UsageError, clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const names: Command = {
  name: "names",
  summary: "Add or remove a tool's names",
  usage: "kitlane names add <tool> <name> | kitlane names remove <tool> <name>",
  async run(args, ctx) {
    const { positionals } = parse(args, {});
    const sub = positionals[0];
    if (sub !== "add" && sub !== "remove") throw new UsageError(`Unknown subcommand "${sub ?? ""}". Use: names add|remove <tool> <name>`);
    const ref = positional(positionals, 1, "tool name or ID");
    const name = positional(positionals, 2, "name").toLowerCase();
    const client = clientFor(ctx);
    if (sub === "add") {
      const r = await client.post(`/tools/${encodeURIComponent(ref)}/names`, { name });
      if (ctx.json) return printJson(r);
      return println(`Added name ${r.name}`);
    }
    if (sub === "remove") {
      const r = await client.del(`/tools/${encodeURIComponent(ref)}/names/${encodeURIComponent(name)}`);
      if (ctx.json) return printJson(r);
      return println(`Released name ${name}. Its history is kept.`);
    }
    throw new UsageError(`Unknown subcommand "${sub ?? ""}". Use: names add|remove <tool> <name>`);
  },
};
