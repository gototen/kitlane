import fs from "node:fs";
import path from "node:path";
import { clientFor, parse, type Command } from "../context.js";
import { println } from "../output.js";

export const exportCmd: Command = {
  name: "export",
  summary: "Download the catalog export (entries, names, ownership, lineage, bindings)",
  usage: "kitlane export [--include-shared] [-o <file>]",
  async run(args, ctx) {
    const { values } = parse(args, { "include-shared": { type: "boolean", default: false }, out: { type: "string", short: "o" } });
    const client = clientFor(ctx);
    const data = await client.get(`/export${values["include-shared"] ? "?includeShared=1" : ""}`);
    const text = JSON.stringify(data, null, 2) + "\n";
    if (values.out) {
      const file = path.resolve(String(values.out));
      fs.writeFileSync(file, text);
      if (ctx.json) return println(JSON.stringify({ file, bytes: text.length }));
      return println(`Wrote ${file} (${text.length} bytes). The export never includes personal records or credentials; it is not a full operator backup.`);
    }
    process.stdout.write(text);
  },
};
