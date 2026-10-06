import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { END, POINTER, START, detectDeploy, upsertSection } from "./init.js";

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
