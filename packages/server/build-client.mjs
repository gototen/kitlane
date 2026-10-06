import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "public");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(here, "client/shell.ts"), path.join(here, "client/portal.ts")],
  outdir: out,
  bundle: true,
  minify: true,
  target: ["es2020"],
  format: "iife",
  legalComments: "none",
});
console.log("client built →", out);
