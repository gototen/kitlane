/**
 * Meeting time finder.
 *
 * This source is intentionally readable; what gets published is only the minified bundle in
 * dist/. The example exists to validate that an agent or builder can adapt a Kitlane tool from
 * its published files alone (spec section 4.7).
 */
import { h, render, Fragment } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

const CITIES = [
  ["Auckland", "Pacific/Auckland"],
  ["Sydney", "Australia/Sydney"],
  ["Tokyo", "Asia/Tokyo"],
  ["Seoul", "Asia/Seoul"],
  ["Shanghai", "Asia/Shanghai"],
  ["Singapore", "Asia/Singapore"],
  ["Jakarta", "Asia/Jakarta"],
  ["Bangalore", "Asia/Kolkata"],
  ["Mumbai", "Asia/Kolkata"],
  ["Karachi", "Asia/Karachi"],
  ["Dubai", "Asia/Dubai"],
  ["Tel Aviv", "Asia/Jerusalem"],
  ["Nairobi", "Africa/Nairobi"],
  ["Cairo", "Africa/Cairo"],
  ["Johannesburg", "Africa/Johannesburg"],
  ["Lagos", "Africa/Lagos"],
  ["Helsinki", "Europe/Helsinki"],
  ["Warsaw", "Europe/Warsaw"],
  ["Berlin", "Europe/Berlin"],
  ["Paris", "Europe/Paris"],
  ["Amsterdam", "Europe/Amsterdam"],
  ["Madrid", "Europe/Madrid"],
  ["London", "Europe/London"],
  ["Lisbon", "Europe/Lisbon"],
  ["Reykjavik", "Atlantic/Reykjavik"],
  ["São Paulo", "America/Sao_Paulo"],
  ["Buenos Aires", "America/Argentina/Buenos_Aires"],
  ["New York", "America/New_York"],
  ["Toronto", "America/Toronto"],
  ["Mexico City", "America/Mexico_City"],
  ["Chicago", "America/Chicago"],
  ["Denver", "America/Denver"],
  ["Los Angeles", "America/Los_Angeles"],
  ["Vancouver", "America/Vancouver"],
  ["Honolulu", "Pacific/Honolulu"],
];

const MIN_CITIES = 2;
const MAX_CITIES = 6;
const DEFAULT_ZONES = ["America/New_York", "Europe/London", "Asia/Tokyo"];

function cityName(zone) {
  const found = CITIES.find(([, z]) => z === zone);
  return found ? found[0] : zone;
}

/** Local hour (0-23) and minute for an instant in a zone, using Intl only. */
function localParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: Number(get("hour")), minute: get("minute"), weekday: get("weekday") };
}

function classify(hour) {
  if (hour >= 8 && hour < 18) return "good";
  if (hour >= 7 && hour < 20) return "ok";
  return "bad";
}

function rowQuality(hours) {
  const classes = hours.map(classify);
  if (classes.every((c) => c === "good")) return "good";
  if (classes.every((c) => c !== "bad")) return "ok";
  return "bad";
}

function explain(err) {
  if (!err || !err.code) return String((err && err.message) || err);
  switch (err.code) {
    case "unauthenticated":
      return "Your session on this tool has expired. Reload the page to sign in again.";
    case "frozen":
      return "This tool has been frozen by an administrator. Saving is blocked.";
    case "quota_exceeded":
      return "Your personal storage for this tool is full.";
    default:
      return err.message || err.code;
  }
}

