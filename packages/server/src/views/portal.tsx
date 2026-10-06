import type { FC } from "hono/jsx";
import type { Config } from "../config.js";
import { portalOrigin, toolOrigin } from "../config.js";
import type { AuditEvent } from "../services/audit.js";
import type { BindingInfo, CollectionWithOwner, UpdaterCredential, WriterGrant } from "../services/documents.js";
import type { MeasurementReport } from "../services/discovery.js";
import type { NameHistoryRow, NameRow } from "../services/names.js";
import type { Recommendation } from "../services/search.js";
import type { AccessToken } from "../services/tokens.js";
import type { DeploymentHistoryRow } from "../services/versions.js";
import type { EntryWithNames, SharedCollection, User, Version } from "../types.js";
import { Layout, formatBytes, formatDate } from "./layout.js";

export const Lifecycle: FC<{ entry: EntryWithNames }> = ({ entry }) => (
  <span class={`badge lifecycle-${entry.lifecycle}`} title="Lifecycle describes maintainer intent; it is not a security certification">
    {entry.lifecycle}
  </span>
);

export const EntryCard: FC<{ entry: EntryWithNames; config: Config; reason?: string; placement?: number; reasonKey?: string; source?: string }> = ({ entry, config, reason, placement, reasonKey, source }) => {
  const launch = `/${entry.names[0] ?? ".tool/" + entry.id}`;
  const isResource = entry.kind === "resource";
  return (
    <article class={`entry-card ${isResource ? "resource" : "tool"}`}>
      <div class="entry-card-head">
        <a
          class="entry-title"
          href={launch}
          data-kl-target={entry.id}
          data-kl-placement={placement}
          data-kl-reason={reasonKey}
          data-kl-source={source}
          target={source ? "_top" : undefined}
        >
          {entry.title}
        </a>
        <span class="entry-name">
          {config.shortcut}/{entry.names[0]}
        </span>
      </div>
      {entry.purpose ? <p class="entry-purpose">{entry.purpose}</p> : null}
      <div class="entry-meta">
        <span>
          {isResource ? "Link" : entry.mode === "external" ? "External tool" : "Hosted tool"} · by <a href={`/.search?creator=${entry.creator_id}`}>{entry.creator_name}</a>
          {entry.creator_team ? ` (${entry.creator_team})` : ""}
        </span>
        <Lifecycle entry={entry} />
        {entry.frozen ? <span class="badge frozen">frozen</span> : null}
      </div>
      {entry.tags.length ? (
        <div class="tags">
          {entry.tags.map((t) => (
            <a class="tag" href={`/.search?tag=${encodeURIComponent(t)}`}>
              {t}
            </a>
          ))}
        </div>
      ) : null}
      {reason ? <div class="entry-reason">{reason}</div> : null}
    </article>
  );
};

