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
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).split("<").join("\\u003c").split("\u2028").join("\\u2028").split("\u2029").join("\\u2029");
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ config, title, user, wide, bodyClass, head, children }) => (
  <html lang="en">
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
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true">k</span>
          <span>Kitlane</span>
          <span class="brand-shortcut">{config.shortcut}/</span>
        </a>
        <form class="topbar-search" action="/.search" method="get" role="search">
          <input type="search" name="q" placeholder="Search tools, people, tags" aria-label="Search all tools" />
        </form>
        <nav class="topbar-nav" aria-label="Primary">
          <a href="/.new">Publish</a>
          {user ? <a href="/.me">My tools</a> : null}
          {user?.is_admin ? <a href="/.admin">Admin</a> : null}
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
        </nav>
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
      </footer>
      <script src="/.static/portal.js" defer></script>
    </body>
  </html>
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

export function formatBytes(n: number | string): string {
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}
