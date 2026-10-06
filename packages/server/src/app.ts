import { Hono, type Context } from "hono";
import { entryIdFromHost, isPortalHost } from "./config.js";
import type { Env, Services } from "./context.js";
import { KitlaneError } from "./errors.js";
import { portalApp } from "./routes/portal/index.js";
import { toolApp } from "./routes/tool.js";
import { errorPage } from "./views/pages.js";

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
