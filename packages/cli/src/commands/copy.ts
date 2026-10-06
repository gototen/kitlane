import { clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const copy: Command = {
  name: "copy",
  summary: "Make a copy: duplicate a tool's published files into a new tool you own",
  usage: "kitlane copy <tool> --name <new-name> [--title <t>]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, { name: { type: "string" }, title: { type: "string" } });
    const ref = positional(positionals, 0, "tool name or ID");
    const name = (values.name as string | undefined)?.trim().toLowerCase();
    if (!name) throw new Error("--name <new-name> is required");
    const client = clientFor(ctx);
    const result = await client.post(`/tools/${encodeURIComponent(ref)}/copy`, { name, title: values.title });
    if (ctx.json) return printJson(result);
    const t = result.tool;
    println(`Created ${t.title} at ${t.launchUrl} (origin ${t.origin}).`);
    println(`Lineage records the original. Personal storage starts empty; shared bindings are read references only.`);
    println(`Next: \`kitlane pull ${name}\`, adapt, then \`kitlane publish <dir> --name ${name}\`.`);
  },
};
