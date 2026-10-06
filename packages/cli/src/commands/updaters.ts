import { UsageError, clientFor, parse, positional, type Command } from "../context.js";
import { formatDate, printJson, println, table } from "../output.js";

export const updaters: Command = {
  name: "updaters",
  summary: "Issue, list, or revoke scoped credentials for external update processes",
  usage: [
    "kitlane updaters create --label <label> --collection <id> [--collection <id> ...] [--ops read,write,bulk] [--expires-days 90]",
    "kitlane updaters list",
    "kitlane updaters revoke <id>",
  ].join("\n  "),
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      label: { type: "string" },
      collection: { type: "string", multiple: true },
      ops: { type: "string", default: "read,write,bulk" },
      "expires-days": { type: "string", default: "90" },
    });
    const sub = positionals[0];
    if (!["create", "list", "revoke"].includes(sub ?? "")) throw new UsageError(`Unknown subcommand "${sub ?? ""}".\n  ${updaters.usage}`);
    const client = clientFor(ctx);
    switch (sub) {
      case "create": {
        const label = (values.label as string | undefined)?.trim();
        const ids = (values.collection as string[] | undefined) ?? [];
        if (!label) throw new UsageError("--label is required");
        if (!ids.length) throw new UsageError("At least one --collection <id> is required");
        const operations = String(values.ops).split(",").map((s) => s.trim()).filter(Boolean);
        const days = Number(values["expires-days"]);
        if (!Number.isFinite(days) || days < 0) throw new UsageError("--expires-days must be a non-negative number (0 = no expiry)");
        const r = await client.post("/updaters", { label, collectionIds: ids, operations, expiresInDays: days });
        if (ctx.json) return printJson(r);
        println(`Created updater credential ${r.updater.id} (${label}) for ${ids.join(", ")}; operations: ${operations.join(", ")}; expires: ${r.updater.expiresAt ? formatDate(r.updater.expiresAt) : "never"}.`);
        println("");
        println(`  ${r.token}`);
        println("");
        println("This token is shown once. Keep it in the external process's environment only.");
        return println("Never commit it or place it in published HTML or JavaScript; anyone who can open the tool could read it there.");
      }
      case "list": {
        const r = await client.get("/updaters");
        if (ctx.json) return printJson(r);
        if (!r.updaters.length) return println("No updater credentials.");
        return println(
          table(r.updaters, [
            { header: "id", value: (u: any) => u.id },
            { header: "label", value: (u: any) => u.label },
            { header: "collections", value: (u: any) => u.collectionIds.join(",") },
            { header: "operations", value: (u: any) => u.operations.join(",") },
            { header: "expires", value: (u: any) => (u.expiresAt ? formatDate(u.expiresAt) : "never") },
            { header: "last used", value: (u: any) => formatDate(u.lastUsedAt) },
            { header: "status", value: (u: any) => (u.revokedAt ? "revoked" : "active") },
          ]),
        );
      }
      case "revoke": {
        const id = positional(positionals, 1, "updater credential ID");
        const r = await client.del(`/updaters/${encodeURIComponent(id)}`);
        if (ctx.json) return printJson(r);
        return println(`Revoked ${id}. Subsequent writes with that credential are refused.`);
      }
      default:
        throw new UsageError(`Unknown subcommand "${sub ?? ""}".\n  ${updaters.usage}`);
    }
  },
};
