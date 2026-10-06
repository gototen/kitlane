import { clientFor, parse, positional, splitTags, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const register: Command = {
  name: "register",
  summary: "Register an existing URL as a tool or link with a memorable name",
  usage: "kitlane register <url> --name <name> [--title <t>] [--purpose <p>] [--tags a,b] [--resource]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      name: { type: "string" },
      title: { type: "string" },
      purpose: { type: "string" },
      tags: { type: "string" },
      resource: { type: "boolean", default: false },
    });
    const url = positional(positionals, 0, "URL to register");
    const name = (values.name as string | undefined)?.trim().toLowerCase();
    if (!name) throw new Error("--name is required");
    const client = clientFor(ctx);
    const me = await client.get<{ shortcut: string }>("/me");
    const result = await client.post("/tools", {
      name,
      title: (values.title as string | undefined) ?? name,
      purpose: (values.purpose as string | undefined) ?? "",
      tags: splitTags(values.tags as string | undefined),
      mode: "external",
      kind: values.resource ? "resource" : "tool",
      externalUrl: url,
    });
    if (ctx.json) return printJson(result);
    println(`Registered ${me.shortcut}/${name} -> ${url}`);
    println(`Details: ${result.tool.launchUrl.replace(/\/[^/]+$/, `/.tool/${result.tool.id}`)}`);
  },
};
