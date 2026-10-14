import type { FC } from "hono/jsx";
import type { Config } from "../config.js";
import { portalOrigin, toolOrigin } from "../config.js";
import type { AuditEvent } from "../services/audit.js";
import type { BindingInfo, CollectionWithOwner, UpdaterCredential, WriterGrant } from "../services/documents.js";
import type { MeasurementReport } from "../services/discovery.js";
import type { NameHistoryRow, NameRow } from "../services/names.js";
import type { Recommendation } from "../services/search.js";
import type { TodayData } from "../services/today.js";
import type { AccessToken } from "../services/tokens.js";
import type { DeploymentHistoryRow } from "../services/versions.js";
import type { EntryWithNames, SharedCollection, User, Version } from "../types.js";
import { Layout, RemixIcon, formatAgo, formatBytes, formatDate } from "./layout.js";

/* ---------- Small pieces ---------- */

export const Lifecycle: FC<{ entry: EntryWithNames }> = ({ entry }) => (
  <span class={`badge lifecycle-${entry.lifecycle}`} title="Lifecycle describes maintainer intent; it is not a security certification">
    {entry.lifecycle}
  </span>
);

const kindOf = (e: EntryWithNames) => (e.kind === "resource" ? "Link" : e.mode === "external" ? "External tool" : "Hosted tool");
const launchOf = (e: EntryWithNames) => `/${e.names[0] ?? ".tool/" + e.id}`;
const who = (e: EntryWithNames) => (e.creator_team ? `${e.creator_name}, ${e.creator_team}` : e.creator_name);
const themeOf = (e: EntryWithNames): string | null => (e as { theme?: string | null }).theme ?? null;
const prefOf = (u: User, key: "theme_pref" | "rail_pref", fallback: string): string => ((u as unknown as Record<string, string | undefined>)[key] ?? fallback);
const pad = (n: number) => String(n).padStart(2, "0");

const Tags: FC<{ tags: string[] }> = ({ tags }) =>
  tags.length ? (
    <div class="tags">
      {tags.map((t) => (
        <a href={`/.search?tag=${encodeURIComponent(t)}`}>{t}</a>
      ))}
    </div>
  ) : null;

/**
 * One tool in a ruled list: index, title, a reason or purpose, and who made it. Used on Today,
 * in search results, on the person's own page, and in the drawer. The title carries the discovery
 * attributes the shell client reads when a row is launched from the rail.
 */
export const ToolRow: FC<{
  entry: EntryWithNames;
  config: Config;
  index: number;
  reason?: string;
  reasonKey?: string;
  placement?: number;
  source?: string;
  titleHref?: string;
  target?: string;
  action?: "open" | "none";
  quietIndex?: boolean;
}> = ({ entry, config, index, reason, reasonKey, placement, source, titleHref, target, action = "open", quietIndex }) => (
  <div class={`trow ${entry.kind === "resource" ? "resource" : "tool"}`}>
    <span class={quietIndex ? "idx quiet" : "idx"}>{pad(index)}</span>
    <div>
      {reason ? <p class="reason">{reason}</p> : null}
      <a class="t" href={titleHref ?? `/.tool/${entry.id}`} data-kl-target={entry.id} data-kl-placement={placement} data-kl-reason={reasonKey} data-kl-source={source} target={target}>
        {entry.title}
      </a>
      {entry.purpose ? <p class="p">{entry.purpose}</p> : null}
      <div class="by">
        <span class="n">
          {config.shortcut}/{entry.names[0]}
        </span>{" "}
        · {who(entry)}
        {entry.kind === "resource" ? " · link" : entry.mode === "external" ? " · external tool" : ""}
        {entry.lifecycle !== "experimental" ? (
          <>
            {" · "}
            <Lifecycle entry={entry} />
          </>
        ) : null}
        {entry.frozen ? <span class="badge frozen"> · frozen</span> : null}
      </div>
    </div>
    {action === "open" ? (
      <div class="actions">
        {entry.frozen ? (
          <span class="by">frozen</span>
        ) : (
          <a class="tlink" href={launchOf(entry)} data-kl-target={entry.id} data-kl-placement={placement} data-kl-reason={reasonKey} data-kl-source={source} target={target}>
            {entry.kind === "resource" ? "Go" : "Open"}
          </a>
        )}
      </div>
    ) : null}
  </div>
);

const Flash: FC<{ flash?: string | null; error?: string | null }> = ({ flash, error }) => (
  <>
    {flash ? (
      <p class="notice" role="status">
        {flash}
      </p>
    ) : null}
    {error ? (
      <p class="error" role="alert">
        {error}
      </p>
    ) : null}
  </>
);

/* ---------- Today ---------- */

