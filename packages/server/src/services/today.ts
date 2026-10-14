import type { Queryable } from "../db/index.js";
import type { EntryWithNames } from "../types.js";

/**
 * The Today page: a few hand-sized stories picked by rules an administrator can override with the
 * featured flag, then lists. Every pick has a plain reason so the page never pretends to be curated
 * when it is not. Nothing here is ranked by popularity.
 */

export interface TodayEntry extends EntryWithNames {
  original_title: string | null;
  original_creator_name: string | null;
  active_version_id: string | null;
}

export type StorySlot = "featured" | "newest" | "remix" | "team" | "steady";

export interface TodayStory {
  slot: StorySlot;
  /** The numbered label beside the index: "Featured", "New this week", "New from Finance"... */
  label: string;
  entry: TodayEntry;
  /** One sentence under the title, in the maker's terms. */
  deck: string;
  /** Who made it and where it lives. */
  byline: string;
}

export interface TodayData {
  date: Date;
  stories: TodayStory[];
  collection: { tag: string; entries: TodayEntry[] } | null;
  mine: EntryWithNames[];
  links: TodayEntry[];
  counts: { newTools: number; newRemixes: number; days: number };
  totalTools: number;
}

const SELECT = `
  SELECT e.*,
    COALESCE((SELECT json_agg(n.name ORDER BY n.claimed_at) FROM names n WHERE n.entry_id = e.id), '[]'::json) AS names,
    cu.display_name AS creator_name, cu.team AS creator_team, ou.display_name AS owner_name,
    o.title AS original_title, oc.display_name AS original_creator_name,
    d.active_version_id
  FROM entries e
  JOIN users cu ON cu.id = e.creator_id
  JOIN users ou ON ou.id = e.owner_id
  LEFT JOIN entries o ON o.id = e.copied_from_entry_id
  LEFT JOIN users oc ON oc.id = o.creator_id
  LEFT JOIN deployments d ON d.entry_id = e.id`;

/** Tools that can be opened right now: not retired, not frozen, external or with an active release. */
const LAUNCHABLE = `e.kind = 'tool' AND e.lifecycle <> 'retired' AND NOT e.frozen AND (e.mode = 'external' OR d.active_version_id IS NOT NULL)`;

export function bylineFor(e: TodayEntry, shortcut: string): string {
  const who = e.creator_team ? `${e.creator_name}, ${e.creator_team}` : e.creator_name;
  return `${who} · ${shortcut}/${e.names[0] ?? e.id}`;
}

export function remixByline(e: TodayEntry, shortcut: string): string {
  const who = e.creator_team ? `${e.creator_name}, ${e.creator_team}` : e.creator_name;
  const original = e.original_title ? ` · remix of ${e.original_creator_name ? `${e.original_creator_name}’s ` : ""}${e.original_title}` : "";
  return `${who}${original} · ${shortcut}/${e.names[0] ?? e.id}`;
}

