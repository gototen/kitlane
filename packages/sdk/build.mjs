import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../server/public");
mkdirSync(out, { recursive: true });

const common = { entryPoints: [path.join(here, "src/index.ts")], bundle: true, minify: true, sourcemap: false, target: ["es2020"], legalComments: "none" };
await build({ ...common, format: "iife", globalName: "__kitlaneSdk", outfile: path.join(out, "sdk.js"), footer: { js: "window.kitlane=__kitlaneSdk.kitlane;" } });
await build({ ...common, format: "esm", outfile: path.join(out, "sdk.mjs") });
console.log("sdk built →", out);
