import { raw } from "hono/html";
import type { Config } from "../config.js";
import { portalOrigin, toolOrigin } from "../config.js";
import type { EntryWithNames } from "../types.js";
import { Mark, safeJson } from "./layout.js";

export interface ShellData {
  entry: EntryWithNames;
  iframeSrc: string;
  directUrl: string;
  maintainers: string[];
  replacement: EntryWithNames | null;
  userName: string;
  /** Resolved shell theme: the tool's declared or detected scheme, else the person's preference, else null (follow the OS). */
  theme: "light" | "dark" | null;
  themeSource: string;
  /** When true the runtime report from the tool must not override the theme (a forced rail preference or a declared theme). */
  themeLocked: boolean;
}

/**
 * The shell: a cross-origin iframe for the hosted tool plus the persistent "Explore tools" rail.
 * The rail belongs to the shell; the tool's HTML is never rewritten. The rail matches the tool's
 * theme so it reads as part of the tool's window rather than as a frame around it.
 */
export function shellPage(config: Config, d: ShellData) {
  const { entry } = d;
  const cfg = {
    tool: { id: entry.id, title: entry.title, name: entry.names[0], lifecycle: entry.lifecycle },
    portalOrigin: portalOrigin(config),
    toolOrigin: toolOrigin(config, entry.id),
    iframeSrc: d.iframeSrc,
    authStart: `${portalOrigin(config)}/.auth/start?tool=${entry.id}&rd=`,
    directUrl: d.directUrl,
    drawerUrl: `/.api/shell/${entry.id}/drawer`,
    discoveryUrl: `/.api/discovery`,
    shortcut: config.shortcut,
    theme: d.theme,
    themeLocked: d.themeLocked,
  };
  return (
    <html lang="en" class="kl-shell-root" data-theme={d.theme ?? undefined} data-theme-source={d.themeSource}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{entry.title}</title>
        <link rel="stylesheet" href="/.static/kitlane.css" />
        <link rel="icon" href="/.static/favicon.svg" type="image/svg+xml" />
        <script type="application/json" id="kl-shell-config">
          {raw(safeJson(cfg))}
        </script>
      </head>
      <body class="kl-shell">
        <div class="kl-frame-wrap" id="kl-frame-wrap">
          {entry.lifecycle === "retired" ? (
            <div class="kl-banner" role="status">
              This tool is retired.{" "}
              {d.replacement ? (
                <a href={`/${d.replacement.names[0]}`}>Use {d.replacement.title} instead</a>
              ) : (
                <a href={`/.tool/${entry.id}`}>Details</a>
              )}
            </div>
          ) : null}
          <iframe
            id="kl-tool-frame"
            class="kl-tool-frame"
            title={entry.title}
            src={d.iframeSrc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            allow="clipboard-write; fullscreen"
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
          <div class="kl-auth-fallback" id="kl-auth-fallback" hidden>
            <div class="kl-auth-card">
              <p>
                <strong>{entry.title}</strong> needs to sign you in on its own origin.
              </p>
              <a class="button primary" id="kl-auth-button" href={`${cfg.authStart}`}>
                Sign in to open this tool
              </a>
              <p class="muted small">Each tool runs on its own origin for isolation, so the first launch takes one sign-in round trip.</p>
            </div>
          </div>
        </div>
        <button
          id="kl-rail-handle"
          class="kl-rail-handle"
          type="button"
          aria-controls="kl-drawer"
          aria-expanded="false"
          aria-label="Explore tools: see what else your colleagues have made"
        >
          <Mark size={20} />
          <span class="kl-rail-label">Explore tools</span>
        </button>
        <aside id="kl-drawer" class="kl-drawer" aria-label="Explore tools" aria-hidden="true" hidden>
          <div class="kl-drawer-head">
            <span class="kl-drawer-brand">Explore tools</span>
            <button id="kl-drawer-close" class="kl-drawer-close" type="button" aria-label="Close explore tools">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18"></path>
              </svg>
            </button>
          </div>
          <div id="kl-drawer-body" class="kl-drawer-body" aria-live="polite">
            <p class="muted">Loading…</p>
          </div>
        </aside>
        <script src="/.static/shell.js" defer></script>
      </body>
    </html>
  );
}
