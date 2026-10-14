import { describe, expect, it } from "vitest";
import { isTransparent, parseColor, relativeLuminance, schemeForColor, schemeForLuminance, schemeFromColorSchemeMeta } from "./theme.js";

describe("parseColor", () => {
  it("parses rgb() and rgba() in comma and space syntax", () => {
    expect(parseColor("rgb(16, 19, 23)")).toEqual({ r: 16, g: 19, b: 23, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("rgb(255 255 255 / 50%)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor("RGB(10%, 20%, 30%)")).toEqual({ r: 25.5, g: 51, b: 76.5, a: 1 });
  });
  it("parses hex colours and transparent", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#101317")).toEqual({ r: 16, g: 19, b: 23, a: 1 });
    expect(parseColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
  it("returns null for anything it does not understand", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor(null)).toBeNull();
    expect(parseColor("white")).toBeNull();
    expect(parseColor("color(srgb 0.1 0.1 0.1)")).toBeNull();
    expect(parseColor("rgb(1, 2)")).toBeNull();
    expect(parseColor("rgb(a, b, c)")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
  });
});

describe("isTransparent", () => {
  it("is true only for a parsed colour with zero alpha", () => {
    expect(isTransparent("rgba(0, 0, 0, 0)")).toBe(true);
    expect(isTransparent("transparent")).toBe(true);
    expect(isTransparent("rgb(0, 0, 0)")).toBe(false);
    expect(isTransparent("nonsense")).toBe(false);
  });
});

describe("relativeLuminance", () => {
  it("follows the WCAG formula", () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.2158, 3);
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
  });
  it("splits schemes at 0.5", () => {
    expect(schemeForLuminance(0.49)).toBe("dark");
    expect(schemeForLuminance(0.5)).toBe("light");
  });
});

describe("schemeForColor", () => {
  it("classifies typical light and dark backgrounds", () => {
    expect(schemeForColor("rgb(246, 247, 249)")).toBe("light");
    expect(schemeForColor("rgb(255, 255, 255)")).toBe("light");
    expect(schemeForColor("rgb(16, 19, 23)")).toBe("dark");
    expect(schemeForColor("#000")).toBe("dark");
  });
  it("returns null for transparent or unparseable colours so callers can fall back", () => {
    expect(schemeForColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(schemeForColor("transparent")).toBeNull();
    expect(schemeForColor("oklch(0.2 0 0)")).toBeNull();
  });
});

describe("schemeFromColorSchemeMeta", () => {
  it("accepts only a single-valued meta", () => {
    expect(schemeFromColorSchemeMeta("dark")).toBe("dark");
    expect(schemeFromColorSchemeMeta("only light")).toBe("light");
    expect(schemeFromColorSchemeMeta("light dark")).toBeNull();
    expect(schemeFromColorSchemeMeta("normal")).toBeNull();
    expect(schemeFromColorSchemeMeta("")).toBeNull();
    expect(schemeFromColorSchemeMeta(null)).toBeNull();
  });
});
