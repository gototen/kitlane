import { UsageError, clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";

const STATES = ["experimental", "maintained", "retired"];

export const lifecycle: Command = {
  name: "lifecycle",
  summary: "Mark a tool experimental, maintained, or retired",
  usage: "kitlane lifecycle <tool> <experimental|maintained|retired> [--replacement <tool-id>]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, { replacement: { type: "string" } });
    const ref = positional(positionals, 0, "tool name or ID");
    const state = positional(positionals, 1, "lifecycle state");
    if (!STATES.includes(state)) throw new UsageError(`Lifecycle must be one of ${STATES.join(", ")}`);
    const client = clientFor(ctx);
    const r = await client.post(`/tools/${encodeURIComponent(ref)}/lifecycle`, { lifecycle: state, replacement: values.replacement ?? null });
    if (ctx.json) return printJson(r);
    println(`${ref} is now ${state}${values.replacement ? ` (replacement: ${values.replacement})` : ""}. Lifecycle describes maintainer intent, not a security certification.`);
  },
};
