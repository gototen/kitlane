import path from "node:path";
import { ApiError } from "../client.js";
import { clientFor, parse, readKitlaneJson, splitTags, themeOf, type Command } from "../context.js";
import { formatBytes, printJson, println, warn } from "../output.js";
import { packTarget } from "../pack.js";

export const publish: Command = {
  name: "publish",
  summary: "Upload a single HTML file or a prepared folder as a new immutable version",
  usage: "kitlane publish [path] [--name <name>] [--title <t>] [--purpose <p>] [--tags a,b] [--note <msg>] [--no-activate] [--create]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      name: { type: "string" },
      title: { type: "string" },
      purpose: { type: "string" },
      tags: { type: "string" },
      note: { type: "string" },
      "no-activate": { type: "boolean", default: false },
      create: { type: "boolean", default: false },
    });
    const meta = readKitlaneJson(process.cwd());
    const target = positionals[0] ?? meta?.deploy;
    if (!target) throw new Error("Give a path to publish (a single HTML file or a folder with index.html), or set \"deploy\" in kitlane.json.");
    const name = ((values.name as string | undefined) ?? meta?.name ?? "").trim().toLowerCase();
    if (!name) throw new Error("Give --name <name> or set \"name\" in kitlane.json.");
    const theme = themeOf(meta);

    const packed = await packTarget(path.resolve(target));
    for (const s of packed.skippedSymlinks) warn(`skipping symlink: ${s}`);
    if (!ctx.json) {
      println(`Packing ${packed.singleFile ? "single file as index.html" : target}: ${packed.files.length} file${packed.files.length === 1 ? "" : "s"}, ${formatBytes(packed.totalBytes)}`);
    }

    const client = clientFor(ctx);
    const me = await client.get<{ shortcut: string }>("/me");
    let tool: any;
    try {
      tool = (await client.get(`/tools/${encodeURIComponent(name)}`)).tool;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      const created = await client.post("/tools", {
        name,
        title: (values.title as string | undefined) ?? meta?.title ?? name,
        purpose: (values.purpose as string | undefined) ?? meta?.purpose ?? "",
        tags: splitTags((values.tags as string | undefined) ?? meta?.tags),
        mode: "hosted",
        kind: "tool",
        repoUrl: meta?.repoUrl,
        team: meta?.team,
        theme,
      });
      tool = created.tool;
      if (!ctx.json) println(`Claimed ${me.shortcut}/${name}`);
      if (theme && !ctx.json) println(`Theme: ${theme} (from kitlane.json)`);
    }
    if (tool.mode !== "hosted") throw new Error(`${me.shortcut}/${name} is an external entry; it has no hosted files to publish.`);
    if (theme && tool.theme !== theme) {
      // The manifest is the source of truth for the declared theme; align the catalog before uploading.
      tool = (await client.patch(`/tools/${tool.id}`, { theme })).tool;
      if (!ctx.json) println(`Theme: ${theme} (from kitlane.json)`);
    }

    const headers: Record<string, string> = {};
    if (values.note) headers["x-kitlane-note"] = String(values.note);
    const query = values["no-activate"] ? "?activate=0" : "";
    const result = await client.upload(`/tools/${tool.id}/versions${query}`, packed.stream, headers);
    if (ctx.json) return printJson({ tool: { id: tool.id, name }, ...result });
    if (result.unchanged) {
      println(`Unchanged: identical to the active version (v${result.version.number}). Nothing published.`);
    } else {
      println(`Published v${result.version.number}${result.activated ? " (active)" : " (uploaded, not activated)"}: ${result.version.fileCount} files, ${formatBytes(result.version.totalBytes)}`);
    }
    println(`Open:   ${result.launchUrl}`);
    println(`Origin: ${result.origin}`);
  },
};
