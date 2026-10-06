import { Hono, type Context } from "hono";
import { entryIdFromHost, isPortalHost } from "./config.js";
import type { Env, Services } from "./context.js";
import { KitlaneError } from "./errors.js";
import { portalApp } from "./routes/portal/index.js";
import { toolApp } from "./routes/tool.js";
import { errorPage } from "./views/pages.js";
import { getEntry } from "./services/entries.js";

export function errorHandler(config: Services["config"]) {
  return (err: Error, c: Context) => {
    const wantsJson = c.req.path.startsWith("/.api/") || c.req.path.startsWith("/._kitlane/") || (c.req.header("accept") ?? "").includes("application/json");
    if (err instanceof KitlaneError) {
      if (wantsJson) return c.json(err.toJSON(), err.status as 400);
      return c.html(errorPage(config, err.status, err.message), err.status as 400);
    }
    console.error("[kitlane] unhandled error", err);
    if (wantsJson) return c.json({ error: "internal", message: "Internal error" }, 500);
    return c.html(errorPage(config, 500, "Something went wrong"), 500);
  };
}

export function createApp(services: Services) {
  const { config } = services;
  const app = new Hono<Env>();
  const portal = portalApp(services);
  const tool = toolApp(services);
  const onError = errorHandler(config);
  app.onError(onError);
  portal.onError(onError);
  tool.onError(onError);

  app.get("/healthz", (c) => c.json({ ok: true, authMode: config.authMode }));

  // Used by the TLS ingress for on-demand certificates. Host-independent and unauthenticated:
  // it only answers whether a domain is this installation's portal or a registered tool host.
  app.get("/.well-known/kitlane/host-check", async (c) => {
    const domain = (c.req.query("domain") ?? "").toLowerCase();
    if (domain === config.portalUrl.hostname) return c.text("ok");
    const suffix = `.${config.toolsDomain.split(":")[0]}`;
    if (domain.endsWith(suffix)) {
      const m = /^app-([a-z0-9]{6,32})$/.exec(domain.slice(0, -suffix.length));
      if (m && (await getEntry(services.db, m[1]))) return c.text("ok");
    }
    return c.text("unknown host", 404);
  });

  // Host-based dispatch: the portal origin and each tool origin are different applications.
  app.all("*", async (c) => {
    const host = new URL(c.req.url).host.toLowerCase();
    if (isPortalHost(config, host)) return portal.fetch(c.req.raw, c.env);
    const entryId = entryIdFromHost(config, host);
    if (entryId) return tool.fetch(c.req.raw, c.env);
    return c.text(`Unknown host. The portal is at ${config.portalUrl.origin}`, 404);
  });

  return app;
}
