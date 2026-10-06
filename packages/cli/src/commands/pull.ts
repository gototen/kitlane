import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { clientFor, parse, positional, type Command } from "../context.js";
import { printJson, println } from "../output.js";
import { dirIsEmpty, extractTarGz } from "../pack.js";

export const pull: Command = {
  name: "pull",
  summary: "Download a tool's published files for adaptation",
  usage: "kitlane pull <tool> [dir] [--version <id>] [--force]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, { version: { type: "string" }, force: { type: "boolean", default: false } });
    const ref = positional(positionals, 0, "tool name or ID");
    const client = clientFor(ctx);
    const info = await client.get(`/tools/${encodeURIComponent(ref)}`);
    const t = info.tool;
    if (t.mode !== "hosted") throw new Error(`${t.names[0]} is an external entry; there are no hosted files to pull.`);
    const dir = path.resolve(positionals[1] ?? `./${t.names[0] ?? t.id}`);
    if (!(await dirIsEmpty(dir)) && !values.force) {
      throw new Error(`${dir} is not empty. Choose another directory or pass --force to extract into it anyway.`);
    }
    const versionId = values.version as string | undefined;
    const res = await client.download(versionId ? `/tools/${t.id}/versions/${encodeURIComponent(versionId)}/download` : `/tools/${t.id}/download`);
    if (!res.body) throw new Error("Empty download");
    await fsp.mkdir(dir, { recursive: true });
    const written = await extractTarGz(Readable.fromWeb(res.body as any), dir);
    if (ctx.json) return printJson({ tool: { id: t.id, name: t.names[0] }, version: res.headers.get("x-kitlane-version") ?? versionId ?? null, dir, files: written });
    println(`Pulled ${written.length} file${written.length === 1 ? "" : "s"} from ${t.title} into ${dir}`);
    for (const f of written.slice(0, 20)) println(`  ${f}`);
    if (written.length > 20) println(`  ... and ${written.length - 20} more`);
    println("");
    const shown = path.relative(process.cwd(), dir);
    const hint = !shown ? "." : shown.startsWith("..") ? dir : shown;
    println(`Adapt these files with your preferred agent or builder, then \`kitlane publish ${hint} --name <your-name>\``);
    println(`Backends or external services that are not part of the files are not reproduced by pulling.`);
  },
};
