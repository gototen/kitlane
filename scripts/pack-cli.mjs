// Packs the CLI into packages/server/public/kitlane-cli.tgz, so every installation serves the CLI
// that matches it at /.static/kitlane-cli.tgz: `npm install -g https://<portal>/.static/kitlane-cli.tgz`.
// The GitHub Actions workflow written by `kitlane init --workflow` installs it from there.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "packages", "server", "public");
const out = execFileSync("npm", ["pack", "-w", "packages/cli", "--pack-destination", dest, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const [info] = JSON.parse(out);
fs.renameSync(path.join(dest, info.filename), path.join(dest, "kitlane-cli.tgz"));
console.log(`packed ${info.name}@${info.version} as packages/server/public/kitlane-cli.tgz (${info.size} bytes)`);
