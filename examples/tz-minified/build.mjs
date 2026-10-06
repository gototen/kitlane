import { build } from "esbuild";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const dist = path.join(here, "dist");
mkdirSync(dist, { recursive: true });

// Only dist/ is published. Source stays in the repository and is never uploaded.
await build({
  entryPoints: [path.join(src, "app.jsx")],
  outfile: path.join(dist, "app.js"),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: ["es2020"],
  jsxFactory: "h",
  jsxFragment: "Fragment",
  legalComments: "none",
});
await build({
  entryPoints: [path.join(src, "app.css")],
  outfile: path.join(dist, "app.css"),
  minify: true,
  legalComments: "none",
});
copyFileSync(path.join(src, "index.html"), path.join(dist, "index.html"));

for (const f of ["index.html", "app.js", "app.css"]) {
  console.log(`${f.padEnd(12)} ${statSync(path.join(dist, f)).size} bytes`);
}
