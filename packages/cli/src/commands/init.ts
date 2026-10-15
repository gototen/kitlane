import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError, parse, readKitlaneJson, type Command } from "../context.js";
import { printJson, println } from "../output.js";

export const START = "<!-- kitlane:start -->";
export const END = "<!-- kitlane:end -->";

export const POINTER = `${START}
## Kitlane

This project publishes to Kitlane. Read KITLANE.md for the publishing contract, hosting constraints, identity, personal storage, shared collections, writer grants, and available capabilities.
${END}`;

/** Where `--workflow` writes the GitHub Actions workflow that publishes on push. */
export const WORKFLOW_PATH = path.join(".github", "workflows", "kitlane.yml");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lowercases a tool name and checks it against the portal's rule, so a bad name fails here rather than at publish time. */
export function validateName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name) || name.length < 2 || name.length > 63) {
    throw new UsageError(`Not a valid name: "${raw}" (lowercase letters, digits, and single hyphens; 2 to 63 characters)`);
  }
  return name;
}

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
  summary: "Write platform guidance (KITLANE.md), a kitlane.json template, and optionally a publish-on-push workflow",
  usage: "kitlane init [dir] [--name <name>] [--remix-of <tool>] [--workflow]",
  async run(args, ctx) {
    const { values, positionals } = parse(args, {
      name: { type: "string" },
      "remix-of": { type: "string" },
      workflow: { type: "boolean", default: false },
    });
    const dir = path.resolve(positionals[0] ?? ".");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
    const name = values.name ? validateName(String(values.name)) : undefined;
    const remixOf = values["remix-of"] ? String(values["remix-of"]).trim() : undefined;
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

    // kitlane.json: create when missing. In a fork, --name and --remix-of set just those two fields and leave the rest alone.
    const metaFile = path.join(dir, "kitlane.json");
    if (fs.existsSync(metaFile)) {
      if (name || remixOf) {
        const current: Record<string, unknown> = { ...(readKitlaneJson(dir) ?? {}) };
        if (name) current.name = name;
        if (remixOf) current.remixOf = remixOf;
        fs.writeFileSync(metaFile, JSON.stringify(current, null, 2) + "\n");
        actions["kitlane.json"] = `updated (${[name && `name: ${name}`, remixOf && `remixOf: ${remixOf}`].filter(Boolean).join(", ")})`;
      } else {
        actions["kitlane.json"] = "exists (left unchanged)";
      }
    } else {
      const template = JSON.parse(fs.readFileSync(path.join(templates, "kitlane.json"), "utf8"));
      template.deploy = detectDeploy(dir);
      template.name = name ?? (template.name || path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63));
      if (remixOf) template.remixOf = remixOf;
      fs.writeFileSync(metaFile, JSON.stringify(template, null, 2) + "\n");
      actions["kitlane.json"] = `created (deploy: ${template.deploy}${remixOf ? `, remix of ${remixOf}` : ""})`;
    }

    // --workflow: a GitHub Actions workflow that publishes on every push. Never replaces one that exists.
    let wroteWorkflow = false;
    if (values.workflow) {
      const file = path.join(dir, WORKFLOW_PATH);
      if (fs.existsSync(file)) {
        actions[WORKFLOW_PATH] = "exists (left unchanged)";
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(path.join(templates, "kitlane-workflow.yml"), file);
        actions[WORKFLOW_PATH] = "created";
        wroteWorkflow = true;
      }
    }

    // Agent instruction files: add a bounded pointer only where they already exist.
    let touchedAgentFile = false;
    for (const agentFile of ["AGENTS.md", "CLAUDE.md"]) {
      const file = path.join(dir, agentFile);
      const st = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isSymbolicLink()) {
        actions[agentFile] = "skipped (is a symlink)";
        continue;
      }
      const existing = fs.readFileSync(file, "utf8");
      const r = upsertSection(existing, POINTER);
      if (r.action !== "unchanged") fs.writeFileSync(file, r.text);
      actions[agentFile] = r.action === "unchanged" ? "pointer up to date" : `pointer ${r.action}`;
      touchedAgentFile = true;
    }

    if (ctx.json) return printJson({ dir, actions });
    println(`Kitlane guidance in ${dir}:`);
    const width = Math.max(...Object.keys(actions).map((k) => k.length)) + 2;
    for (const [file, action] of Object.entries(actions)) println(`  ${file.padEnd(width)} ${action}`);
    if (!touchedAgentFile) {
      println(`  (no AGENTS.md or CLAUDE.md found; agents that read either file can be pointed at KITLANE.md by adding a line to it)`);
    }
    if (remixOf) println(`Lineage: this will be recorded as a remix of ${remixOf} when its name is first claimed.`);
    if (wroteWorkflow) {
      println(`Next: commit these files, then in the repository settings on GitHub add the variable KITLANE_URL and the secret KITLANE_TOKEN. Every push to main then publishes.`);
    } else {
      println(`Next: fill in kitlane.json, then \`kitlane publish\`.`);
    }
  },
};
