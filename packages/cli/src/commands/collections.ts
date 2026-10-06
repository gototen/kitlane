import { UsageError, clientFor, parse, positional, type Command } from "../context.js";
import { formatDate, printJson, println, table } from "../output.js";

export const collections: Command = {
  name: "collections",
  summary: "Manage shared collections, bindings, and writer grants",
  usage: [
    "kitlane collections list [--mine]",
    "kitlane collections create <tool> <name> [--description <text>]",
    "kitlane collections bind <tool> <binding> <collection-id>",
    "kitlane collections unbind <tool> <binding>",
    "kitlane collections show <collection-id>",
    "kitlane collections grant <collection-id> (--user <id|email> | --tool <tool>)",
    "kitlane collections revoke <collection-id> <grant-id>",
  ].join("\n  "),
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      mine: { type: "boolean", default: false },
      description: { type: "string" },
      user: { type: "string" },
      tool: { type: "string" },
    });
    const sub = positionals[0];
    if (!["list", "create", "bind", "unbind", "show", "grant", "revoke"].includes(sub ?? "")) {
      throw new UsageError(`Unknown subcommand "${sub ?? ""}".\n  ${collections.usage}`);
    }
    const client = clientFor(ctx);
    switch (sub) {
      case "list": {
        const r = await client.get(`/collections${values.mine ? "?mine=1" : ""}`);
        if (ctx.json) return printJson(r);
        if (!r.collections.length) return println("No shared collections.");
        return println(
          table(r.collections, [
            { header: "id", value: (c: any) => c.id },
            { header: "name", value: (c: any) => c.name },
            { header: "owner", value: (c: any) => c.ownerName },
            { header: "origin tool", value: (c: any) => c.originToolTitle },
            { header: "docs", value: (c: any) => c.documents, align: "right" },
            { header: "rev", value: (c: any) => c.revision, align: "right" },
            { header: "frozen", value: (c: any) => (c.frozen ? "yes" : "") },
          ]),
        );
      }
      case "create": {
        const ref = positional(positionals, 1, "tool name or ID");
        const name = positional(positionals, 2, "collection name");
        const r = await client.post(`/tools/${encodeURIComponent(ref)}/collections`, { name, description: values.description ?? "" });
        if (ctx.json) return printJson(r);
        println(`Created shared collection ${r.collection.name} (${r.collection.id}), bound as "${name}" in ${ref}.`);
        return println(`Everyone signed in to this installation can read it. Only the owner, granted writers in allowed tool contexts, and scoped updater credentials can write.`);
      }
      case "bind": {
        const ref = positional(positionals, 1, "tool name or ID");
        const binding = positional(positionals, 2, "binding name");
        const collectionId = positional(positionals, 3, "collection ID");
        const r = await client.post(`/tools/${encodeURIComponent(ref)}/bindings`, { binding, collectionId });
        if (ctx.json) return printJson(r);
        return println(`Bound "${binding}" in ${ref} to collection ${collectionId} as a read reference. Writing needs a writer-context grant for that tool.`);
      }
      case "unbind": {
        const ref = positional(positionals, 1, "tool name or ID");
        const binding = positional(positionals, 2, "binding name");
        const r = await client.del(`/tools/${encodeURIComponent(ref)}/bindings/${encodeURIComponent(binding)}`);
        if (ctx.json) return printJson(r);
        return println(`Unbound "${binding}" from ${ref}.`);
      }
      case "show": {
        const id = positional(positionals, 1, "collection ID");
        const r = await client.get(`/collections/${encodeURIComponent(id)}`);
        if (ctx.json) return printJson(r);
        const c = r.collection;
        println(`${c.name}  [${c.id}]`);
        println(`  description: ${c.description || "-"}`);
        println(`  owner:       ${c.owner_id}`);
        println(`  origin tool: ${c.origin_tool_id}`);
        println(`  revision:    ${c.revision}${c.frozen ? "  FROZEN" : ""}`);
        println("");
        if (!r.grants.length) return println("  No explicit writer grants (owner and originating tool are implicit).");
        return println(
          table(r.grants, [
            { header: "grant id", value: (g: any) => g.id },
            { header: "type", value: (g: any) => g.type },
            { header: "subject", value: (g: any) => `${g.subjectName ?? ""} (${g.subjectId})` },
            { header: "granted", value: (g: any) => formatDate(g.grantedAt) },
          ]),
        );
      }
      case "grant": {
        const id = positional(positionals, 1, "collection ID");
        const user = values.user as string | undefined;
        const tool = values.tool as string | undefined;
        if ((user ? 1 : 0) + (tool ? 1 : 0) !== 1) throw new UsageError("Pass exactly one of --user <id|email> or --tool <tool>");
        const r = await client.post(`/collections/${encodeURIComponent(id)}/grants`, user ? { type: "user", subject: user } : { type: "tool", subject: tool });
        if (ctx.json) return printJson(r);
        return println(user ? `${user} may now write to ${id} from allowed tool contexts (grant ${r.grant.id}).` : `Tool ${tool} is now an allowed writer context for ${id} (grant ${r.grant.id}). Its visitors still need a user grant to write.`);
      }
      case "revoke": {
        const id = positional(positionals, 1, "collection ID");
        const grantId = positional(positionals, 2, "grant ID");
        const r = await client.del(`/collections/${encodeURIComponent(id)}/grants/${encodeURIComponent(grantId)}`);
        if (ctx.json) return printJson(r);
        return println(`Revoked grant ${grantId}. It applies to the next write.`);
      }
      default:
        throw new UsageError(`Unknown subcommand "${sub ?? ""}".\n  ${collections.usage}`);
    }
  },
};
