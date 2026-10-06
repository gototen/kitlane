import { raw } from "hono/html";
import type { Config } from "../config.js";
import { portalOrigin } from "../config.js";
import type { Entry, User } from "../types.js";
import { Layout, safeJson } from "./layout.js";

export function errorPage(config: Config, status: number, message: string) {
  return (
    <Layout config={config} title={`Error ${status}`}>
      <section class="card narrow">
        <h1>{status === 404 ? "Not found" : status === 403 ? "Not allowed" : status === 401 ? "Sign in required" : "Something went wrong"}</h1>
        <p>{message}</p>
        <p>
          <a href="/">Back to the portal</a>
        </p>
      </section>
    </Layout>
  );
}

/**
 * Served on a tool origin to an unauthenticated iframe. It never performs a login inside the frame.
 * It asks the shell (parent) to run the top-level sign-in round trip and offers a direct link.
 */
export function bootstrapAuthPage(config: Config, entry: Entry, startUrl: string, note?: string) {
  const payload = safeJson({ type: "kitlane:needs-auth", tool: entry.id, start: startUrl });
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>Sign in · {entry.title}</title>
        <style>{raw(`body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#1b1f24}@media(prefers-color-scheme:dark){body{background:#101317;color:#e6e8eb}}.box{max-width:28rem;padding:1.5rem;text-align:center}a.btn{display:inline-block;margin-top:.75rem;padding:.6rem 1rem;border-radius:.5rem;background:#2457d6;color:#fff;text-decoration:none}`)}</style>
      </head>
      <body>
        <div class="box">
          <p>{note ?? `Signing you in to ${entry.title}…`}</p>
          <a class="btn" href={startUrl} target="_top" rel="noopener">
            Continue to sign in
          </a>
        </div>
        <script>{raw(`(function(){try{if(window.parent&&window.parent!==window){window.parent.postMessage(${payload},${safeJson(portalOrigin(config))});}}catch(e){}})();`)}</script>
      </body>
    </html>
  );
}

export function frozenPage(config: Config, entry: Entry, message?: string) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{entry.title} · unavailable</title>
        <style>{raw(`body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#1b1f24}@media(prefers-color-scheme:dark){body{background:#101317;color:#e6e8eb}}.box{max-width:28rem;padding:1.5rem;text-align:center}`)}</style>
      </head>
      <body>
        <div class="box">
          <h1>{entry.title} is unavailable</h1>
          <p>{message ?? (entry.frozen ? "An administrator has frozen this tool." : "This tool cannot be served right now.")}</p>
          <p>
            <a href={`${portalOrigin(config)}/.tool/${entry.id}`} target="_top">
              View details in the portal
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}

export function devLoginPage(config: Config, users: User[], returnTo: string, message?: string) {
  return (
    <Layout config={config} title="Development sign-in">
      <section class="card narrow">
        <h1>Development identity</h1>
        <p class="muted">
          This installation runs in <strong>development mode</strong>. Pick a synthetic user. Real deployments authenticate through the trusted gateway instead and this page does not exist.
        </p>
        {message ? <p class="notice">{message}</p> : null}
        <form method="post" action="/.dev/login" class="stack">
          <input type="hidden" name="rd" value={returnTo} />
          {users.map((u) => (
            <button class="user-choice" type="submit" name="user" value={u.id}>
              <span class="user-name">{u.display_name}</span>
              <span class="muted">
                {u.team ?? "no team"} · {u.email ?? u.external_id}
                {u.is_admin ? " · admin" : ""}
              </span>
            </button>
          ))}
        </form>
        <details>
          <summary>Create another synthetic user</summary>
          <form method="post" action="/.dev/login" class="stack">
            <input type="hidden" name="rd" value={returnTo} />
            <label>
              Display name <input name="new_name" required maxlength={80} />
            </label>
            <label>
              Team <input name="new_team" maxlength={80} placeholder="e.g. finance" />
            </label>
            <label>
              <input type="checkbox" name="new_admin" value="1" /> Administrator
            </label>
            <button type="submit">Sign in as new user</button>
          </form>
        </details>
      </section>
    </Layout>
  );
}
