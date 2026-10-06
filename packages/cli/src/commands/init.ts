import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const START = "<!-- kitlane:start -->";
export const END = "<!-- kitlane:end -->";

export const POINTER = `${START}
## Kitlane

This project publishes to Kitlane. Read KITLANE.md for the publishing contract, hosting constraints, identity, personal storage, shared collections, writer grants, and available capabilities.
${END}`;

/**
 * Inserts or replaces the bounded Kitlane section in an existing file's text.
 * Never touches content outside the markers.
 */
export function upsertSection(existing: string, section: string): { text: string; action: "inserted" | "updated" | "unchanged" } {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start >= 0 && end > start) {
    const current = existing.slice(start, end + END.length);
    if (current === section) return { text: existing, action: "unchanged" };
    return { text: existing.slice(0, start) + section + existing.slice(end + END.length), action: "updated" };
  }
  const sep = existing.length === 0 ? "" : existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return { text: existing + sep + section + "\n", action: "inserted" };
}

export function templatesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");
}

export function detectDeploy(dir: string): string {
  for (const candidate of ["dist", "build", "public", "out"]) {
    if (fs.existsSync(path.join(dir, candidate, "index.html"))) return `./${candidate}`;
  }
  if (fs.existsSync(path.join(dir, "index.html"))) return "./index.html";
  if (fs.existsSync(path.join(dir, "dist"))) return "./dist";
  return "./dist";
}

export const init: Command = {
  name: "init",
  summary: "Write platform guidance (KITLANE.md) and a kitlane.json metadata template",
  usage: "kitlane init [dir]",
  async run(args, ctx) {
    const { positionals } = parse(args, {});
    const dir = path.resolve(positionals[0] ?? ".");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
    const actions: Record<string, string> = {};
    const templates = templatesDir();

    // KITLANE.md: create, or refresh the bounded section if someone added their own notes around it.
    const guidance = fs.readFileSync(path.join(templates, "KITLANE.md"), "utf8");
    const guidanceFile = path.join(dir, "KITLANE.md");
    if (fs.lstatSync(guidanceFile, { throwIfNoEntry: false })?.isSymbolicLink()) {
      actions["KITLANE.md"] = "skipped (is a symlink; refusing to overwrite)";
    } else if (!fs.existsSync(guidanceFile)) {
      fs.writeFileSync(guidanceFile, guidance);
      actions["KITLANE.md"] = "created";
    } else {
      const existing = fs.readFileSync(guidanceFile, "utf8");
      if (existing.includes(START) && existing.includes(END)) {
        const inner = guidance.slice(guidance.indexOf(START), guidance.indexOf(END) + END.length);
        const r = upsertSection(existing, inner);
        if (r.action !== "unchanged") fs.writeFileSync(guidanceFile, r.text);
        actions["KITLANE.md"] = r.action === "unchanged" ? "up to date" : "updated platform section";
      } else {
        actions["KITLANE.md"] = "exists (left unchanged)";
      }
    }

    // kitlane.json: create only when missing.
    const metaFile = path.join(dir, "kitlane.json");
    if (fs.existsSync(metaFile)) {
      actions["kitlane.json"] = "exists (left unchanged)";
    } else {
      const template = JSON.parse(fs.readFileSync(path.join(templates, "kitlane.json"), "utf8"));
      template.deploy = detectDeploy(dir);
      template.name = template.name || path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
      fs.writeFileSync(metaFile, JSON.stringify(template, null, 2) + "\n");
      actions["kitlane.json"] = `created (deploy: ${template.deploy})`;
    }

    // Agent instruction files: add a bounded pointer only where they already exist.
    let touchedAgentFile = false;
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(dir, name);
      const st = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isSymbolicLink()) {
        actions[name] = "skipped (is a symlink)";
        continue;
      }
      const existing = fs.readFileSync(file, "utf8");
      const r = upsertSection(existing, POINTER);
      if (r.action !== "unchanged") fs.writeFileSync(file, r.text);
      actions[name] = r.action === "unchanged" ? "pointer up to date" : `pointer ${r.action}`;
      touchedAgentFile = true;
    }

    if (ctx.json) return printJson({ dir, actions });
    println(`Kitlane guidance in ${dir}:`);
    for (const [file, action] of Object.entries(actions)) println(`  ${file.padEnd(14)} ${action}`);
    if (!touchedAgentFile) {
      println(`  (no AGENTS.md or CLAUDE.md found; agents that read either file can be pointed at KITLANE.md by adding a line to it)`);
    }
    println(`Next: fill in kitlane.json, then \`kitlane publish\`.`);
  },
};
