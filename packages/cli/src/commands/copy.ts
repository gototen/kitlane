import { clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";

async function run(args: string[], ctx: Parameters<Command["run"]>[1]): Promise<void> {
  const { values, positionals } = parse(args, { name: { type: "string" }, title: { type: "string" } });
  const ref = positional(positionals, 0, "tool name or ID");
  const name = (values.name as string | undefined)?.trim().toLowerCase();
  if (!name) throw new Error("--name <new-name> is required");
  const client = clientFor(ctx);
  // The API route keeps its original name; "remix" is the product word for the same operation.
  const result = await client.post(`/tools/${encodeURIComponent(ref)}/copy`, { name, title: values.title });
  if (ctx.json) return printJson(result);
  const t = result.tool;
  println(`Remix created: ${t.title} at ${t.launchUrl} (origin ${t.origin}).`);
  println(`Lineage credits the original maker. Personal storage starts empty; shared bindings are read references only.`);
  println(`Next: \`kitlane pull ${name}\`, adapt, then \`kitlane publish <dir> --name ${name}\` to publish your remix.`);
}

export const remix: Command = {
  name: "remix",
  summary: "Remix: duplicate a tool's published files into a new tool you own (the original maker stays credited)",
  usage: "kitlane remix <tool> --name <new-name> [--title <t>]",
  run,
};

/** `kitlane copy` keeps working as an alias of `kitlane remix`. */
export const copy: Command = {
  name: "copy",
  summary: "Alias of remix",
  usage: "kitlane copy <tool> --name <new-name> [--title <t>]",
  run,
};
