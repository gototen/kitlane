import { clientFor, parse, positional, type Command } from "../context.js";
import { formatBytes, formatDate, printJson, println, table } from "../output.js";

function toolRows(tools: any[]) {
  return table(tools, [
    { header: "name", value: (t) => t.names?.[0] ?? "" },
    { header: "title", value: (t) => t.title },
    { header: "kind", value: (t) => (t.kind === "resource" ? "link" : t.mode) },
    { header: "lifecycle", value: (t) => (t.frozen ? `${t.lifecycle} (frozen)` : t.lifecycle) },
    { header: "creator", value: (t) => t.creator?.name ?? "" },
    { header: "id", value: (t) => t.id },
  ]);
}

export const tools: Command = {
  name: "tools",
  summary: "List tools (yours with --mine, or search with -q)",
  usage: "kitlane tools [--mine] [-q <query>]",
  async run(args, ctx) {
    const { values } = parse(args, { mine: { type: "boolean", default: false }, q: { type: "string", short: "q" } });
    const client = clientFor(ctx);
    const query = values.mine ? "?mine=1" : values.q ? `?q=${encodeURIComponent(String(values.q))}` : "";
    const result = await client.get(`/tools${query}`);
    if (ctx.json) return printJson(result);
    if (!result.tools.length) return println("No tools.");
    println(toolRows(result.tools));
  },
};

export const tool: Command = {
  name: "tool",
  summary: "Show one tool: addresses, versions, bindings, maintainers",
  usage: "kitlane tool <name|id>",
  async run(args, ctx) {
    const { positionals } = parse(args, {});
    const ref = positional(positionals, 0, "tool name or ID");
    const client = clientFor(ctx);
    const info = await client.get(`/tools/${encodeURIComponent(ref)}`);
    if (ctx.json) return printJson(info);
    const t = info.tool;
    println(`${t.title}  [${t.id}]`);
    println(`  names:      ${t.names.map((n: string) => n).join(", ")}`);
    println(`  launch:     ${t.launchUrl}`);
    if (t.origin) println(`  origin:     ${t.origin}`);
    if (t.externalUrl) println(`  destination: ${t.externalUrl}`);
    println(`  purpose:    ${t.purpose || "-"}`);
    println(`  tags:       ${t.tags.join(", ") || "-"}`);
    println(`  creator:    ${t.creator.name}${t.creator.team ? ` (${t.creator.team})` : ""}`);
    println(`  owner:      ${t.owner.name}`);
    println(`  maintainers: ${info.maintainers.map((m: any) => m.name + (m.owner ? " (owner)" : "")).join(", ")}`);
    println(`  lifecycle:  ${t.lifecycle}${t.frozen ? "  FROZEN" : ""}${t.featured ? "  featured" : ""}`);
    if (t.repoUrl) println(`  repository: ${t.repoUrl}`);
    if (t.copiedFrom) println(`  copied from: tool ${t.copiedFrom.entryId} version ${t.copiedFrom.versionId}`);
    if (t.mode === "hosted") {
      println("");
      if (!info.versions.length) println("  No versions published yet.");
      else
        println(
          table(info.versions, [
            { header: "version", value: (v: any) => `v${v.number}${v.active ? " *" : ""}` },
            { header: "published", value: (v: any) => formatDate(v.createdAt) },
            { header: "by", value: (v: any) => v.createdBy ?? "-" },
            { header: "files", value: (v: any) => v.fileCount, align: "right" },
            { header: "size", value: (v: any) => formatBytes(v.totalBytes), align: "right" },
            { header: "note", value: (v: any) => (v.removed ? "(content removed)" : v.note ?? "") },
            { header: "id", value: (v: any) => v.id },
          ]),
        );
      if (info.bindings.length) {
        println("");
        println(table(info.bindings, [
          { header: "binding", value: (b: any) => b.name },
          { header: "collection", value: (b: any) => b.collectionName },
          { header: "collection id", value: (b: any) => b.collectionId },
          { header: "origin tool", value: (b: any) => (b.originTool === t.id ? "this tool (may write)" : b.originTool) },
          { header: "frozen", value: (b: any) => (b.frozen ? "yes" : "") },
        ]));
      }
    }
  },
};

export const search: Command = {
  name: "search",
  summary: "Search the catalog",
  usage: "kitlane search <query>",
  async run(args, ctx) {
    const { positionals } = parse(args, {});
    const q = positionals.join(" ").trim();
    if (!q) throw new Error("Give a search query");
    const client = clientFor(ctx);
    const result = await client.get(`/search?q=${encodeURIComponent(q)}`);
    if (ctx.json) return printJson(result);
    if (!result.results.length) return println("No matches.");
    println(toolRows(result.results));
  },
};
