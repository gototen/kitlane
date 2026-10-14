/**
 * Theme resolution: how light/dark is decided for the portal (follows the person) and for the
 * shell (matches the tool it frames). Pure functions; the precedence table is documented in
 * docs/architecture.md under "Theme resolution".
 */
import type { RailPref, Scheme, ThemeSetting } from "../types.js";

export type { RailPref, Scheme, ThemeSetting };

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system";
}

export function isRailPref(value: unknown): value is RailPref {
  return value === "tool" || value === "light" || value === "dark";
}

/** Parses the attributes of one HTML start tag. First occurrence of an attribute wins. */
function parseAttributes(tag: string): Record<string, string> {
  const body = tag.replace(/^<\s*[A-Za-z][^\s/>]*/, "").replace(/\/?>$/, "");
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return out;
}

/** Interprets the content of a color-scheme meta: "dark", "light", "only light", "light dark", "normal". */
function themeFromColorSchemeContent(content: string): ThemeSetting | null {
  const tokens = content.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const dark = tokens.includes("dark");
  const light = tokens.includes("light");
  if (dark && light) return "system";
  if (tokens.includes("normal")) return "system";
  if (dark) return "dark";
  if (light) return "light";
  return null;
}

/**
 * Sniffs a tool's theme from its index.html. The first `<meta name="color-scheme">` decides
 * (case-insensitive, attributes in any order, single or double quotes): only "dark" means dark,
 * only "light" (including "only light") means light, both values or "normal" mean the tool adapts
 * to the OS ("system"), anything else means unknown (null). Without a meta, `class="dark"` or
 * `data-theme="dark"` on the html tag is a weak dark signal (and the same for light).
 */
export function detectThemeFromHtml(html: string): ThemeSetting | null {
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const attrs = parseAttributes(m[0]);
    if ((attrs.name ?? "").toLowerCase() !== "color-scheme") continue;
    return themeFromColorSchemeContent(attrs.content ?? "");
  }
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) {
    const attrs = parseAttributes(htmlTag[0]);
    const dataTheme = (attrs["data-theme"] ?? "").toLowerCase();
    if (dataTheme === "dark" || dataTheme === "light") return dataTheme;
    const classes = (attrs.class ?? "").toLowerCase().split(/\s+/);
    if (classes.includes("dark")) return "dark";
    if (classes.includes("light")) return "light";
  }
  return null;
}

export type ShellThemeSource = "rail_preference" | "declared" | "detected" | "preference" | "os";

export interface ShellThemeInput {
  entry: { theme: ThemeSetting | null };
  version: { detected_theme: ThemeSetting | null } | null;
  user: { theme_pref: ThemeSetting; rail_pref: RailPref };
}

export interface ShellTheme {
  /** The scheme to render, or null to follow the OS through the CSS media query. */
  theme: Scheme | null;
  source: ShellThemeSource;
  /** True when the tool's runtime report (postMessage "kitlane:theme") must not override the result. */
  locked: boolean;
}

function fromPreference(user: { theme_pref: ThemeSetting }): ShellTheme {
  if (user.theme_pref === "light" || user.theme_pref === "dark") return { theme: user.theme_pref, source: "preference", locked: false };
  return { theme: null, source: "os", locked: false };
}

/**
 * The shell matches the tool it frames. Precedence, highest first:
 * 1. the person's rail preference when forced to light or dark;
 * 2. the theme declared in the tool's manifest ("system" means the tool adapts to the OS, so it
 *    falls through to the person's portal preference and the detected theme is ignored);
 * 3. (client side) the SDK's runtime report of the rendered background, unless locked;
 * 4. the theme sniffed from index.html at publish time ("system" falls through);
 * 5. the person's portal preference, else null meaning follow the OS.
 */
export function resolveShellTheme(input: ShellThemeInput): ShellTheme {
  const { entry, version, user } = input;
  if (user.rail_pref === "light" || user.rail_pref === "dark") return { theme: user.rail_pref, source: "rail_preference", locked: true };
  if (entry.theme === "light" || entry.theme === "dark") return { theme: entry.theme, source: "declared", locked: true };
  if (entry.theme !== "system") {
    const detected = version?.detected_theme ?? null;
    if (detected === "light" || detected === "dark") return { theme: detected, source: "detected", locked: false };
  }
  return fromPreference(user);
}

/** The portal follows the person: their preference, or null to follow the OS. */
export function resolvePortalTheme(user: { theme_pref: ThemeSetting }): Scheme | null {
  return user.theme_pref === "light" || user.theme_pref === "dark" ? user.theme_pref : null;
}
