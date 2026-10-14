import { describe, expect, it } from "vitest";
import { detectThemeFromHtml, resolvePortalTheme, resolveShellTheme, type ShellThemeInput } from "./theme.js";

describe("detectThemeFromHtml", () => {
  it("reads a dark-only color-scheme meta", () => {
    expect(detectThemeFromHtml('<!doctype html><html><head><meta name="color-scheme" content="dark"></head></html>')).toBe("dark");
  });
  it("reads a light-only color-scheme meta", () => {
    expect(detectThemeFromHtml('<meta name="color-scheme" content="light">')).toBe("light");
  });
  it("treats both values as system, in either order", () => {
    expect(detectThemeFromHtml('<meta name="color-scheme" content="light dark">')).toBe("system");
    expect(detectThemeFromHtml('<meta name="color-scheme" content="dark light">')).toBe("system");
  });
  it("treats normal as system and only light as light", () => {
    expect(detectThemeFromHtml('<meta name="color-scheme" content="normal">')).toBe("system");
    expect(detectThemeFromHtml('<meta name="color-scheme" content="only light">')).toBe("light");
  });
  it("is case-insensitive and accepts attributes in any order with single quotes or no quotes", () => {
    expect(detectThemeFromHtml("<META CONTENT='Dark' NAME='Color-Scheme'>")).toBe("dark");
    expect(detectThemeFromHtml("<meta content=dark name=color-scheme>")).toBe("dark");
    expect(detectThemeFromHtml('<meta charset="utf-8"><meta content="light" name="color-scheme" />')).toBe("light");
  });
  it("uses the first color-scheme meta and ignores other metas", () => {
    expect(detectThemeFromHtml('<meta name="viewport" content="dark"><meta name="color-scheme" content="light"><meta name="color-scheme" content="dark">')).toBe("light");
  });
  it("returns null when there is no meta and no html-tag hint", () => {
    expect(detectThemeFromHtml("<!doctype html><html><head><title>x</title></head><body></body></html>")).toBeNull();
    expect(detectThemeFromHtml("")).toBeNull();
  });
  it("returns null for an unparseable meta content and does not fall back to the html tag", () => {
    expect(detectThemeFromHtml('<html class="dark"><meta name="color-scheme" content="">')).toBeNull();
    expect(detectThemeFromHtml('<html class="dark"><meta name="color-scheme" content="rainbow">')).toBeNull();
  });
  it("falls back to class or data-theme on the html tag when no meta is present", () => {
    expect(detectThemeFromHtml('<html lang="en" class="app dark">')).toBe("dark");
    expect(detectThemeFromHtml("<html data-theme='dark'>")).toBe("dark");
    expect(detectThemeFromHtml('<html class="light">')).toBe("light");
    expect(detectThemeFromHtml('<html data-theme="light" class="dark">')).toBe("light");
    expect(detectThemeFromHtml('<html class="darker">')).toBeNull();
    expect(detectThemeFromHtml('<div class="dark">')).toBeNull();
  });
});

describe("resolveShellTheme", () => {
  const base = (over: Partial<{ theme: ShellThemeInput["entry"]["theme"]; detected: ShellThemeInput["version"] extends infer V ? (V extends null ? never : V)["detected_theme"] : never; pref: ShellThemeInput["user"]["theme_pref"]; rail: ShellThemeInput["user"]["rail_pref"]; noVersion: boolean }> = {}): ShellThemeInput => ({
    entry: { theme: over.theme ?? null },
    version: over.noVersion ? null : { detected_theme: over.detected ?? null },
    user: { theme_pref: over.pref ?? "system", rail_pref: over.rail ?? "tool" },
  });

  it("a forced rail preference wins over everything and locks the theme", () => {
    expect(resolveShellTheme(base({ rail: "light", theme: "dark", detected: "dark", pref: "dark" }))).toEqual({ theme: "light", source: "rail_preference", locked: true });
    expect(resolveShellTheme(base({ rail: "dark", theme: "light", detected: "light", pref: "light" }))).toEqual({ theme: "dark", source: "rail_preference", locked: true });
  });
  it("a declared light or dark theme wins over detection and preference and locks", () => {
    expect(resolveShellTheme(base({ theme: "dark", detected: "light", pref: "light" }))).toEqual({ theme: "dark", source: "declared", locked: true });
    expect(resolveShellTheme(base({ theme: "light", detected: "dark", pref: "dark" }))).toEqual({ theme: "light", source: "declared", locked: true });
  });
  it("a declared system theme skips detection and follows the person's portal preference", () => {
    expect(resolveShellTheme(base({ theme: "system", detected: "dark", pref: "light" }))).toEqual({ theme: "light", source: "preference", locked: false });
    expect(resolveShellTheme(base({ theme: "system", detected: "dark", pref: "system" }))).toEqual({ theme: null, source: "os", locked: false });
  });
  it("without a declaration the detected theme applies and is not locked", () => {
    expect(resolveShellTheme(base({ detected: "dark", pref: "light" }))).toEqual({ theme: "dark", source: "detected", locked: false });
    expect(resolveShellTheme(base({ detected: "light", pref: "dark" }))).toEqual({ theme: "light", source: "detected", locked: false });
  });
  it("a detected system theme falls through to the person's preference", () => {
    expect(resolveShellTheme(base({ detected: "system", pref: "dark" }))).toEqual({ theme: "dark", source: "preference", locked: false });
    expect(resolveShellTheme(base({ detected: "system", pref: "system" }))).toEqual({ theme: null, source: "os", locked: false });
  });
  it("with nothing declared or detected the person's preference applies", () => {
    expect(resolveShellTheme(base({ pref: "light" }))).toEqual({ theme: "light", source: "preference", locked: false });
    expect(resolveShellTheme(base({ pref: "dark" }))).toEqual({ theme: "dark", source: "preference", locked: false });
  });
  it("with nothing at all the result follows the OS", () => {
    expect(resolveShellTheme(base())).toEqual({ theme: null, source: "os", locked: false });
  });
  it("tolerates a missing active version", () => {
    expect(resolveShellTheme(base({ noVersion: true, pref: "dark" }))).toEqual({ theme: "dark", source: "preference", locked: false });
    expect(resolveShellTheme(base({ noVersion: true, theme: "dark" }))).toEqual({ theme: "dark", source: "declared", locked: true });
  });
  it("the rail preference 'tool' is the neutral default", () => {
    expect(resolveShellTheme(base({ rail: "tool", detected: "dark" }))).toEqual({ theme: "dark", source: "detected", locked: false });
  });
});

describe("resolvePortalTheme", () => {
  it("returns the person's scheme, or null to follow the OS", () => {
    expect(resolvePortalTheme({ theme_pref: "light" })).toBe("light");
    expect(resolvePortalTheme({ theme_pref: "dark" })).toBe("dark");
    expect(resolvePortalTheme({ theme_pref: "system" })).toBeNull();
  });
});