export function homePage(config: Config, user: User, recent: EntryWithNames[], mine: EntryWithNames[], tags: { tag: string; n: number }[]) {
  return (
    <Layout config={config} title="" user={user}>
      <section class="hero">
        <h1>Tools your colleagues made</h1>
        <p class="muted">
          Open a tool at <code>{config.shortcut}/&lt;name&gt;</code>, or at this portal. Every hosted tool shows an <strong>Explore tools</strong> handle so you can find more while you work.
        </p>
        <form action="/.search" method="get" class="hero-search" role="search">
          <input type="search" name="q" placeholder="Search by name, purpose, tag, or person" aria-label="Search all tools" autofocus />
          <button type="submit">Search</button>
        </form>
      </section>
      {mine.length ? (
        <section>
          <div class="section-head">
            <h2>My tools</h2>
            <a href="/.me">Manage</a>
          </div>
          <div class="grid">
            {mine.slice(0, 6).map((e) => (
              <EntryCard entry={e} config={config} />
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <div class="section-head">
          <h2>Recently added</h2>
          <a href="/.search">Browse all</a>
        </div>
        <div class="grid">
          {recent.map((e) => (
            <EntryCard entry={e} config={config} />
          ))}
        </div>
        {!recent.length ? (
          <p class="muted">
            Nothing here yet. <a href="/.new">Publish the first tool</a>.
          </p>
        ) : null}
      </section>
      {tags.length ? (
        <section>
          <h2>Browse by tag</h2>
          <div class="tags">
            {tags.map((t) => (
              <a class="tag" href={`/.search?tag=${encodeURIComponent(t.tag)}`}>
                {t.tag} <span class="muted">{t.n}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </Layout>
  );
}

export function searchPage(config: Config, user: User, params: { q: string; tag?: string | null; creator?: string | null; kind?: string | null; includeRetired?: boolean }, results: EntryWithNames[], creator: User | null, canClaim: boolean) {
  return (
    <Layout config={config} title={params.q ? `Search: ${params.q}` : "Browse all tools"} user={user}>
      <section>
        <form action="/.search" method="get" class="filters" role="search">
          <input type="search" name="q" value={params.q} placeholder="Search" aria-label="Search all tools" />
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
        <div class="active-filters">
          {params.tag ? (
            <span class="chip">
              tag: {params.tag} <a href={`/.search?q=${encodeURIComponent(params.q)}`} aria-label="Remove tag filter">×</a>
            </span>
          ) : null}
          {creator ? (
            <span class="chip">
              by {creator.display_name} <a href={`/.search?q=${encodeURIComponent(params.q)}`} aria-label="Remove creator filter">×</a>
            </span>
          ) : null}
        </div>
        {canClaim ? (
          <div class="notice">
            <strong>
              {config.shortcut}/{params.q}
            </strong>{" "}
            is not in use. <a href={`/.new?name=${encodeURIComponent(params.q)}`}>Claim this name</a> for a tool or link.
          </div>
        ) : null}
        <h1 class="visually-hidden">Results</h1>
        <div class="grid">
          {results.map((e) => (
            <EntryCard entry={e} config={config} />
          ))}
        </div>
        {!results.length ? <p class="muted">No matching tools.</p> : null}
      </section>
    </Layout>
  );
}

export function newEntryPage(config: Config, user: User, prefill: { name?: string; error?: string }) {
  return (
    <Layout config={config} title="Publish a tool or link" user={user}>
      <section class="card">
        <h1>Publish</h1>
        {prefill.error ? <p class="error">{prefill.error}</p> : null}
        <div class="two-col">
          <form method="post" action="/.new" class="stack">
            <h2>Register an existing URL</h2>
            <p class="muted">A tool or document that already lives somewhere else. It gets a catalog entry and a memorable name; it launches directly at its own URL.</p>
            <input type="hidden" name="mode" value="external" />
            <label>
              Name <span class="muted">({config.shortcut}/…)</span>
              <input name="name" required value={prefill.name ?? ""} pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
            </label>
            <label>
              Title <input name="title" required maxlength={120} />
            </label>
            <label>
              Destination URL <input name="externalUrl" type="url" required placeholder="https://…" />
            </label>
            <label>
              One-sentence purpose <input name="purpose" maxlength={280} />
            </label>
            <label>
              Tags <span class="muted">(comma separated, 2 or 3)</span> <input name="tags" placeholder="meetings, research" />
            </label>
            <label>
              Kind
              <select name="kind">
                <option value="tool">Tool (shows in recommendations)</option>
                <option value="resource">Link or document (searchable only)</option>
              </select>
            </label>
            <button type="submit">Register</button>
          </form>
          <form method="post" action="/.new" class="stack">
            <h2>Claim a name for a hosted tool</h2>
            <p class="muted">
              Hosted tools are static files (HTML, JavaScript, CSS, images). Claim the name here, then publish from your working folder with the CLI:
            </p>
            <pre>
              <code>{`npx kitlane login ${portalOrigin(config)}\nnpx kitlane publish ./dist --name <name>`}</code>
            </pre>
            <input type="hidden" name="mode" value="hosted" />
            <label>
              Name <span class="muted">({config.shortcut}/…)</span>
              <input name="name" required value={prefill.name ?? ""} pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
            </label>
            <label>
              Title <input name="title" required maxlength={120} />
            </label>
            <label>
              One-sentence purpose <input name="purpose" maxlength={280} />
            </label>
            <label>
              Tags <input name="tags" placeholder="finance, meetings" />
            </label>
            <button type="submit">Claim name</button>
          </form>
        </div>
      </section>
    </Layout>
  );
}

export function mePage(config: Config, user: User, mine: EntryWithNames[], tokens: AccessToken[], newToken: string | null, collections: CollectionWithOwner[]) {
  return (
    <Layout config={config} title="My tools" user={user}>
      <section>
        <div class="section-head">
          <h1>My tools</h1>
          <a href="/.new">Publish</a>
        </div>
        <div class="grid">
          {mine.map((e) => (
            <EntryCard entry={e} config={config} />
          ))}
        </div>
        {!mine.length ? <p class="muted">You have not published anything yet.</p> : null}
      </section>
      <section>
        <h2>Shared collections I own</h2>
        {collections.length ? (
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
        ) : (
          <p class="muted">None yet. Create collections from a tool's detail page.</p>
        )}
      </section>
      <section class="card" id="tokens">
        <h2>CLI access tokens</h2>
        <p class="muted">Tokens let the <code>kitlane</code> CLI publish on your behalf. They are separate from your browser session, shown once, and revocable.</p>
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
                  <td>{t.last_used_at ? formatDate(t.last_used_at) : "—"}</td>
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
        ) : null}
      </section>
    </Layout>
  );
}

export interface ToolDetailData {
  entry: EntryWithNames;
  user: User;
  canMaintain: boolean;
  isOwner: boolean;
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
  const launchUrl = `${portalOrigin(config)}/${primary}`;
  const directUrl = entry.mode === "hosted" ? toolOrigin(config, entry.id) + "/" : entry.external_url ?? "";
  return (
    <Layout config={config} title={entry.title} user={user}>
      <section class="tool-head">
        <div>
          <h1>{entry.title}</h1>
          <p class="entry-purpose">{entry.purpose || <span class="muted">No purpose written yet.</span>}</p>
          <div class="entry-meta">
            <span>
              Created by <a href={`/.search?creator=${entry.creator_id}`}>{entry.creator_name}</a>
              {entry.creator_team ? ` (${entry.creator_team})` : ""}
            </span>
            <span>Maintained by {d.maintainers.map((m) => m.display_name).join(", ")}</span>
            <span>Owner: {entry.owner_name}</span>
            <Lifecycle entry={entry} />
            {entry.frozen ? <span class="badge frozen">frozen</span> : null}
            {entry.featured ? <span class="badge">featured</span> : null}
          </div>
          {entry.tags.length ? (
            <div class="tags">
              {entry.tags.map((t) => (
                <a class="tag" href={`/.search?tag=${encodeURIComponent(t)}`}>
                  {t}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div class="tool-actions">
          {entry.frozen ? (
            <p class="error">Frozen by an administrator{entry.frozen_reason ? `: ${entry.frozen_reason}` : ""}. Launching is blocked.</p>
          ) : (
            <a class="button primary" href={`/${primary}`}>
              Open {config.shortcut}/{primary}
            </a>
          )}
          {entry.mode === "hosted" && d.active && !entry.frozen ? (
            <a class="button" href={directUrl} rel="noopener">
              Open directly
            </a>
          ) : null}
          {entry.mode === "hosted" && d.active && !entry.frozen ? (
            <a class="button" href={`/.tool/${entry.id}/copy`}>
              Make a copy
            </a>
          ) : null}
          {entry.mode === "hosted" && d.active ? (
            <a class="button" href={`/.tool/${entry.id}/download/${d.active.id}`}>
              Download files
            </a>
          ) : null}
        </div>
      </section>
      {d.flash ? <p class="notice">{d.flash}</p> : null}
      {d.error ? <p class="error">{d.error}</p> : null}
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

      <div class="two-col">
        <section class="card">
          <h2>Addresses</h2>
          <ul class="plain">
            {entry.names.map((n) => (
              <li>
                <code>
                  {config.shortcut}/{n}
                </code>{" "}
                · <a href={`/${n}`}>{portalOrigin(config)}/{n}</a> · <a href={`/.h/${n}`}>history</a>
                {d.canMaintain && entry.names.length > 1 ? (
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
          {entry.mode === "hosted" ? (
            <p class="muted">
              Stable origin: <code>{toolOrigin(config, entry.id)}</code> (names are aliases; browser storage belongs to this origin)
            </p>
          ) : (
            <p>
              Destination: <a href={entry.external_url ?? "#"} rel="noopener noreferrer">{entry.external_url}</a>
            </p>
          )}
          {entry.repo_url ? (
            <p>
              Source repository: <a href={entry.repo_url} rel="noopener noreferrer">{entry.repo_url}</a>
            </p>
          ) : null}
          {d.canMaintain ? (
            <form method="post" action={`/.tool/${entry.id}/names/claim`} class="row">
              <input name="name" placeholder="additional name" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
              <button type="submit">Add name</button>
            </form>
          ) : null}
        </section>

        <section class="card">
          <h2>Lineage</h2>
          {d.lineage.original ? (
            <p>
              Copied from{" "}
              {d.lineage.original.entry ? <a href={`/.tool/${d.lineage.original.entry.id}`}>{d.lineage.original.entry.title}</a> : <span class="muted">a removed tool</span>}
              {d.lineage.original.entry ? ` by ${d.lineage.original.entry.creator_name}` : ""}.
              {" "}The copy's maintainer is responsible for this adaptation.
            </p>
          ) : (
            <p class="muted">Original work (not a copy).</p>
          )}
          {d.lineage.copies.length ? (
            <>
              <p>Copies made from this tool:</p>
              <ul>
                {d.lineage.copies.map((c) => (
                  <li>
                    <a href={`/.tool/${c.id}`}>{c.title}</a> by {c.creator_name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>

      {entry.mode === "hosted" ? (
        <section class="card">
          <h2>Versions</h2>
          {!d.versions.length ? (
            <p class="muted">
              Nothing published yet. Publish with <code>npx kitlane publish ./dist --name {primary}</code>.
            </p>
          ) : (
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
                      v{v.number} {d.active?.id === v.id ? <span class="badge active">active</span> : null}
                      {v.removed ? <span class="badge frozen">content removed</span> : null}
                    </td>
                    <td>{formatDate(v.created_at)}</td>
                    <td>{v.created_by_name ?? "—"}</td>
                    <td>{v.file_count}</td>
                    <td>{formatBytes(v.total_bytes)}</td>
                    <td>{v.note ?? ""}</td>
                    <td class="row">
                      {!v.removed ? <a href={`/.tool/${entry.id}/download/${v.id}`}>download</a> : null}
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
                          <input name="reason" placeholder="reason" required />
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
          )}
          {d.history.length ? (
            <details>
              <summary>Deployment history</summary>
              <ul class="plain">
                {d.history.map((h) => (
                  <li>
                    {formatDate(h.at)} · {h.action} {h.version_number ? `v${h.version_number}` : ""} by {h.actor_name ?? "system"} (revision {h.revision})
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {entry.mode === "hosted" ? (
        <section class="card">
          <h2>Shared collections</h2>
          <p class="muted">
            Shared collections are readable by <strong>everyone signed in to this installation</strong>, including through other tools. Writing requires an authorized user and an allowed tool context.
          </p>
          {d.bindings.length ? (
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
                      <td>{col?.owner_name ?? "—"}</td>
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
          ) : (
            <p class="muted">This tool has no shared collections bound.</p>
          )}
          {d.canMaintain ? (
            <div class="two-col">
              <form method="post" action={`/.tool/${entry.id}/collections`} class="stack">
                <h3>Create a shared collection</h3>
                <label>
                  Name <input name="name" pattern="[a-z0-9][a-z0-9_-]*" required placeholder="company-briefs" />
                </label>
                <label>
                  Description <input name="description" maxlength={500} />
                </label>
                <p class="muted">Everyone in this installation will be able to read it. {entry.owner_name} will own it.</p>
                <button type="submit">Create collection</button>
              </form>
              <form method="post" action={`/.tool/${entry.id}/bindings/bind`} class="stack">
                <h3>Bind an existing collection (read reference)</h3>
                <label>
                  Binding name <input name="binding" pattern="[a-z0-9][a-z0-9_-]*" required />
                </label>
                <label>
                  Collection ID <input name="collectionId" required />
                </label>
                <button type="submit">Bind</button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {d.canMaintain ? (
        <section class="card">
          <h2>Maintain</h2>
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
                  Destination URL <input name="externalUrl" type="url" value={entry.external_url ?? ""} required />
                </label>
              ) : null}
              <button type="submit">Save</button>
            </form>
            <div class="stack">
              <form method="post" action={`/.tool/${entry.id}/lifecycle`} class="stack">
                <h3>Lifecycle</h3>
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
                <input name="replacement" placeholder="replacement tool ID (when retiring)" value={entry.replacement_entry_id ?? ""} />
                <button type="submit">Update lifecycle</button>
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
        </section>
      ) : null}

      {user.is_admin ? (
        <section class="card admin">
          <h2>Administrator</h2>
          <div class="row">
            <form method="post" action={`/.tool/${entry.id}/freeze`} class="row">
              <input type="hidden" name="frozen" value={entry.frozen ? "0" : "1"} />
              {!entry.frozen ? <input name="reason" placeholder="reason (shown to users)" /> : null}
              <button type="submit" class={entry.frozen ? "" : "danger"}>
                {entry.frozen ? "Unfreeze" : "Freeze"}
              </button>
            </form>
            <form method="post" action={`/.tool/${entry.id}/featured`} class="row">
              <input type="hidden" name="featured" value={entry.featured ? "0" : "1"} />
              <button type="submit">{entry.featured ? "Unfeature" : "Feature in recommendations"}</button>
            </form>
            <form method="post" action={`/.tool/${entry.id}/recover`} class="row">
              <input name="user" placeholder="recover ownership to (user ID or email)" required />
              <button type="submit" class="danger">
                Recover ownership
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {d.canMaintain && d.audit.length ? (
        <section class="card">
          <details>
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
        </section>
      ) : null}
    </Layout>
  );
}

export function copyPage(config: Config, user: User, source: EntryWithNames, error?: string) {
  return (
    <Layout config={config} title={`Copy ${source.title}`} user={user}>
      <section class="card narrow">
        <h1>Make a copy of {source.title}</h1>
        <p>
          The published files (HTML, JavaScript, CSS, assets) are duplicated into a new tool under your ownership with its own name and origin. {source.creator_name} stays credited as the original creator through visible lineage. You become responsible for the adaptation.
        </p>
        <ul>
          <li>The copy starts with fresh personal storage; it cannot read the original's personal records.</li>
          <li>Shared-collection bindings are kept as read references to the same data. No writing rights are inherited.</li>
          <li>Backends and external services not present in the files are not reproduced.</li>
        </ul>
        {error ? <p class="error">{error}</p> : null}
        <form method="post" action={`/.tool/${source.id}/copy`} class="stack">
          <label>
            New name <span class="muted">({config.shortcut}/…)</span>
            <input name="name" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength={2} maxlength={63} />
          </label>
          <label>
            Title <input name="title" value={`${source.title} (copy)`} maxlength={120} />
          </label>
          <button type="submit" class="primary">
            Create copy
          </button>
        </form>
        <p class="muted">
          After copying, download the files, ask your preferred agent or builder to make changes, and republish with <code>npx kitlane publish</code>.
        </p>
      </section>
    </Layout>
  );
}

export function collectionPage(config: Config, user: User, col: SharedCollection & { owner_name: string }, originTool: EntryWithNames | null, boundTools: { entry: EntryWithNames; binding: string }[], grants: WriterGrant[], updaters: UpdaterCredential[], audit: AuditEvent[], canManage: boolean, docCount: number, newUpdaterToken: string | null, flash?: string | null, error?: string | null) {
  return (
    <Layout config={config} title={`Collection ${col.name}`} user={user}>
      <section class="tool-head">
        <div>
          <h1>
            {col.name} <span class="muted">shared collection</span>
          </h1>
          <p>{col.description || <span class="muted">No description.</span>}</p>
          <div class="entry-meta">
            <span>
              ID <code>{col.id}</code>
            </span>
            <span>Owner: {col.owner_name}</span>
            <span>Origin tool: {originTool ? <a href={`/.tool/${originTool.id}`}>{originTool.title}</a> : "—"}</span>
            <span>Documents: {docCount}</span>
            <span>Revision: {col.revision}</span>
            {col.frozen ? <span class="badge frozen">frozen</span> : null}
          </div>
        </div>
      </section>
      {flash ? <p class="notice">{flash}</p> : null}
      {error ? <p class="error">{error}</p> : null}
      <p class="notice">
        <strong>Sharing rule:</strong> every authenticated member of this installation can read this collection through any registered tool. Only the owner, granted writers (in allowed tool contexts), and scoped updater credentials can write.
      </p>
      <div class="two-col">
        <section class="card">
          <h2>Tools that bind this collection</h2>
          <ul class="plain">
            {boundTools.map((b) => (
              <li>
                <a href={`/.tool/${b.entry.id}`}>{b.entry.title}</a> as <code>{b.binding}</code>
                {b.entry.id === col.origin_tool_id ? <span class="badge">originating · may write</span> : <span class="muted"> · read reference</span>}
              </li>
            ))}
          </ul>
        </section>
        <section class="card">
          <h2>Writer grants</h2>
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
                <td>user</td>
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
                  <td>{g.grant_type}</td>
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
          {canManage ? (
            <form method="post" action={`/.collection/${col.id}/grants`} class="row">
              <select name="type">
                <option value="user">User may write</option>
                <option value="tool">Tool is a writer context</option>
              </select>
              <input name="subject" placeholder="user ID/email or tool ID" required />
              <button type="submit">Grant</button>
            </form>
          ) : null}
          <p class="muted">A browser write succeeds only when the user is a writer AND the tool is an allowed context. Opening an editor tool does not make its visitors writers.</p>
        </section>
      </div>
      {canManage ? (
        <section class="card">
          <h2>Updater credentials</h2>
          <p class="muted">For an external process (a script, a scheduled job elsewhere) that refreshes this collection. Scoped to named collections and operations; cannot reach personal storage or publish tools. Keep it out of published HTML and JavaScript.</p>
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
            <select name="operations" multiple size={4} aria-label="Operations">
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
                    <td>{u.last_used_at ? formatDate(u.last_used_at) : "—"}</td>
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
          ) : null}
        </section>
      ) : null}
      {canManage ? (
        <section class="card">
          <h2>Manage</h2>
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
        </section>
      ) : null}
      {canManage && audit.length ? (
        <section class="card">
          <details>
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
        </section>
      ) : null}
    </Layout>
  );
}

export function nameHistoryPage(config: Config, user: User, name: string, current: NameRow | null, currentEntry: EntryWithNames | null, history: NameHistoryRow[]) {
  return (
    <Layout config={config} title={`History of ${config.shortcut}/${name}`} user={user}>
      <section class="card narrow">
        <h1>
          {config.shortcut}/{name}
        </h1>
        {current?.entry_id && currentEntry ? (
          <p>
            Currently points to <a href={`/.tool/${currentEntry.id}`}>{currentEntry.title}</a>.
          </p>
        ) : current?.reserved ? (
          <p>Reserved by an administrator.</p>
        ) : (
          <p>
            Not currently in use. <a href={`/.new?name=${encodeURIComponent(name)}`}>Claim it</a>.
          </p>
        )}
        <h2>Name history</h2>
        <p class="muted">Name history is kept separately from deployment history. Renaming never moves a tool's identity, browser storage, or permissions.</p>
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

export function adminPage(config: Config, user: User, frozenEntries: EntryWithNames[], reserved: NameRow[], recentAudit: AuditEvent[], flash?: string | null, error?: string | null) {
  return (
    <Layout config={config} title="Administration" user={user}>
      <section>
        <h1>Administration</h1>
        {flash ? <p class="notice">{flash}</p> : null}
        {error ? <p class="error">{error}</p> : null}
        <div class="two-col">
          <section class="card">
            <h2>Frozen tools</h2>
            {frozenEntries.length ? (
              <ul class="plain">
                {frozenEntries.map((e) => (
                  <li>
                    <a href={`/.tool/${e.id}`}>{e.title}</a> <span class="muted">{e.frozen_reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted">None.</p>
            )}
            <p class="muted">Freeze a tool from its detail page. Freezing blocks fresh asset and SDK access by short link and direct URL.</p>
          </section>
          <section class="card">
            <h2>Reserved names</h2>
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
            <form method="post" action="/.admin/names/reserve" class="row">
              <input name="name" placeholder="name to reserve" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
              <button type="submit">Reserve</button>
            </form>
          </section>
        </div>
        <div class="two-col">
          <section class="card">
            <h2>Measurement</h2>
            <p>
              <a href="/.admin/measurement">Discovery measurement report</a>
            </p>
            <h2>Export</h2>
            <p>
              <a href="/.export">Download catalog export (JSON)</a> · includes catalog entries, names, ownership, lineage, and shared bindings; never personal records or credentials.
            </p>
            <p>
              <a href="/.export?includeShared=1">Export including shared collection documents</a>
            </p>
          </section>
          <section class="card">
            <h2>Users</h2>
            <form method="post" action="/.admin/users/admin" class="row">
              <input name="user" placeholder="user ID or email" required />
              <select name="isAdmin">
                <option value="1">grant admin</option>
                <option value="0">revoke admin</option>
              </select>
              <button type="submit">Apply</button>
            </form>
          </section>
        </div>
        <section class="card">
          <details open>
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
        </section>
      </section>
    </Layout>
  );
}

export function measurementPage(config: Config, user: User, report: MeasurementReport) {
  const s = report.stages;
  return (
    <Layout config={config} title="Discovery measurement" user={user}>
      <section>
        <h1>Discovery measurement</h1>
        <p class="muted">Since {formatDate(report.since)}. Pseudonymous identifiers only; no prompt text, tool inputs, or query strings are recorded.</p>
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Opportunity (rail rendered)</span>
            <span class="stat-value">{s.opportunity}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Engagement (drawer opened)</span>
            <span class="stat-value">{s.engagement}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Discovery (recommendation launched)</span>
            <span class="stat-value">{s.discovery}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Tool access events</span>
            <span class="stat-value">{s.accessEvents}</span>
          </div>
        </div>
        <h2>North star</h2>
        <table class="table">
          <tbody>
            <tr>
              <td>Eligible users with at least one rail opportunity</td>
              <td>{report.cohort.usersWithRailOpportunity}</td>
            </tr>
            <tr>
              <td>User/tool pairs whose first recorded launch came through the rail</td>
              <td>{report.railOriginated.pairs}</td>
            </tr>
            <tr>
              <td>…of which returned on a later day within 7 days</td>
              <td>{report.railOriginated.returningWithin7Days}</td>
            </tr>
            <tr>
              <td>…of which cross-team (user team ≠ creator team, both known)</td>
              <td>
                <strong>{report.railOriginated.crossTeamReturning}</strong>
              </td>
            </tr>
            <tr>
              <td>…with unknown team attribution (reported separately)</td>
              <td>{report.railOriginated.unknownTeamReturning}</td>
            </tr>
          </tbody>
        </table>
        <h2>Launches by source tool</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Source tool</th>
              <th>Recommendation launches</th>
            </tr>
          </thead>
          <tbody>
            {report.bySourceTool.map((r) => (
              <tr>
                <td>
                  <a href={`/.tool/${r.source_entry_id}`}>{r.title}</a>
                </td>
                <td>{r.launches}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Interpretation limits</h2>
        <ul>
          {report.notes.map((n) => (
            <li>{n}</li>
          ))}
        </ul>
      </section>
    </Layout>
  );
}

export function drawerFragment(config: Config, current: EntryWithNames, maintainers: string[], recs: Recommendation[], canCopy: boolean) {
  return (
    <div class="drawer-content">
      <section class="drawer-this" aria-labelledby="kl-this-heading">
        <h2 id="kl-this-heading">This tool</h2>
        <p class="drawer-title">{current.title}</p>
        {current.purpose ? <p class="entry-purpose">{current.purpose}</p> : null}
        <p class="muted small">
          Created by {current.creator_name}
          {current.creator_team ? ` (${current.creator_team})` : ""} · maintained by {maintainers.join(", ")} · <span class={`badge lifecycle-${current.lifecycle}`}>{current.lifecycle}</span>
        </p>
        <p class="drawer-links">
          <a href={`${portalOrigin(config)}/.tool/${current.id}`} target="_top">
            Details
          </a>
          {canCopy ? (
            <a href={`${portalOrigin(config)}/.tool/${current.id}/copy`} target="_top">
              Make a copy
            </a>
          ) : null}
          <a href={toolOrigin(config, current.id) + "/"} target="_blank" rel="noopener" data-kl-direct>
            Open directly
          </a>
        </p>
      </section>
      <section aria-labelledby="kl-recs-heading">
        <h2 id="kl-recs-heading">You might also use</h2>
        {recs.length ? (
          <div class="drawer-cards">
            {recs.map((r, i) => (
              <EntryCard entry={r.entry} config={config} reason={r.reason} reasonKey={r.reasonKey} placement={i + 1} source={current.id} />
            ))}
          </div>
        ) : (
          <p class="muted">No other tools yet.</p>
        )}
        <p class="muted small">Cards are ranked by shared purpose tags, creator, and recency. Popularity is not approval.</p>
      </section>
      <section class="drawer-footer">
        <a href={`${portalOrigin(config)}/.search`} target="_top">
          Search all tools
        </a>
        <a href={`${portalOrigin(config)}/`} target="_top">
          Browse all tools
        </a>
      </section>
    </div>
  );
}
