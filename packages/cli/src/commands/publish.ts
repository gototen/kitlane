import path from "node:path";
import { ApiError } from "../client.js";
import { clientFor, parse, readKitlaneJson, splitTags, themeOf, type Command } from "../context.js";
import { formatBytes, printJson, println, warn } from "../output.js";
import { packTarget } from "../pack.js";

export const publish: Command = {
  name: "publish",
  summary: "Upload a single HTML file or a prepared folder as a new immutable version",
  usage: "kitlane publish [path] [--name <name>] [--title <t>] [--purpose <p>] [--tags a,b] [--remix-of <tool>] [--note <msg>] [--no-activate] [--create]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      name: { type: "string" },
      title: { type: "string" },
      purpose: { type: "string" },
      tags: { type: "string" },
      "remix-of": { type: "string" },
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
    const remixOf = ((values["remix-of"] as string | undefined) ?? meta?.remixOf ?? "").trim() || undefined;

    const packed = await packTarget(path.resolve(target));
    for (const s of packed.skippedSymlinks) warn(`skipping symlink: ${s}`);
    if (!ctx.json) {
      println(`Packing ${packed.singleFile ? "single file as index.html" : target}: ${packed.files.length} file${packed.files.length === 1 ? "" : "s"}, ${formatBytes(packed.totalBytes)}`);
    }

    const client = clientFor(ctx);
    const me = await client.get<{ shortcut: string }>("/me");
    let tool: any;
    let claimed = false;
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
        remixOf,
      });
      tool = created.tool;
      claimed = true;
      if (!ctx.json) println(`Claimed ${me.shortcut}/${name}`);
      if (theme && !ctx.json) println(`Theme: ${theme} (from kitlane.json)`);
      if (remixOf && !ctx.json) println(`Lineage: a remix of ${remixOf}. The original maker stays credited on your tool page.`);
    }
    if (tool.mode !== "hosted") throw new Error(`${me.shortcut}/${name} is an external entry; it has no hosted files to publish.`);
    if (remixOf && !claimed && !tool.copiedFrom) {
      warn(`remixOf is recorded only when a name is first claimed; ${me.shortcut}/${name} already exists without lineage.`);
    }
    // A name that someone else maintains answers 403 below. In a fork that usually means the manifest still carries the original's name.
    const explain = (err: unknown) =>
      err instanceof ApiError && err.status === 403 && !claimed
        ? new Error(`${err.message}\n${me.shortcut}/${name} is maintained by someone else. If this is your fork of their tool, give it a name of its own: \`kitlane init --name <new-name> --remix-of ${name}\`, then publish again.`)
        : err;

    let result: any;
    try {
      if (theme && tool.theme !== theme) {
        // The manifest is the source of truth for the declared theme; align the catalog before uploading.
        tool = (await client.patch(`/tools/${tool.id}`, { theme })).tool;
        if (!ctx.json) println(`Theme: ${theme} (from kitlane.json)`);
      }
      const headers: Record<string, string> = {};
      if (values.note) headers["x-kitlane-note"] = String(values.note);
      const query = values["no-activate"] ? "?activate=0" : "";
      result = await client.upload(`/tools/${tool.id}/versions${query}`, packed.stream, headers);
    } catch (err) {
      throw explain(err);
    }
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