export async function buildToday(q: Queryable, userId: string, shortcut: string, now: Date = new Date()): Promise<TodayData> {
  const [launchable, mine, links, tagRows] = await Promise.all([
    q.query<TodayEntry>(`${SELECT} WHERE ${LAUNCHABLE} ORDER BY e.featured DESC, e.updated_at DESC, e.created_at DESC LIMIT 200`),
    q.query<EntryWithNames>(
      `SELECT e.*, COALESCE((SELECT json_agg(n.name ORDER BY n.claimed_at) FROM names n WHERE n.entry_id = e.id), '[]'::json) AS names,
         cu.display_name AS creator_name, cu.team AS creator_team, ou.display_name AS owner_name
       FROM entries e JOIN users cu ON cu.id = e.creator_id JOIN users ou ON ou.id = e.owner_id
       WHERE e.lifecycle <> 'retired' AND (e.owner_id = $1 OR EXISTS (SELECT 1 FROM maintainers m WHERE m.entry_id = e.id AND m.user_id = $1))
       ORDER BY e.updated_at DESC LIMIT 6`,
      [userId],
    ),
    q.query<TodayEntry>(`${SELECT} WHERE e.kind = 'resource' AND e.lifecycle <> 'retired' AND NOT e.frozen ORDER BY e.created_at DESC LIMIT 6`),
    q.query<{ tag: string; n: number }>(
      `SELECT tg AS tag, count(*)::int AS n FROM entries e LEFT JOIN deployments d ON d.entry_id = e.id, jsonb_array_elements_text(e.tags) tg
       WHERE ${LAUNCHABLE} GROUP BY tg HAVING count(*) >= 2 ORDER BY n DESC, tg LIMIT 1`,
    ),
  ]);
  const pool = launchable.rows;
  const used = new Set<string>();
  const take = (pred: (e: TodayEntry) => boolean): TodayEntry | null => {
    const hit = pool.find((e) => !used.has(e.id) && pred(e));
    if (hit) used.add(hit.id);
    return hit ?? null;
  };
  const stories: TodayStory[] = [];
  const byCreated = [...pool].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const newestFirst = (pred: (e: TodayEntry) => boolean) => {
    const hit = byCreated.find((e) => !used.has(e.id) && pred(e));
    if (hit) used.add(hit.id);
    return hit ?? null;
  };

  // 1. Featured (an administrator's pick) wins the lead; otherwise the newest original tool.
  const featured = take((e) => e.featured);
  if (featured) {
    stories.push({ slot: "featured", label: "Featured", entry: featured, deck: featured.purpose, byline: bylineFor(featured, shortcut) });
  } else {
    const newest = newestFirst((e) => !e.copied_from_entry_id);
    if (newest) stories.push({ slot: "newest", label: "Newest on the shelf", entry: newest, deck: newest.purpose, byline: bylineFor(newest, shortcut) });
  }
  // 2. The newest remix, with its lineage in the byline.
  const remix = newestFirst((e) => Boolean(e.copied_from_entry_id));
  if (remix) stories.push({ slot: "remix", label: "Newest remix", entry: remix, deck: remix.purpose, byline: remixByline(remix, shortcut) });
  // 3. Something from a team not yet on the page.
  const teamsShown = new Set(stories.map((s) => s.entry.creator_team).filter(Boolean));
  const fromElsewhere = newestFirst((e) => Boolean(e.creator_team) && !teamsShown.has(e.creator_team));
  if (fromElsewhere) stories.push({ slot: "team", label: `New from ${fromElsewhere.creator_team}`, entry: fromElsewhere, deck: fromElsewhere.purpose, byline: bylineFor(fromElsewhere, shortcut) });
  // 4. The oldest maintained tool still on the shelf: the one people stopped noticing.
  const steady = [...pool].filter((e) => !used.has(e.id) && e.lifecycle === "maintained").sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0] ?? null;
  if (steady) {
    used.add(steady.id);
    stories.push({ slot: "steady", label: "Worth a second look", entry: steady, deck: steady.purpose, byline: bylineFor(steady, shortcut) });
  }
  // Fill to four with whatever is newest when the catalog is small.
  while (stories.length < 4) {
    const next = newestFirst(() => true);
    if (!next) break;
    stories.push({ slot: "newest", label: next.copied_from_entry_id ? "Also new" : "Also on the shelf", entry: next, deck: next.purpose, byline: bylineFor(next, shortcut) });
  }

  const topTag = tagRows.rows[0]?.tag ?? null;
  const collection = topTag ? { tag: topTag, entries: pool.filter((e) => e.tags.includes(topTag)).slice(0, 5) } : null;

  const days = 7;
  const since = now.getTime() - days * 86400_000;
  const recent = pool.filter((e) => new Date(e.created_at).getTime() >= since);
  return {
    date: now,
    stories,
    collection,
    mine: mine.rows,
    links: links.rows,
    counts: { newTools: recent.filter((e) => !e.copied_from_entry_id).length, newRemixes: recent.filter((e) => Boolean(e.copied_from_entry_id)).length, days },
    totalTools: pool.length,
  };
}