function dateline(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function countsLine(t: TodayData): string {
  const { newTools, newRemixes, days } = t.counts;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (!newTools && !newRemixes) return t.totalTools ? `Nothing new in the last ${days} days. Here is what is on the shelf.` : "Nothing on the shelf yet.";
  if (newTools && newRemixes) return `${n(newTools, "new tool", "new tools")} and ${n(newRemixes, "remix", "remixes")} in the last ${days} days.`;
  return newTools ? `${n(newTools, "new tool", "new tools")} in the last ${days} days.` : `${n(newRemixes, "new remix", "new remixes")} in the last ${days} days.`;
}

export function homePage(config: Config, user: User, today: TodayData, canPublish: boolean) {
  const [lead, ...rest] = today.stories;
  const remixable = today.stories.find((s) => s.entry.mode === "hosted" && !s.entry.frozen)?.entry ?? null;
  return (
    <Layout config={config} title="" user={user} nav="today">
      <section class="masthead">
        <div>
          <p class="dateline">{dateline(today.date)}</p>
          <h1>Today</h1>
        </div>
        <p class="deck">
          {countsLine(today)} {canPublish ? "Anyone signed in can put something on the shelf." : "Publishing is limited to invited accounts on this installation."}
        </p>
      </section>

      {lead ? (
        <div class="g">
          <div class="c8">
            <article class="lead">
              <span class="idx">01 · {lead.label}</span>
              <h2>
                <a href={`/.tool/${lead.entry.id}`}>{lead.entry.title}</a>
              </h2>
              {lead.deck ? <p class="deck">{lead.deck}</p> : null}
              <div class="lead-actions">
                <a class="btn primary" href={launchOf(lead.entry)}>
                  Open {lead.entry.title}
                </a>
                <span class="by">{lead.byline}</span>
              </div>
              <Tags tags={lead.entry.tags} />
            </article>
          </div>
          <div class="c4">
            <div class="stories">
              {rest.map((s, i) => (
                <article class="story">
                  <span class="idx">
                    {pad(i + 2)} · {s.label}
                  </span>
                  <h3>
                    <a href={`/.tool/${s.entry.id}`}>{s.entry.title}</a>
                  </h3>
                  {s.deck ? <p class="deck">{s.deck}</p> : null}
                  <div class="story-foot">
                    <a class="tlink" href={launchOf(s.entry)}>
                      Open
                    </a>
                    <span class="by">{s.byline}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p class="empty">
          Nothing on the shelf yet. {canPublish ? <a href="/.new">Publish the first tool</a> : "Publishing is limited to invited accounts."}
        </p>
      )}

      <div class="g section">
        <div class="c7">
          {today.collection ? (
            <>
              <div class="sect">
                <h2>Tagged {today.collection.tag}</h2>
                <a class="tlink" href={`/.search?tag=${encodeURIComponent(today.collection.tag)}`}>
                  All {today.collection.tag}
                </a>
              </div>
              <div class="rows">
                {today.collection.entries.map((e, i) => (
                  <ToolRow entry={e} config={config} index={i + 1} />
                ))}
              </div>
            </>
          ) : (
            <>
              <div class="sect">
                <h2>On the shelf</h2>
                <a class="tlink" href="/.search">
                  Browse
                </a>
              </div>
              <p class="empty">Once two tools share a tag, they appear here as a set.</p>
            </>
          )}
        </div>
        <div class="c5">
          <div class="sect">
            <h2>Yours</h2>
            <a class="tlink" href="/.me">
              Manage
            </a>
          </div>
          <div class="rows">
            {today.mine.map((e, i) => (
              <ToolRow entry={e} config={config} index={i + 1} />
            ))}
            <div class="trow">
              <span class="idx quiet">{pad(today.mine.length + 1)}</span>
              <div>
                <a class="t" href="/.new">
                  Publish something
                </a>
                <p class="p">{canPublish ? "A folder of files from the command line, or a link you already use." : "Publishing is limited to invited accounts here. Ask the operator for access."}</p>
                {canPublish ? (
                  <div class="by">
                    <span class="n">kitlane publish ./dist --name yours</span>
                  </div>
                ) : null}
              </div>
              <span></span>
            </div>
          </div>
        </div>
      </div>

      <section class="note-band">
        <h2>Remix anything on the shelf</h2>
        <div class="note-body">
          <p class="prose">
            Open a tool and press Remix. The published files land under your own name, and you change them with whatever you like: an agent, a builder, or a text editor. When you publish, the original maker stays credited on your tool page, and your remix shows up beside theirs.
          </p>
          <p class="prose">
            Nothing personal is copied. Notes, preferences and anything else people kept inside the original stay with them.{" "}
            {remixable && canPublish ? (
              <a class="tlink" href={`/.tool/${remixable.id}/copy`}>
                Try it on {remixable.title}
              </a>
            ) : null}
          </p>
        </div>
      </section>

      {today.links.length ? (
        <section class="section">
          <div class="sect">
            <h2>Everyday links</h2>
            <a class="tlink" href="/.search?kind=resource">
              All links
            </a>
          </div>
          <div class="rows">
            {today.links.map((e, i) => (
              <ToolRow entry={e} config={config} index={i + 1} quietIndex />
            ))}
          </div>
        </section>
      ) : null}
    </Layout>
  );
}

/* ---------- Browse and search ---------- */

export function searchPage(config: Config, user: User, params: { q: string; tag?: string | null; creator?: string | null; kind?: string | null; includeRetired?: boolean }, results: EntryWithNames[], creator: User | null, canClaim: boolean) {
  const heading = params.q ? `Results for “${params.q}”` : params.tag ? `Tagged ${params.tag}` : creator ? `Made by ${creator.display_name}` : params.kind === "resource" ? "Everyday links" : "Every tool";
  return (
    <Layout config={config} title={params.q ? `Search: ${params.q}` : "Browse"} user={user} nav="browse">
      <section>
        <h1 style="font-size:2.6rem;margin-bottom:1rem">{heading}</h1>
        <form action="/.search" method="get" class="filters" role="search">
          <input type="search" name="q" value={params.q} placeholder="Search by name, purpose, tag, or person" aria-label="Search all tools" />
          <select name="kind" aria-label="Kind">
            <option value="" selected={!params.kind}>
              Tools and links
            </option>
            <option value="tool" selected={params.kind === "tool"}>
              Tools only
            </option>
            <option value="resource" selected={params.kind === "resource"}>
              Links only
            </option>
          </select>
          {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
          {params.creator ? <input type="hidden" name="creator" value={params.creator} /> : null}
          <label class="inline">
            <input type="checkbox" name="retired" value="1" checked={params.includeRetired} /> include retired
          </label>
          <button type="submit">Search</button>
        </form>
        {params.tag || creator ? (
          <div class="active-filters">
            {params.tag ? (
              <span class="chip">
                tag: {params.tag}
                <a href={`/.search?q=${encodeURIComponent(params.q)}`} aria-label="Remove tag filter">
                  remove
                </a>
              </span>
            ) : null}
            {creator ? (
              <span class="chip">
                by {creator.display_name}
                <a href={`/.search?q=${encodeURIComponent(params.q)}`} aria-label="Remove creator filter">
                  remove
                </a>
              </span>
            ) : null}
          </div>
        ) : null}
        {canClaim ? (
          <div class="notice">
            <strong>
              {config.shortcut}/{params.q}
            </strong>{" "}
            is not in use. <a href={`/.new?name=${encodeURIComponent(params.q)}`}>Claim this name</a> for a tool or link.
          </div>
        ) : null}
        <div class="rows">
          {results.map((e, i) => (
            <ToolRow entry={e} config={config} index={i + 1} />
          ))}
        </div>
        {!results.length ? <p class="empty">No matching tools.</p> : null}
      </section>
    </Layout>
  );
}

/* ---------- Publish ---------- */

export function newEntryPage(config: Config, user: User, prefill: { name?: string; error?: string; canPublish?: boolean }) {
  if (prefill.canPublish === false) {
    return (
      <Layout config={config} title="Publish a tool or link" user={user}>
        <section class="card narrow">
          <h2>Publishing is limited on this installation</h2>
          <p class="prose">You can open, search, and use every tool here, but publishing, remixing, and claiming names are limited to invited accounts.</p>
          {config.reportingContact ? (
            <p class="prose">
              To get publishing access, contact <a href={config.reportingContact.includes("@") ? `mailto:${config.reportingContact}` : config.reportingContact}>{config.reportingContact}</a>.
            </p>
          ) : null}
          <p class="prose">To run Kitlane for your own team, where everyone can publish, see the installation guide in the project repository.</p>
        </section>
      </Layout>
    );
  }
  return (
    <Layout config={config} title="Publish a tool or link" user={user}>
      <h1 style="margin-bottom:.4rem">Publish</h1>
      <p class="deck" style="margin-bottom:1.5rem">Give something a memorable address. A hosted tool is a folder of static files; a link is an address that already exists.</p>
      {prefill.error ? <p class="error">{prefill.error}</p> : null}
      <div class="two-col">
        <form method="post" action="/.new" class="card stack" style="margin:0">
          <h2>Claim a name for a hosted tool</h2>
          <p class="panel-note">Hosted tools are static files (HTML, JavaScript, CSS, images). Claim the name here, then publish from your working folder with the command line:</p>
          <pre>
            <code>{`npx kitlane login ${portalOrigin(config)}\nnpx kitlane publish ./dist --name <name>`}</code>
          </pre>
          <input type="hidden" name="mode" value="hosted" />
          <label>
            Name ({config.shortcut}/…)
            <input name="name" required value={prefill.name ?? ""} pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
          </label>
          <label>
            Title <input name="title" required maxlength={120} />
          </label>
          <label>
            One-sentence purpose <input name="purpose" maxlength={280} />
          </label>
          <label>
            Tags (comma separated, 2 or 3) <input name="tags" placeholder="finance, meetings" />
          </label>
          <div>
            <button type="submit" class="primary">
              Claim name
            </button>
          </div>
        </form>
        <form method="post" action="/.new" class="card stack" style="margin:0">
          <h2>Register a link</h2>
          <p class="panel-note">A tool or document that already lives somewhere else. It gets a catalog entry and a memorable name, and launches at its own address.</p>
          <input type="hidden" name="mode" value="external" />
          <label>
            Name ({config.shortcut}/…)
            <input name="name" required value={prefill.name ?? ""} pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
          </label>
          <label>
            Title <input name="title" required maxlength={120} />
          </label>
          <label>
            Destination <input name="externalUrl" type="url" required placeholder="https://…" />
          </label>
          <label>
            One-sentence purpose <input name="purpose" maxlength={280} />
          </label>
          <label>
            Tags <input name="tags" placeholder="meetings, research" />
          </label>
          <label>
            Kind
            <select name="kind">
              <option value="tool">Tool (shows up in the rail)</option>
              <option value="resource">Link or document (searchable only)</option>
            </select>
          </label>
          <div>
            <button type="submit">Register</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

/* ---------- Yours ---------- */

export function mePage(config: Config, user: User, mine: EntryWithNames[], tokens: AccessToken[], newToken: string | null, collections: CollectionWithOwner[], flash?: string | null) {
  const themePref = prefOf(user, "theme_pref", "system");
  const railPref = prefOf(user, "rail_pref", "tool");
  return (
    <Layout config={config} title="Yours" user={user} nav="yours">
      <section>
        <div class="sect">
          <h2>Yours</h2>
          <a class="tlink" href="/.new">
            Publish a tool
          </a>
        </div>
        <div class="rows">
          {mine.map((e, i) => (
            <ToolRow entry={e} config={config} index={i + 1} />
          ))}
        </div>
        {!mine.length ? <p class="empty">You have not published anything yet.</p> : null}
      </section>

      <section class="section">
        <div class="sect">
          <h2>Shared collections you own</h2>
        </div>
        {collections.length ? (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Origin tool</th>
                  <th>Documents</th>
                  <th>Revision</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((col) => (
                  <tr>
                    <td>
                      <a href={`/.collection/${col.id}`}>{col.name}</a>
                    </td>
                    <td>
                      <a href={`/.tool/${col.origin_tool_id}`}>{col.origin_tool_title}</a>
                    </td>
                    <td>{col.doc_count}</td>
                    <td>{col.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="empty">None yet. Create one from a tool’s page.</p>
        )}
      </section>

      <section class="section" id="preferences">
        <div class="sect">
          <h2>Preferences</h2>
        </div>
        <Flash flash={flash} />
        <form method="post" action="/.me/preferences" class="stack" style="max-width:40rem">
          <fieldset>
            <legend style="font:700 .95rem var(--display);margin-bottom:.4rem">Portal theme</legend>
            <p class="panel-note">Pages like this one. The rail beside a tool matches the tool instead, so it reads as part of the tool’s window.</p>
            <div class="choices">
              <label>
                <input type="radio" name="theme" value="system" checked={themePref === "system"} /> Follow my system
              </label>
              <label>
                <input type="radio" name="theme" value="light" checked={themePref === "light"} /> Light
              </label>
              <label>
                <input type="radio" name="theme" value="dark" checked={themePref === "dark"} /> Dark
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend style="font:700 .95rem var(--display);margin-bottom:.4rem">Explore tools rail</legend>
            <div class="choices">
              <label>
                <input type="radio" name="rail" value="tool" checked={railPref === "tool"} /> Match the tool
              </label>
              <label>
                <input type="radio" name="rail" value="light" checked={railPref === "light"} /> Always light
              </label>
              <label>
                <input type="radio" name="rail" value="dark" checked={railPref === "dark"} /> Always dark
              </label>
            </div>
          </fieldset>
          <div>
            <button type="submit">Save preferences</button>
          </div>
        </form>
      </section>

      <section class="section card" id="tokens">
        <h2>Command-line access tokens</h2>
        <p class="panel-note">
          Tokens let the <code>kitlane</code> command publish on your behalf. They are separate from your browser session, shown once, and revocable.
        </p>
        {newToken ? (
          <div class="notice">
            <p>
              <strong>Copy this token now; it will not be shown again.</strong>
            </p>
            <pre>
              <code>{newToken}</code>
            </pre>
            <p>
              Then run: <code>npx kitlane login {portalOrigin(config)} --token &lt;token&gt;</code>
            </p>
          </div>
        ) : null}
        <form method="post" action="/.me/tokens" class="row">
          <input name="label" placeholder="Label, e.g. laptop" required maxlength={120} />
          <select name="days">
            <option value="90">Expires in 90 days</option>
            <option value="30">Expires in 30 days</option>
            <option value="365">Expires in 1 year</option>
          </select>
          <button type="submit">Create token</button>
        </form>
        {tokens.length ? (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr class={t.revoked_at ? "muted" : ""}>
                    <td>{t.label}</td>
                    <td>{formatDate(t.created_at)}</td>
                    <td>{t.expires_at ? formatDate(t.expires_at) : "never"}</td>
                    <td>{t.last_used_at ? formatDate(t.last_used_at) : "not yet"}</td>
                    <td>
                      {t.revoked_at ? (
                        "revoked"
                      ) : (
                        <form method="post" action={`/.me/tokens/${t.id}/revoke`} class="inline">
                          <button class="link danger" type="submit">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </Layout>
  );
}

/* ---------- Tool page ---------- */

export interface ToolDetailData {
  entry: EntryWithNames;
  user: User;
  canMaintain: boolean;
  isOwner: boolean;
  canPublish: boolean;
  maintainers: (User & { added_at: Date })[];
  versions: (Version & { created_by_name: string | null })[];
  active: Version | null;
  history: DeploymentHistoryRow[];
  lineage: { original: { entry: EntryWithNames | null; versionId: string | null } | null; copies: EntryWithNames[] };
  bindings: BindingInfo[];
  collections: CollectionWithOwner[];
  audit: AuditEvent[];
  replacement: EntryWithNames | null;
  flash?: string | null;
  error?: string | null;
}

export function toolDetailPage(config: Config, d: ToolDetailData) {
  const { entry, user } = d;
  const primary = entry.names[0];
  const directUrl = entry.mode === "hosted" ? toolOrigin(config, entry.id) + "/" : entry.external_url ?? "";
  const others = d.maintainers.filter((m) => m.id !== entry.creator_id).map((m) => m.display_name);
  const canRemix = entry.mode === "hosted" && Boolean(d.active) && !entry.frozen && d.canPublish;
  const theme = themeOf(entry);
  return (
    <Layout config={config} title={entry.title} user={user}>
      <div class="g">
        <section class="c8 tool-head">
          <div class="tool-eyebrow">
            <span class="mono" style="color:var(--body)">
              {config.shortcut}/{primary}
            </span>
            <Lifecycle entry={entry} />
            {entry.frozen ? <span class="badge frozen">frozen</span> : null}
            {entry.featured ? <span class="badge active">featured</span> : null}
            <span class="by">
              {kindOf(entry)}
              {d.active ? ` · version ${d.active.number}` : entry.mode === "hosted" ? " · nothing published yet" : ""}
            </span>
          </div>
          <h1>{entry.title}</h1>
          <p class="deck">{entry.purpose || <span class="muted">No purpose written yet.</span>}</p>
          <p style="font-size:.95rem;margin:0;color:var(--body)">
            {entry.creator_name} made this.{" "}
            <span class="muted">
              {entry.creator_team ? `${entry.creator_team} · ` : ""}updated {formatAgo(entry.updated_at)}
              {others.length ? ` · maintained with ${others.join(", ")}` : ""}
              {entry.owner_id !== entry.creator_id ? ` · owned by ${entry.owner_name}` : ""}
            </span>
          </p>
          <Tags tags={entry.tags} />
          <div class="tool-actions">
            {entry.frozen ? null : (
              <a class="btn primary" href={`/${primary}`}>
                Open {entry.title}
              </a>
            )}
            {canRemix ? (
              <a class="btn" href={`/.tool/${entry.id}/copy`}>
                <RemixIcon /> Remix
              </a>
            ) : null}
            {entry.mode === "hosted" && d.active && !entry.frozen ? (
              <a class="tlink" href={`/.tool/${entry.id}/download/${d.active.id}`}>
                Download the files
              </a>
            ) : null}
            {entry.mode === "hosted" && d.active && !entry.frozen ? (
              <a class="tlink quiet" href={directUrl} rel="noopener">
                Open without the rail
              </a>
            ) : null}
          </div>
          {entry.frozen ? <p class="error">Frozen by an administrator{entry.frozen_reason ? `: ${entry.frozen_reason}` : ""}. Launching is blocked.</p> : null}
          <Flash flash={d.flash} error={d.error} />
          {entry.lifecycle === "retired" ? (
            <p class="notice">
              This tool is retired.{" "}
              {d.replacement ? (
                <>
                  Use <a href={`/.tool/${d.replacement.id}`}>{d.replacement.title}</a> instead.
                </>
              ) : (
                "No replacement has been named."
              )}
            </p>
          ) : null}
        </section>

        <aside class="c4 facts" aria-label="About this tool">
          {entry.mode === "hosted" ? (
            <>
              <div class="fact">
                <div class="fact-k">Reads</div>
                <div class="fact-v">
                  {d.bindings.length ? (
                    <>
                      {d.bindings.map((b, i) => (
                        <>
                          {i ? ", " : ""}
                          <a href={`/.collection/${b.collection_id}`}>{b.collection_name}</a>
                        </>
                      ))}
                      . Shared collections everyone signed in here can read.
                    </>
                  ) : (
                    "No shared collections."
                  )}
                </div>
              </div>
              <div class="fact">
                <div class="fact-k">Keeps</div>
                <div class="fact-v">Personal storage for each person who uses it. Only they can read it; maintainers cannot.</div>
              </div>
            </>
          ) : (
            <div class="fact">
              <div class="fact-k">Goes to</div>
              <div class="fact-v">
                <a href={entry.external_url ?? "#"} rel="noopener noreferrer">
                  {entry.external_url}
                </a>
              </div>
            </div>
          )}
          <div class="fact">
            <div class="fact-k">Names</div>
            <div class="fact-v">
              {entry.names.map((n, i) => (
                <>
                  {i ? ", " : ""}
                  <code>
                    {config.shortcut}/{n}
                  </code>{" "}
                  <a class="tlink quiet" href={`/.h/${n}`} style="font-size:.78rem">
                    history
                  </a>
                </>
              ))}
              {entry.mode === "hosted" ? (
                <>
                  <br />
                  <span class="muted small">Names are aliases. The tool’s own origin is {toolOrigin(config, entry.id)}.</span>
                </>
              ) : null}
            </div>
          </div>
          <div class="fact">
            <div class="fact-k">Remixes</div>
            <div class="fact-v">
              {d.lineage.original ? (
                <>
                  A remix of {d.lineage.original.entry ? <a href={`/.tool/${d.lineage.original.entry.id}`}>{d.lineage.original.entry.title}</a> : "a removed tool"}
                  {d.lineage.original.entry ? ` by ${d.lineage.original.entry.creator_name}` : ""}. The maintainer of this remix is responsible for it.{" "}
                </>
              ) : null}
              {d.lineage.copies.length ? `Remixed ${d.lineage.copies.length === 1 ? "once" : `${d.lineage.copies.length} times`}. ${entry.creator_name} stays credited on every remix.` : d.lineage.original ? "" : "Not remixed yet."}
            </div>
          </div>
          {entry.repo_url ? (
            <div class="fact">
              <div class="fact-k">Source</div>
              <div class="fact-v">
                <a href={entry.repo_url} rel="noopener noreferrer">
                  {entry.repo_url}
                </a>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {d.lineage.copies.length ? (
        <section class="section">
          <div class="sect">
            <h2>Remixes of this tool</h2>
          </div>
          <div class="rows">
            {d.lineage.copies.map((c, i) => (
              <ToolRow entry={c} config={config} index={i + 1} />
            ))}
          </div>
        </section>
      ) : null}

      {entry.mode === "hosted" ? (
        <section class="section">
          <div class="sect">
            <h2>Versions</h2>
          </div>
          {!d.versions.length ? (
            <p class="empty">
              Nothing published yet. Publish with <code>npx kitlane publish ./dist --name {primary}</code>.
            </p>
          ) : (
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Published</th>
                    <th>By</th>
                    <th>Files</th>
                    <th>Size</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {d.versions.map((v) => (
                    <tr class={v.removed ? "muted" : ""}>
                      <td>
                        <strong style="color:var(--text)">{v.number}</strong> {d.active?.id === v.id ? <span class="badge active">active</span> : null}
                        {v.removed ? <span class="badge frozen">content removed</span> : null}
                      </td>
                      <td>{formatAgo(v.created_at)}</td>
                      <td>{v.created_by_name ?? "unknown"}</td>
                      <td>{v.file_count}</td>
                      <td>{formatBytes(v.total_bytes)}</td>
                      <td>{v.note ?? ""}</td>
                      <td class="row">
                        {!v.removed ? (
                          <a class="tlink quiet" href={`/.tool/${entry.id}/download/${v.id}`}>
                            download
                          </a>
                        ) : null}
                        {d.canMaintain && !v.removed && d.active?.id !== v.id && !entry.frozen ? (
                          <form method="post" action={`/.tool/${entry.id}/rollback`} class="inline">
                            <input type="hidden" name="versionId" value={v.id} />
                            <button class="link" type="submit">
                              activate
                            </button>
                          </form>
                        ) : null}
                        {user.is_admin && !v.removed ? (
                          <form method="post" action={`/.tool/${entry.id}/versions/${v.id}/remove`} class="inline" data-confirm="Permanently delete this version's files? The audit record is kept.">
                            <input name="reason" placeholder="reason" required style="height:2rem" />
                            <button class="link danger" type="submit">
                              remove content
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {entry.mode === "hosted" && d.bindings.length ? (
        <section class="section">
          <div class="sect">
            <h2>Shared collections</h2>
          </div>
          <p class="panel-note">
            Readable by everyone signed in to this installation, through any registered tool. Writing needs an authorized person and an allowed tool context.
          </p>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Binding in this tool</th>
                  <th>Collection</th>
                  <th>Owner</th>
                  <th>This tool may write?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.bindings.map((b) => {
                  const col = d.collections.find((c) => c.id === b.collection_id);
                  const originIsThis = b.origin_tool_id === entry.id;
                  return (
                    <tr>
                      <td>
                        <code>{b.binding_name}</code>
                      </td>
                      <td>
                        <a href={`/.collection/${b.collection_id}`}>{b.collection_name}</a> {b.frozen ? <span class="badge frozen">frozen</span> : null}
                      </td>
                      <td>{col?.owner_name ?? "unknown"}</td>
                      <td>{originIsThis ? "Yes (originating tool)" : "Only with a writer-context grant"}</td>
                      <td>
                        {d.canMaintain ? (
                          <form method="post" action={`/.tool/${entry.id}/bindings/unbind`} class="inline">
                            <input type="hidden" name="binding" value={b.binding_name} />
                            <button class="link danger" type="submit">
                              unbind
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {d.canMaintain ? (
        <details class="section">
          <summary>Maintain this tool</summary>
          <p class="panel-note">
            You are a maintainer. New versions come from the command line with <code>kitlane publish ./dist --name {primary}</code>. Everything else is here.
          </p>
          <div class="two-col">
            <form method="post" action={`/.tool/${entry.id}/metadata`} class="stack">
              <h3>Metadata</h3>
              <label>
                Title <input name="title" value={entry.title} required maxlength={120} />
              </label>
              <label>
                Purpose <input name="purpose" value={entry.purpose} maxlength={280} />
              </label>
              <label>
                Tags <input name="tags" value={entry.tags.join(", ")} />
              </label>
              <label>
                Team <input name="team" value={entry.team ?? ""} />
              </label>
              <label>
                Source repository (optional) <input name="repoUrl" type="url" value={entry.repo_url ?? ""} />
              </label>
              {entry.mode === "external" ? (
                <label>
                  Destination <input name="externalUrl" type="url" value={entry.external_url ?? ""} required />
                </label>
              ) : (
                <label>
                  Theme the rail should match
                  <select name="theme">
                    <option value="" selected={!theme}>
                      Read it from the page
                    </option>
                    <option value="light" selected={theme === "light"}>
                      Light
                    </option>
                    <option value="dark" selected={theme === "dark"}>
                      Dark
                    </option>
                    <option value="system" selected={theme === "system"}>
                      Follows the person’s system
                    </option>
                  </select>
                </label>
              )}
              <div>
                <button type="submit">Save</button>
              </div>
            </form>
            <div class="stack">
              <form method="post" action={`/.tool/${entry.id}/lifecycle`} class="stack">
                <h3>Lifecycle</h3>
                <label>
                  State
                  <select name="lifecycle">
                    <option value="experimental" selected={entry.lifecycle === "experimental"}>
                      experimental
                    </option>
                    <option value="maintained" selected={entry.lifecycle === "maintained"}>
                      maintained
                    </option>
                    <option value="retired" selected={entry.lifecycle === "retired"}>
                      retired
                    </option>
                  </select>
                </label>
                <label>
                  Replacement tool ID (when retiring) <input name="replacement" value={entry.replacement_entry_id ?? ""} />
                </label>
                <div>
                  <button type="submit">Update lifecycle</button>
                </div>
              </form>
              <h3>Names</h3>
              <ul class="plain">
                {entry.names.map((n) => (
                  <li>
                    <code>
                      {config.shortcut}/{n}
                    </code>
                    {entry.names.length > 1 ? (
                      <form method="post" action={`/.tool/${entry.id}/names/release`} class="inline">
                        <input type="hidden" name="name" value={n} />
                        <button class="link danger" type="submit">
                          release
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              <form method="post" action={`/.tool/${entry.id}/names/claim`} class="row">
                <input name="name" placeholder="additional name" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
                <button type="submit">Add name</button>
              </form>
              <h3>Maintainers</h3>
              <ul class="plain">
                {d.maintainers.map((m) => (
                  <li>
                    {m.display_name} {m.id === entry.owner_id ? <span class="badge">owner</span> : null}
                    {d.isOwner && m.id !== entry.owner_id ? (
                      <form method="post" action={`/.tool/${entry.id}/maintainers/remove`} class="inline">
                        <input type="hidden" name="userId" value={m.id} />
                        <button class="link danger" type="submit">
                          remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
              {d.isOwner ? (
                <>
                  <form method="post" action={`/.tool/${entry.id}/maintainers/add`} class="row">
                    <input name="user" placeholder="user ID or email" required />
                    <button type="submit">Add co-maintainer</button>
                  </form>
                  <form method="post" action={`/.tool/${entry.id}/transfer`} class="row" data-confirm="Transfer ownership? You will remain a maintainer but lose owner rights.">
                    <input name="user" placeholder="new owner (user ID or email)" required />
                    <button type="submit" class="danger">
                      Transfer ownership
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
          {entry.mode === "hosted" ? (
            <div class="two-col" style="margin-top:1.5rem">
              <form method="post" action={`/.tool/${entry.id}/collections`} class="stack">
                <h3>Create a shared collection</h3>
                <label>
                  Name <input name="name" pattern="[a-z0-9][a-z0-9_-]*" required placeholder="company-briefs" />
                </label>
                <label>
                  Description <input name="description" maxlength={500} />
                </label>
                <p class="panel-note">Everyone in this installation will be able to read it. {entry.owner_name} will own it.</p>
                <div>
                  <button type="submit">Create collection</button>
                </div>
              </form>
              <form method="post" action={`/.tool/${entry.id}/bindings/bind`} class="stack">
                <h3>Bind an existing collection as a read reference</h3>
                <label>
                  Binding name <input name="binding" pattern="[a-z0-9][a-z0-9_-]*" required />
                </label>
                <label>
                  Collection ID <input name="collectionId" required />
                </label>
                <div>
                  <button type="submit">Bind</button>
                </div>
              </form>
            </div>
          ) : null}
          {d.history.length ? (
            <details class="quiet" style="margin-top:1.2rem">
              <summary>Deployment history</summary>
              <ul class="plain small">
                {d.history.map((h) => (
                  <li>
                    {formatDate(h.at)} · {h.action} {h.version_number ? `v${h.version_number}` : ""} by {h.actor_name ?? "system"} (revision {h.revision})
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </details>
      ) : null}

      {user.is_admin ? (
        <details class="section">
          <summary>Administrator</summary>
          <div class="row">
            <form method="post" action={`/.tool/${entry.id}/freeze`} class="row">
              <input type="hidden" name="frozen" value={entry.frozen ? "0" : "1"} />
              {!entry.frozen ? <input name="reason" placeholder="reason (shown to people)" /> : null}
              <button type="submit" class={entry.frozen ? "" : "danger"}>
                {entry.frozen ? "Unfreeze" : "Freeze"}
              </button>
            </form>
            <form method="post" action={`/.tool/${entry.id}/featured`} class="row">
              <input type="hidden" name="featured" value={entry.featured ? "0" : "1"} />
              <button type="submit">{entry.featured ? "Stop featuring" : "Feature on Today and in the rail"}</button>
            </form>
            <form method="post" action={`/.tool/${entry.id}/recover`} class="row">
              <input name="user" placeholder="recover ownership to (user ID or email)" required />
              <button type="submit" class="danger">
                Recover ownership
              </button>
            </form>
          </div>
        </details>
      ) : null}

      {d.canMaintain && d.audit.length ? (
        <details class="quiet section">
          <summary>Audit log ({d.audit.length})</summary>
          <ul class="plain small">
            {d.audit.map((a) => (
              <li>
                {formatDate(a.at)} · <code>{a.action}</code> · {a.actor_name ?? a.actor_type}
                {a.target_id ? ` · ${a.target_type} ${a.target_id}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Layout>
  );
}

/* ---------- Remix ---------- */

export function copyPage(config: Config, user: User, source: EntryWithNames, error?: string) {
  return (
    <Layout config={config} title={`Remix ${source.title}`} user={user}>
      <section class="card narrow">
        <h2 style="font-size:2rem">Remix {source.title}</h2>
        <p class="prose">
          The published files (HTML, JavaScript, CSS, assets) are duplicated into a new tool you own, with its own name and origin. {source.creator_name} stays credited as the original maker through visible lineage, and you become responsible for your version.
        </p>
        <ul class="prose" style="padding-left:1.2rem">
          <li>Your remix starts with fresh personal storage. It cannot read what people kept in the original.</li>
          <li>Shared-collection bindings are kept as read references to the same data. No writing rights come along.</li>
          <li>Backends and services that are not in the files are not reproduced.</li>
        </ul>
        {error ? <p class="error">{error}</p> : null}
        <form method="post" action={`/.tool/${source.id}/copy`} class="stack">
          <label>
            New name ({config.shortcut}/…)
            <input name="name" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
          </label>
          <label>
            Title <input name="title" value={`${source.title} remix`} maxlength={120} />
          </label>
          <div>
            <button type="submit" class="primary">
              <RemixIcon /> Create my remix
            </button>
          </div>
        </form>
        <p class="panel-note" style="margin-top:1rem">
          Then pull the files with <code>kitlane pull &lt;name&gt;</code>, change them with whatever you like, and publish with <code>kitlane publish</code>.
        </p>
      </section>
    </Layout>
  );
}

/* ---------- Collections ---------- */

export function collectionPage(config: Config, user: User, col: SharedCollection & { owner_name: string }, originTool: EntryWithNames | null, boundTools: { entry: EntryWithNames; binding: string }[], grants: WriterGrant[], updaters: UpdaterCredential[], audit: AuditEvent[], canManage: boolean, docCount: number, newUpdaterToken: string | null, flash?: string | null, error?: string | null) {
  return (
    <Layout config={config} title={`Collection ${col.name}`} user={user}>
      <section class="tool-head">
        <div class="tool-eyebrow">
          <span class="by">Shared collection</span>
          <span class="mono">{col.id}</span>
          {col.frozen ? <span class="badge frozen">frozen</span> : null}
        </div>
        <h1 style="font-size:2.8rem">{col.name}</h1>
        <p class="deck">{col.description || <span class="muted">No description.</span>}</p>
        <p class="by" style="font-size:.9rem">
          Owned by {col.owner_name} · origin tool {originTool ? <a href={`/.tool/${originTool.id}`}>{originTool.title}</a> : "none"} · {docCount} documents · revision {col.revision}
        </p>
      </section>
      <Flash flash={flash} error={error} />
      <p class="prose" style="margin-top:1rem">
        Every signed-in person on this installation can read this collection through any registered tool. Only the owner, granted writers in allowed tool contexts, and scoped updater credentials can write.
      </p>
      <div class="two-col" style="margin-top:1.5rem">
        <section>
          <div class="sect">
            <h2>Tools that bind it</h2>
          </div>
          <ul class="plain">
            {boundTools.map((b) => (
              <li>
                <a href={`/.tool/${b.entry.id}`}>{b.entry.title}</a> as <code>{b.binding}</code>
                {b.entry.id === col.origin_tool_id ? <span class="badge active"> · originating, may write</span> : <span class="muted"> · read reference</span>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div class="sect">
            <h2>Writers</h2>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Subject</th>
                  <th>Granted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>person</td>
                  <td>{col.owner_name}</td>
                  <td class="muted">owner (implicit)</td>
                  <td></td>
                </tr>
                {originTool ? (
                  <tr>
                    <td>tool</td>
                    <td>{originTool.title}</td>
                    <td class="muted">originating tool (implicit)</td>
                    <td></td>
                  </tr>
                ) : null}
                {grants.map((g) => (
                  <tr>
                    <td>{g.grant_type === "user" ? "person" : "tool"}</td>
                    <td>
                      {g.subject_name ?? g.subject_id} <span class="muted">({g.subject_id})</span>
                    </td>
                    <td>{formatDate(g.granted_at)}</td>
                    <td>
                      {canManage ? (
                        <form method="post" action={`/.collection/${col.id}/grants/${g.id}/revoke`} class="inline">
                          <button class="link danger" type="submit">
                            revoke
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form method="post" action={`/.collection/${col.id}/grants`} class="row" style="margin-top:.6rem">
              <select name="type">
                <option value="user">Person may write</option>
                <option value="tool">Tool is a writer context</option>
              </select>
              <input name="subject" placeholder="user ID/email or tool ID" required />
              <button type="submit">Grant</button>
            </form>
          ) : null}
          <p class="panel-note" style="margin-top:.6rem">A browser write succeeds only when the person is a writer and the tool is an allowed context. Opening an editor tool does not make its visitors writers.</p>
        </section>
      </div>
      {canManage ? (
        <section class="section">
          <div class="sect">
            <h2>Updater credentials</h2>
          </div>
          <p class="panel-note">For an external process, such as a script or a scheduled job elsewhere, that refreshes this collection. Scoped to named collections and operations; cannot reach personal storage or publish tools. Keep it out of published HTML and JavaScript.</p>
          {newUpdaterToken ? (
            <div class="notice">
              <p>
                <strong>Copy this credential now; it will not be shown again.</strong>
              </p>
              <pre>
                <code>{newUpdaterToken}</code>
              </pre>
              <p>
                Example: <code>KITLANE_UPDATER_TOKEN=… node refresh.mjs</code> against <code>{portalOrigin(config)}/.api/updater/collections/{col.id}/documents/_bulk</code>
              </p>
            </div>
          ) : null}
          <form method="post" action={`/.collection/${col.id}/updaters`} class="row">
            <input name="label" placeholder="label, e.g. nightly-refresh" required />
            <select name="operations" multiple size={4} aria-label="Operations" style="height:auto">
              <option value="read" selected>
                read
              </option>
              <option value="write" selected>
                write
              </option>
              <option value="bulk" selected>
                bulk
              </option>
              <option value="delete">delete</option>
            </select>
            <select name="days">
              <option value="90">90 days</option>
              <option value="30">30 days</option>
              <option value="365">1 year</option>
              <option value="0">no expiry</option>
            </select>
            <button type="submit">Create credential</button>
          </form>
          {updaters.length ? (
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Operations</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Last used</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {updaters.map((u) => (
                    <tr class={u.revoked_at ? "muted" : ""}>
                      <td>{u.label}</td>
                      <td>{u.operations.join(", ")}</td>
                      <td>{formatDate(u.created_at)}</td>
                      <td>{u.expires_at ? formatDate(u.expires_at) : "never"}</td>
                      <td>{u.last_used_at ? formatDate(u.last_used_at) : "not yet"}</td>
                      <td>
                        {u.revoked_at ? (
                          "revoked"
                        ) : (
                          <form method="post" action={`/.collection/${col.id}/updaters/${u.id}/revoke`} class="inline">
                            <button class="link danger" type="submit">
                              revoke
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      {canManage ? (
        <details class="section">
          <summary>Manage this collection</summary>
          <div class="row">
            <form method="post" action={`/.collection/${col.id}/description`} class="row">
              <input name="description" value={col.description} maxlength={500} placeholder="description" />
              <button type="submit">Save description</button>
            </form>
            <form method="post" action={`/.collection/${col.id}/transfer`} class="row" data-confirm="Transfer ownership of this collection?">
              <input name="user" placeholder="new owner (user ID or email)" required />
              <button type="submit" class="danger">
                Transfer ownership
              </button>
            </form>
            {user.is_admin ? (
              <form method="post" action={`/.collection/${col.id}/freeze`} class="row">
                <input type="hidden" name="frozen" value={col.frozen ? "0" : "1"} />
                {!col.frozen ? <input name="reason" placeholder="reason" /> : null}
                <button type="submit" class={col.frozen ? "" : "danger"}>
                  {col.frozen ? "Unfreeze collection" : "Freeze collection"}
                </button>
              </form>
            ) : null}
          </div>
        </details>
      ) : null}
      {canManage && audit.length ? (
        <details class="quiet section">
          <summary>Audit log ({audit.length})</summary>
          <ul class="plain small">
            {audit.map((a) => (
              <li>
                {formatDate(a.at)} · <code>{a.action}</code> · {a.actor_name ?? `${a.actor_type} ${a.actor_id ?? ""}`}
                {a.target_id ? ` · ${a.target_type} ${a.target_id}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Layout>
  );
}

/* ---------- Name history ---------- */

export function nameHistoryPage(config: Config, user: User, name: string, current: NameRow | null, currentEntry: EntryWithNames | null, history: NameHistoryRow[]) {
  return (
    <Layout config={config} title={`History of ${config.shortcut}/${name}`} user={user}>
      <section class="card narrow">
        <h2 style="font-size:2rem">
          <span class="mono" style="color:var(--text);font-size:.8em">
            {config.shortcut}/{name}
          </span>
        </h2>
        {current?.entry_id && currentEntry ? (
          <p class="prose">
            Currently points to <a href={`/.tool/${currentEntry.id}`}>{currentEntry.title}</a>.
          </p>
        ) : current?.reserved ? (
          <p class="prose">Reserved by an administrator.</p>
        ) : (
          <p class="prose">
            Not currently in use. <a href={`/.new?name=${encodeURIComponent(name)}`}>Claim it</a>.
          </p>
        )}
        <h3>Name history</h3>
        <p class="panel-note">Name history is kept separately from deployment history. Renaming never moves a tool’s identity, browser storage, or permissions.</p>
        <ul class="plain">
          {history.map((h) => (
            <li>
              {formatDate(h.at)} · {h.action} {h.entry_title ? <a href={`/.tool/${h.entry_id}`}>{h.entry_title}</a> : h.entry_id ? h.entry_id : ""} by {h.actor_name ?? "system"}
            </li>
          ))}
        </ul>
        {!history.length ? <p class="muted">No history.</p> : null}
      </section>
    </Layout>
  );
}

/* ---------- Administration ---------- */

export function adminPage(config: Config, user: User, frozenEntries: EntryWithNames[], reserved: NameRow[], recentAudit: AuditEvent[], recentUsers: User[], flash?: string | null, error?: string | null) {
  return (
    <Layout config={config} title="Administration" user={user} nav="admin">
      <h1 style="margin-bottom:1.2rem">Administration</h1>
      <Flash flash={flash} error={error} />
      <div class="two-col">
        <section>
          <div class="sect">
            <h2>Frozen tools</h2>
          </div>
          {frozenEntries.length ? (
            <ul class="plain">
              {frozenEntries.map((e) => (
                <li>
                  <a href={`/.tool/${e.id}`}>{e.title}</a> <span class="muted">{e.frozen_reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="empty">None.</p>
          )}
          <p class="panel-note" style="margin-top:.6rem">Freeze a tool from its page. Freezing blocks fresh asset and SDK access by short link and direct URL.</p>
        </section>
        <section>
          <div class="sect">
            <h2>Reserved names</h2>
          </div>
          <ul class="plain">
            {reserved.map((n) => (
              <li>
                <code>
                  {config.shortcut}/{n.name}
                </code>
                <form method="post" action="/.admin/names/unreserve" class="inline">
                  <input type="hidden" name="name" value={n.name} />
                  <button class="link" type="submit">
                    unreserve
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <form method="post" action="/.admin/names/reserve" class="row" style="margin-top:.6rem">
            <input name="name" placeholder="name to reserve" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            <button type="submit">Reserve</button>
          </form>
        </section>
      </div>
      <div class="two-col section">
        <section>
          <div class="sect">
            <h2>Measurement and export</h2>
          </div>
          <p class="prose">
            <a href="/.admin/measurement">Discovery measurement report</a>
          </p>
          <p class="prose">
            <a href="/.export">Download the catalog export (JSON)</a>: entries, names, ownership, lineage, and shared bindings. Never personal records or credentials.
          </p>
          <p class="prose">
            <a href="/.export?includeShared=1">Export including shared collection documents</a>
          </p>
        </section>
        <section>
          <div class="sect">
            <h2>People</h2>
          </div>
          <form method="post" action="/.admin/users/admin" class="row">
            <input name="user" placeholder="user ID or email" required />
            <select name="isAdmin">
              <option value="1">grant admin</option>
              <option value="0">revoke admin</option>
            </select>
            <button type="submit">Apply</button>
          </form>
          <h3 style="margin-top:1rem">Assign a team</h3>
          <p class="panel-note">For studies where the identity provider supplies no team. An assigned team is kept on later sign-ins until cleared, and reports must say teams were assigned.</p>
          <form method="post" action="/.admin/users/team" class="row">
            <input name="user" placeholder="user ID or email" required />
            <input name="team" placeholder="team (blank to clear)" maxlength={80} />
            <button type="submit">Set team</button>
          </form>
          {recentUsers.length ? (
            <div class="table-wrap">
              <table class="table small">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Email</th>
                    <th>Team</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map((ru) => (
                    <tr>
                      <td>
                        {ru.display_name} {ru.is_admin ? <span class="badge">admin</span> : null} {ru.is_dev_user ? <span class="badge">synthetic</span> : null}
                      </td>
                      <td>{ru.email ?? ""}</td>
                      <td>
                        {ru.team ?? <span class="muted">unknown</span>} {ru.team_locked ? <span class="badge" title="Assigned by an administrator">assigned</span> : null}
                      </td>
                      <td>{formatAgo(ru.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
      <details class="section" open>
        <summary>Recent audit events</summary>
        <ul class="plain small">
          {recentAudit.map((a) => (
            <li>
              {formatDate(a.at)} · <code>{a.action}</code> · {a.actor_name ?? `${a.actor_type}`}
              {a.entry_id ? (
                <>
                  {" "}
                  · <a href={`/.tool/${a.entry_id}`}>{a.entry_id}</a>
                </>
              ) : null}
              {a.collection_id ? (
                <>
                  {" "}
                  · <a href={`/.collection/${a.collection_id}`}>{a.collection_id}</a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </Layout>
  );
}

export function measurementPage(config: Config, user: User, report: MeasurementReport) {
  const s = report.stages;
  return (
    <Layout config={config} title="Discovery measurement" user={user} nav="admin">
      <h1 style="margin-bottom:.4rem">How discovery is measured</h1>
      <p class="deck" style="margin-bottom:1rem">Since {formatDate(report.since)}. Pseudonymous identifiers only; no prompt text, tool inputs, or query strings are recorded.</p>
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Opportunity: rail rendered</span>
          <span class="stat-value">{s.opportunity}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Engagement: drawer opened</span>
          <span class="stat-value">{s.engagement}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Discovery: a pick launched</span>
          <span class="stat-value">{s.discovery}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Tool access events</span>
          <span class="stat-value">{s.accessEvents}</span>
        </div>
      </div>
      <div class="sect">
        <h2>North star</h2>
      </div>
      <table class="table">
        <tbody>
          <tr>
            <td>Eligible people with at least one rail opportunity</td>
            <td class="num">{report.cohort.usersWithRailOpportunity}</td>
          </tr>
          <tr>
            <td>Person/tool pairs whose first recorded launch came through the rail</td>
            <td class="num">{report.railOriginated.pairs}</td>
          </tr>
          <tr>
            <td>…of which returned on a later day within 7 days</td>
            <td class="num">{report.railOriginated.returningWithin7Days}</td>
          </tr>
          <tr>
            <td>…of which cross-team (person’s team differs from the maker’s, both known)</td>
            <td class="num">
              <strong>{report.railOriginated.crossTeamReturning}</strong>
            </td>
          </tr>
          <tr>
            <td>…with unknown team attribution (reported separately)</td>
            <td class="num">{report.railOriginated.unknownTeamReturning}</td>
          </tr>
        </tbody>
      </table>
      <div class="sect section">
        <h2>Launches by source tool</h2>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Source tool</th>
            <th>Picks launched</th>
          </tr>
        </thead>
        <tbody>
          {report.bySourceTool.map((r) => (
            <tr>
              <td>
                <a href={`/.tool/${r.source_entry_id}`}>{r.title}</a>
              </td>
              <td class="num">{r.launches}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.assignedTeams ? <p class="notice">{report.assignedTeams} person(s) have administrator-assigned teams. Treat team-based numbers as a usability study result, not organizational adoption.</p> : null}
      <div class="sect section">
        <h2>Interpretation limits</h2>
      </div>
      <ul class="prose" style="padding-left:1.2rem">
        {report.notes.map((n) => (
          <li>{n}</li>
        ))}
      </ul>
    </Layout>
  );
}

/* ---------- The drawer ---------- */

export function drawerFragment(config: Config, current: EntryWithNames, maintainers: string[], recs: Recommendation[], canRemix: boolean) {
  const others = maintainers.filter((m) => m !== current.creator_name);
  return (
    <div class="drawer-content">
      <section class="drawer-this" aria-labelledby="kl-this-heading">
        <h2 id="kl-this-heading" class="drawer-title">
          {current.title}
        </h2>
        <span class="mono">
          {config.shortcut}/{current.names[0]}
        </span>
        {current.purpose ? <p class="deck">{current.purpose}</p> : null}
        <span class="by">
          {current.creator_name} made this{current.creator_team ? `, ${current.creator_team}` : ""}.{others.length ? ` Maintained with ${others.join(", ")}.` : ""} <Lifecycle entry={current} />
        </span>
        <div class="drawer-links">
          <a class="btn sm" href={`${portalOrigin(config)}/.tool/${current.id}`} target="_top">
            Open in portal
          </a>
          {canRemix ? (
            <a class="btn sm" href={`${portalOrigin(config)}/.tool/${current.id}/copy`} target="_top">
              <RemixIcon /> Remix
            </a>
          ) : null}
          <a class="tlink quiet" href={toolOrigin(config, current.id) + "/"} target="_blank" rel="noopener" data-kl-direct>
            Open without the rail
          </a>
        </div>
      </section>
      <section class="drawer-section" aria-labelledby="kl-recs-heading">
        <h2 id="kl-recs-heading">Also on the shelf</h2>
        {recs.length ? (
          <>
            <p class="by">
              {recs.length === 1 ? "One pick" : `${recs.length} picks`}, and why.
            </p>
            <div class="rows drawer-rows">
              {recs.map((r, i) => (
                <ToolRow entry={r.entry} config={config} index={i + 1} reason={r.reason} reasonKey={r.reasonKey} placement={i + 1} source={current.id} titleHref={launchOf(r.entry)} target="_top" action="none" />
              ))}
            </div>
          </>
        ) : (
          <p class="empty">No other tools yet.</p>
        )}
      </section>
      <section class="drawer-footer">
        <a class="tlink" href={`${portalOrigin(config)}/.search`} target="_top">
          Browse every tool
        </a>
        <span class="by">Picked from shared tags, who made what, remix lineage, and what is new. Nothing is ranked by popularity.</span>
        {config.banner ? <span class="by">{config.banner}</span> : null}
      </section>
    </div>
  );
}
