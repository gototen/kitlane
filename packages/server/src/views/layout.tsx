import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { Config } from "../config.js";
import type { User } from "../types.js";

export interface LayoutProps {
  config: Config;
  title: string;
  user?: User | null;
  wide?: boolean;
  bodyClass?: string;
  head?: unknown;
  /** Which top-level section is current, for the underline in the top bar. */
  nav?: "today" | "browse" | "yours" | "admin";
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).split("<").join("\\u003c").split("\u2028").join("\\u2028").split("\u2029").join("\\u2029");
}

/** The Kitlane mark: three books on a shelf. Colours come from the stylesheet so it follows the theme. */
export const Mark: FC<{ size?: number }> = ({ size = 24 }) => (
  <svg class="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect class="mark-bg" x="1" y="1" width="22" height="22" rx="4"></rect>
    <rect class="mark-fg" x="6" y="6" width="3.2" height="11" rx="0.6"></rect>
    <rect class="mark-fg" x="10.6" y="6" width="3.2" height="11" rx="0.6"></rect>
    <rect class="mark-fg" x="15.4" y="6.4" width="3.2" height="10.6" rx="0.6" opacity="0.9" transform="rotate(-14 17 12)"></rect>
    <rect class="mark-fg" x="5" y="17.8" width="14" height="1.4" rx="0.5" opacity="0.8"></rect>
  </svg>
);

/** Two crossing arrows: the remix icon. Inline so it takes the text colour. */
export const RemixIcon: FC = () => (
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M16 3h5v5"></path>
    <path d="M4 20L21 3"></path>
    <path d="M21 16v5h-5"></path>
    <path d="M15 15l6 6"></path>
    <path d="M4 4l5 5"></path>
  </svg>
);

/** The person's pinned theme for portal pages, or null to follow the OS. */
export function portalThemeOf(user: User | null | undefined): "light" | "dark" | null {
  const pref = (user as { theme_pref?: string } | null | undefined)?.theme_pref;
  return pref === "light" || pref === "dark" ? pref : null;
}

/** Every server-rendered page starts with this so browsers use standards mode, not quirks mode. */
export const DOCTYPE = raw("<!doctype html>");

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ config, title, user, wide, bodyClass, head, nav, children }) => (
  <>
    {DOCTYPE}
    <html lang="en" data-theme={portalThemeOf(user) ?? undefined}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light dark" />
      <title>{title ? `${title} · Kitlane` : "Kitlane"}</title>
      <link rel="stylesheet" href="/.static/kitlane.css" />
      <link rel="icon" href="/.static/favicon.svg" type="image/svg+xml" />
      {head}
    </head>
    <body class={bodyClass ?? ""}>
      <header class="topbar">
        <a class="brand" href="/" aria-label="Kitlane home">
          <Mark size={26} />
          <span>Kitlane</span>
        </a>
        <nav class="topbar-nav" aria-label="Primary">
          <a class={nav === "today" ? "nav on" : "nav"} href="/">
            Today
          </a>
          <a class={nav === "browse" ? "nav on" : "nav"} href="/.search">
            Browse
          </a>
          {user ? (
            <a class={nav === "yours" ? "nav on" : "nav"} href="/.me">
              Yours
            </a>
          ) : null}
          {user?.is_admin ? (
            <a class={nav === "admin" ? "nav on" : "nav"} href="/.admin">
              Admin
            </a>
          ) : null}
        </nav>
        <div class="topbar-right">
          <form class="topbar-search" action="/.search" method="get" role="search">
            <input type="search" name="q" placeholder="Search by what you need" aria-label="Search all tools" />
          </form>
          <a class="btn sm" href="/.new">
            Publish a tool
          </a>
          {user ? (
            <span class="whoami" title={user.email ?? ""}>
              {user.display_name}
              {config.authMode === "dev" ? (
                <form method="post" action="/.dev/logout" class="inline">
                  <button class="link" type="submit">
                    Switch user
                  </button>
                </form>
              ) : null}
            </span>
          ) : null}
        </div>
      </header>
      {config.banner ? (
        <div class="banner" role="note">
          {config.banner}
        </div>
      ) : null}
      <main class={wide ? "main wide" : "main"}>{children}</main>
      <footer class="footer">
        <span>Kitlane reference implementation · Apache-2.0</span>
        {config.authMode === "dev" ? <span class="dev-badge">Development identity: local only</span> : null}
        {config.reportingContact ? (
          <span>
            Report a concern: <a href={config.reportingContact.includes("@") ? `mailto:${config.reportingContact}` : config.reportingContact}>{config.reportingContact}</a>
          </span>
        ) : null}
        {user?.is_admin ? <a href="/.admin/measurement">How discovery is measured</a> : null}
      </footer>
      <script src="/.static/portal.js" defer></script>
    </body>
    </html>
  </>
);

export const JsonScript: FC<{ id: string; value: unknown }> = ({ id, value }) => (
  <script type="application/json" id={id}>
    {raw(safeJson(value))}
  </script>
);

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** "3 days ago", "2 weeks ago": for bylines, where a precise timestamp would be noise. */
export function formatAgo(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.round(h / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export function formatBytes(n: number | string): string {
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
