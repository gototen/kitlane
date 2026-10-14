// Headless-Chrome screenshots of a Kitlane server through the DevTools protocol, for the README images.
// Usage: node scripts/screenshot.mjs <out.jpg> <url> [--width 1400] [--height 868] [--scheme light|dark] [--open-drawer] [--wait ms] [--cookie name=value]
// CHROME=/path/to/chrome overrides the binary. Get a session cookie from the dev login form (see CONTRIBUTING.md).
import { spawn } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const out = args[0];
const url = args[1];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const width = Number(opt("--width", "1400"));
const height = Number(opt("--height", "868"));
const scheme = opt("--scheme", null);
const openDrawer = args.includes("--open-drawer");
const settle = Number(opt("--wait", "2500"));
const cookie = opt("--cookie", null);
const port = 9333 + Math.floor(Math.random() * 100);
const profile = `/tmp/kl-shot-profile-${port}`;

const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 50; i++) {
  try {
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
    break;
  } catch {
    await sleep(200);
  }
}
if (!version) throw new Error("Chrome did not start");
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
if (scheme) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
if (cookie) {
  const [name, ...rest] = cookie.split("=");
  await send("Network.enable");
  await send("Network.setCookie", { name, value: rest.join("="), url: new URL(url).origin, path: "/" });
}
await send("Page.navigate", { url });
// Auth round trips may navigate the top frame a few times; wait until it stays put.
let lastLoad = Date.now();
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  await sleep(250);
  if (events.some((e) => e.method === "Page.loadEventFired")) {
    events.length = 0;
    lastLoad = Date.now();
  }
  if (Date.now() - lastLoad > settle) break;
}
if (openDrawer) {
  await send("Runtime.evaluate", { expression: "document.getElementById('kl-rail-handle')?.click(); 'ok'" });
  await sleep(1200);
}
const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
const info = await send("Runtime.evaluate", { expression: "JSON.stringify({ title: document.title, theme: document.documentElement.dataset.theme || null, url: location.href })", returnByValue: true });
console.log(out, info.result.value);
ws.close();
chrome.kill("SIGTERM");
await sleep(600);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chrome still flushing; a stale profile in /tmp is harmless */ }
process.exit(0);
