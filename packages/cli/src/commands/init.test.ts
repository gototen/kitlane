import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { END, POINTER, START, WORKFLOW_PATH, detectDeploy, init, upsertSection, validateName } from "./init.js";

describe("upsertSection", () => {
  it("appends a bounded section to an existing file without touching other content", () => {
    const r = upsertSection("# My agents file\n\nDo things.\n", POINTER);
    expect(r.action).toBe("inserted");
    expect(r.text.startsWith("# My agents file\n\nDo things.\n")).toBe(true);
    expect(r.text).toContain(START);
    expect(r.text).toContain(END);
    expect(r.text.endsWith(END + "\n")).toBe(true);
  });
  it("updates only the content between the markers", () => {
    const before = `intro\n${START}\nold\n${END}\noutro\n`;
    const r = upsertSection(before, POINTER);
    expect(r.action).toBe("updated");
    expect(r.text.startsWith("intro\n")).toBe(true);
    expect(r.text.endsWith("\noutro\n")).toBe(true);
    expect(r.text).not.toContain("\nold\n");
    expect(r.text).toContain("Read KITLANE.md");
  });
  it("reports unchanged when the section is already current", () => {
    const once = upsertSection("x\n", POINTER).text;
    expect(upsertSection(once, POINTER).action).toBe("unchanged");
  });
  it("handles an empty file", () => {
    const r = upsertSection("", POINTER);
    expect(r.text).toBe(POINTER + "\n");
  });
});

describe("detectDeploy", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitlane-init-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it("prefers a built folder with index.html, then a root index.html, then ./dist", () => {
    expect(detectDeploy(dir)).toBe("./dist");
    fs.writeFileSync(path.join(dir, "index.html"), "x");
    expect(detectDeploy(dir)).toBe("./index.html");
    fs.mkdirSync(path.join(dir, "build"));
    fs.writeFileSync(path.join(dir, "build/index.html"), "x");
    expect(detectDeploy(dir)).toBe("./build");
  });
});

describe("init in a fork", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitlane-init-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, "kitlane.json"), "utf8"));

  it("creates a manifest with --name and --remix-of, and a workflow with --workflow", async () => {
    await init.run([dir, "--name", "Focus-Anthony", "--remix-of", "kit/focus", "--workflow"], { json: true });
    expect(read()).toMatchObject({ name: "focus-anthony", remixOf: "kit/focus", deploy: "./dist" });
    const workflow = fs.readFileSync(path.join(dir, WORKFLOW_PATH), "utf8");
    expect(workflow).toContain("kitlane publish");
    expect(workflow).toContain("secrets.KITLANE_TOKEN");
    expect(workflow).toContain("vars.KITLANE_URL");
    expect(fs.existsSync(path.join(dir, "KITLANE.md"))).toBe(true);
  });

  it("sets only name and remixOf in an existing manifest and never replaces an existing workflow", async () => {
    fs.writeFileSync(path.join(dir, "kitlane.json"), JSON.stringify({ name: "focus", title: "Focus timer", tags: ["time"], theme: "dark", deploy: "./index.html" }) + "\n");
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, WORKFLOW_PATH), "name: mine\n");
    await init.run([dir, "--name", "focus-mine", "--remix-of", "focus", "--workflow"], { json: true });
    expect(read()).toEqual({ name: "focus-mine", title: "Focus timer", tags: ["time"], theme: "dark", deploy: "./index.html", remixOf: "focus" });
    expect(fs.readFileSync(path.join(dir, WORKFLOW_PATH), "utf8")).toBe("name: mine\n");
  });

  it("leaves an existing manifest alone without those flags", async () => {
    fs.writeFileSync(path.join(dir, "kitlane.json"), '{"name":"focus"}\n');
    await init.run([dir], { json: true });
    expect(fs.readFileSync(path.join(dir, "kitlane.json"), "utf8")).toBe('{"name":"focus"}\n');
  });

  it("rejects a name the portal would refuse", () => {
    expect(validateName("Prep-Mine")).toBe("prep-mine");
    expect(() => validateName("Not valid!")).toThrow(/Not a valid name/);
    expect(() => validateName("a")).toThrow(/Not a valid name/);
  });
});
