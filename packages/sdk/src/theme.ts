/**
 * Pure helpers behind the SDK's runtime theme report: colour parsing and WCAG relative luminance.
 * No DOM access here, so they can be unit tested outside a browser.
 */

export type Scheme = "light" | "dark";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function channel(token: string): number {
  const n = parseFloat(token);
  if (!Number.isFinite(n)) return NaN;
  return clamp(token.endsWith("%") ? n * 2.55 : n, 0, 255);
}

/**
 * Parses `rgb()`/`rgba()` (comma or space syntax, as returned by getComputedStyle), `#hex`, and
 * `transparent`. Returns null for anything else (named colours, `color()`, `oklch()`, ...).
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const fn = /^rgba?\(\s*([^)]*?)\s*\)$/.exec(s);
  if (fn) {
    const parts = fn[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    let a = 1;
    if (parts[3] !== undefined) {
      const raw = parseFloat(parts[3]);
      if (!Number.isFinite(raw)) return null;
      a = clamp(parts[3].endsWith("%") ? raw / 100 : raw, 0, 1);
    }
    return { r, g, b, a };
  }
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
  }
  return null;
}

/** True only for a colour that parses and has zero alpha (`transparent`, `rgba(0, 0, 0, 0)`). */
export function isTransparent(input: string | null | undefined): boolean {
  const c = parseColor(input);
  return c !== null && c.a === 0;
}

function linear(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2 relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Below 0.5 relative luminance a background reads as dark. */
export function schemeForLuminance(luminance: number): Scheme {
  return luminance < 0.5 ? "dark" : "light";
}

/** The scheme a rendered background colour implies, or null when it is transparent or unparseable. */
export function schemeForColor(input: string | null | undefined): Scheme | null {
  const c = parseColor(input);
  if (!c || c.a === 0) return null;
  return schemeForLuminance(relativeLuminance(c.r, c.g, c.b));
}

/** A single-valued color-scheme meta ("dark" or "light"); both values or anything else is null. */
export function schemeFromColorSchemeMeta(content: string | null | undefined): Scheme | null {
  if (!content) return null;
  const tokens = content.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const dark = tokens.includes("dark");
  const light = tokens.includes("light");
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return null;
}