function App() {
  const [me, setMe] = useState(null);
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [saved, setSaved] = useState(DEFAULT_ZONES);
  const [revision, setRevision] = useState(0);
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const cities = window.kitlane.user.collection("cities");

  useEffect(() => {
    window.kitlane
      .me()
      .then(setMe)
      .catch((err) => setNotice({ error: true, text: explain(err) }));
    cities
      .get("default")
      .then((doc) => {
        if (doc && Array.isArray(doc.data.zones) && doc.data.zones.length >= MIN_CITIES) {
          setZones(doc.data.zones);
          setSaved(doc.data.zones);
          setRevision(doc.revision);
        }
      })
      .catch((err) => setNotice({ error: true, text: explain(err) }));
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // The grid starts at the top of the current hour in the first chosen city and covers 24 hours.
  const rows = useMemo(() => {
    const base = new Date(now);
    base.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, i) => {
      const instant = new Date(base.getTime() + i * 3600_000);
      const cells = zones.map((zone) => ({ zone, ...localParts(instant, zone) }));
      return { instant, cells, quality: rowQuality(cells.map((c) => c.hour)), isNow: i === 0 };
    });
  }, [zones, now]);

  const goodCount = rows.filter((r) => r.quality === "good").length;
  const dirty = JSON.stringify(zones) !== JSON.stringify(saved);

  function addCity() {
    if (!pick || zones.includes(pick) || zones.length >= MAX_CITIES) return;
    setZones([...zones, pick]);
    setPick("");
  }

  function removeCity(zone) {
    if (zones.length <= MIN_CITIES) return;
    setZones(zones.filter((z) => z !== zone));
  }

  function save() {
    setNotice({ text: "Saving…" });
    cities
      .set("default", { zones }, { ifRevision: revision })
      .then((doc) => {
        setSaved(doc.data.zones);
        setRevision(doc.revision);
        setNotice({ text: "Saved as your default cities." });
      })
      .catch((err) => {
        if (err.code === "conflict" && err.current) {
          setZones(err.current.data.zones);
          setSaved(err.current.data.zones);
          setRevision(err.current.revision);
          setNotice({ error: true, text: "Your cities changed on another device; reloaded them." });
          return;
        }
        setNotice({ error: true, text: explain(err) });
      });
  }

  return (
    <Fragment>
      <header>
        <h1>Meeting time finder</h1>
        <span class="muted small">{me ? `${me.displayName}${me.team ? " · " + me.team : ""}` : "Signing in…"}</span>
      </header>
      <main>
        {notice ? (
          <p class={"notice" + (notice.error ? " error" : "")} role="status">
            {notice.text}
          </p>
        ) : null}
        <section class="card" aria-labelledby="cities-heading">
          <h2 id="cities-heading" style="margin-top:0;font-size:1rem">
            Cities ({zones.length}/{MAX_CITIES})
          </h2>
          <div class="picker">
            <label>
              <span class="muted small">Add a city </span>
              <select value={pick} onChange={(e) => setPick(e.currentTarget.value)} aria-label="City to add">
                <option value="">Choose…</option>
                {CITIES.filter(([, z]) => !zones.includes(z)).map(([name, zone]) => (
                  <option key={zone} value={zone}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={addCity} disabled={!pick || zones.length >= MAX_CITIES}>
              Add
            </button>
            <button type="button" class="primary" onClick={save} disabled={!dirty}>
              Save as default
            </button>
          </div>
          <div class="chips">
            {zones.map((zone) => (
              <span class="chip" key={zone}>
                {cityName(zone)}
                <button type="button" onClick={() => removeCity(zone)} disabled={zones.length <= MIN_CITIES} aria-label={`Remove ${cityName(zone)}`} title="Remove">
                  ×
                </button>
              </span>
            ))}
          </div>
          <p class="muted small">
            {goodCount} of the next 24 hours work for everyone (08:00–18:00 local). Your saved cities follow you across devices through Kitlane personal storage.
          </p>
        </section>
        <section class="card grid-wrap" aria-labelledby="grid-heading">
          <h2 id="grid-heading" style="margin-top:0;font-size:1rem">
            Next 24 hours
          </h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Starts in</th>
                {zones.map((zone) => (
                  <th scope="col" key={zone}>
                    {cityName(zone)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr class={row.quality + (row.isNow ? " now" : "")} key={i}>
                  <td>{i === 0 ? "now" : `${i} h`}</td>
                  {row.cells.map((cell) => (
                    <td class={classify(cell.hour) === "bad" ? "off" : ""} key={cell.zone}>
                      {cell.weekday} {String(cell.hour).padStart(2, "0")}:{cell.minute}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p class="legend">
            <span>
              <span class="swatch good" aria-hidden="true"></span>everyone 08:00–18:00
            </span>
            <span>
              <span class="swatch ok" aria-hidden="true"></span>everyone 07:00–20:00
            </span>
            <span class="muted">unshaded: someone is outside working hours</span>
          </p>
        </section>
      </main>
    </Fragment>
  );
}

render(<App />, document.getElementById("app"));
