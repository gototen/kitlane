/* Shell client: the Explore tools rail, drawer, auth bootstrap, and discovery events. */
interface ShellConfig {
  tool: { id: string; title: string; name: string; lifecycle: string };
  portalOrigin: string;
  toolOrigin: string;
  iframeSrc: string;
  authStart: string;
  directUrl: string;
  drawerUrl: string;
  discoveryUrl: string;
  shortcut: string;
}

(() => {
  const cfgEl = document.getElementById("kl-shell-config");
  if (!cfgEl) return;
  const cfg: ShellConfig = JSON.parse(cfgEl.textContent || "{}");
  const frame = document.getElementById("kl-tool-frame") as HTMLIFrameElement | null;
  const handle = document.getElementById("kl-rail-handle") as HTMLButtonElement | null;
  const drawer = document.getElementById("kl-drawer") as HTMLElement | null;
  const body = document.getElementById("kl-drawer-body") as HTMLElement | null;
  const closeBtn = document.getElementById("kl-drawer-close") as HTMLButtonElement | null;
  const authFallback = document.getElementById("kl-auth-fallback") as HTMLElement | null;
  const authButton = document.getElementById("kl-auth-button") as HTMLAnchorElement | null;
  if (!frame || !handle || !drawer || !body || !closeBtn) return;

  const send = (type: string, extra: Record<string, unknown> = {}) => {
    const payload = JSON.stringify({ type, sourceEntryId: cfg.tool.id, ...extra });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(cfg.discoveryUrl, new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch {
      // fall through
    }
    fetch(cfg.discoveryUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
  };

  // --- Auth bootstrap: the tool origin asks us (its parent) to run the top-level round trip. ---
  const attemptsKey = `kl-auth-attempts:${cfg.tool.id}`;
  const returnUrl = () => {
    const u = new URL(location.href);
    u.searchParams.delete("_klauth");
    return u.toString();
  };
  authButton && (authButton.href = cfg.authStart + encodeURIComponent(returnUrl()));
  window.addEventListener("message", (ev) => {
    if (ev.origin !== cfg.toolOrigin) return;
    if (ev.source !== frame.contentWindow) return;
    const data = ev.data || {};
    if (data.type === "kitlane:needs-auth") {
      let attempts = 0;
      try {
        attempts = Number(sessionStorage.getItem(attemptsKey) || "0");
      } catch {
        // ignore
      }
      if (attempts < 2) {
        try {
          sessionStorage.setItem(attemptsKey, String(attempts + 1));
        } catch {
          // ignore
        }
        location.assign(cfg.authStart + encodeURIComponent(returnUrl()));
      } else if (authFallback) {
        authFallback.hidden = false;
      }
    } else if (data.type === "kitlane:title" && typeof data.title === "string") {
      document.title = `${data.title.slice(0, 200)} · ${cfg.tool.title}`;
      try {
        sessionStorage.removeItem(attemptsKey);
      } catch {
        // ignore
      }
    }
  });
  frame.addEventListener("load", () => {
    // A successful load of the tool means auth worked; reset the loop guard lazily on next message.
  });

  // --- Drawer ---
  let open = false;
  let loaded = false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function loadDrawer() {
    if (loaded) return;
    try {
      const res = await fetch(cfg.drawerUrl, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!res.ok) throw new Error(String(res.status));
      body.innerHTML = await res.text();
      loaded = true;
      body.querySelectorAll<HTMLAnchorElement>("a[data-kl-target]").forEach((a) => {
        a.addEventListener("click", () => {
          send("recommendation_launched", { targetEntryId: a.dataset.klTarget, placement: Number(a.dataset.klPlacement || 0), reason: a.dataset.klReason });
        });
        a.addEventListener("auxclick", () => {
          send("recommendation_launched", { targetEntryId: a.dataset.klTarget, placement: Number(a.dataset.klPlacement || 0), reason: a.dataset.klReason });
        });
      });
      const direct = body.querySelector<HTMLAnchorElement>("a[data-kl-direct]");
      if (direct) direct.href = cfg.directUrl;
    } catch {
      body.innerHTML = `<p class="muted">Could not load recommendations. <a href="${cfg.portalOrigin}/.search" target="_top">Search all tools</a></p>`;
    }
  }

  function setOpen(next: boolean) {
    open = next;
    document.body.classList.toggle("kl-drawer-open", open);
    handle.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
    if (open) {
      drawer.hidden = false;
      void loadDrawer();
      send("drawer_opened");
      const first = drawer.querySelector<HTMLElement>("a, button");
      (reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, 30))).then(() => (closeBtn || first)?.focus());
    } else {
      const finish = () => {
        if (!open) drawer.hidden = true;
      };
      reduceMotion ? finish() : setTimeout(finish, 220);
      handle.focus();
    }
  }

  handle.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  });
  // Clicking the dimmed tool area on narrow screens closes the overlay drawer.
  document.getElementById("kl-frame-wrap")?.addEventListener("click", () => {
    if (open && window.matchMedia("(max-width: 900px)").matches) setOpen(false);
  });

  // Opportunity: the rail is visible in this eligible shell session.
  send("rail_rendered");
})();
