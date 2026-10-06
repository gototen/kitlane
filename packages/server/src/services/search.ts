import type { Queryable } from "../db/index.js";
import type { EntryWithNames } from "../types.js";

const ENTRY_SELECT = `
  SELECT e.*,
    COALESCE((SELECT json_agg(n.name ORDER BY n.claimed_at) FROM names n WHERE n.entry_id = e.id), '[]'::json) AS names,
    cu.display_name AS creator_name, cu.team AS creator_team, ou.display_name AS owner_name
  FROM entries e
  JOIN users cu ON cu.id = e.creator_id
  JOIN users ou ON ou.id = e.owner_id`;

export interface SearchOptions {
  query: string;
  kind?: "tool" | "resource" | null;
  creatorId?: string | null;
  tag?: string | null;
  lifecycle?: string | null;
  includeRetired?: boolean;
  limit?: number;
}

/**
 * Catalog search over names, titles, purposes, tags, creators, and team metadata.
 * Ranking is deliberately explainable: exact name, name prefix, title, then purpose/tags/people.
 */
export async function searchEntries(q: Queryable, opts: SearchOptions): Promise<EntryWithNames[]> {
  const term = opts.query.trim().toLowerCase();
  const params: unknown[] = [];
  const where: string[] = [];
  let rank = "0";
  if (term) {
    params.push(term);
    const t = `$${params.length}`;
    params.push(`%${term}%`);
    const like = `$${params.length}`;
    params.push(`${term}%`);
    const prefix = `$${params.length}`;
    where.push(`(
      EXISTS (SELECT 1 FROM names n WHERE n.entry_id = e.id AND n.name LIKE ${like})
      OR lower(e.title) LIKE ${like} OR lower(e.purpose) LIKE ${like}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.tags) tg WHERE tg LIKE ${like})
      OR lower(cu.display_name) LIKE ${like} OR lower(COALESCE(e.team, '')) LIKE ${like} OR lower(COALESCE(cu.team, '')) LIKE ${like}
    )`);
    rank = `(
      CASE WHEN EXISTS (SELECT 1 FROM names n WHERE n.entry_id = e.id AND n.name = ${t}) THEN 100 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM names n WHERE n.entry_id = e.id AND n.name LIKE ${prefix}) THEN 40 ELSE 0 END
      + CASE WHEN lower(e.title) LIKE ${prefix} THEN 30 WHEN lower(e.title) LIKE ${like} THEN 20 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.tags) tg WHERE tg = ${t}) THEN 15 ELSE 0 END
      + CASE WHEN lower(e.purpose) LIKE ${like} THEN 10 ELSE 0 END
      + CASE WHEN e.kind = 'tool' THEN 5 ELSE 0 END
      + CASE WHEN e.featured THEN 3 ELSE 0 END
    )`;
  }
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`e.kind = $${params.length}`);
  }
  if (opts.creatorId) {
    params.push(opts.creatorId);
    where.push(`e.creator_id = $${params.length}`);
  }
  if (opts.tag) {
    params.push(JSON.stringify([opts.tag.toLowerCase()]));
    where.push(`e.tags @> $${params.length}::jsonb`);
  }
  if (opts.lifecycle) {
    params.push(opts.lifecycle);
    where.push(`e.lifecycle = $${params.length}`);
  } else if (!opts.includeRetired) {
    where.push(`e.lifecycle <> 'retired'`);
  }
  params.push(Math.min(opts.limit ?? 50, 200));
  const r = await q.query<EntryWithNames>(
    `${ENTRY_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${rank} DESC, e.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

export interface Recommendation {
  entry: EntryWithNames;
  reason: string;
  reasonKey: "shared_tag" | "same_creator" | "recent" | "featured";
  score: number;
}

/**
 * Drawer recommendations. Explainable signals only: shared purpose tags, same creator, recent
 * additions, and a small curated (featured) set. At least one card from a different creator or team
 * is surfaced when one exists.
 */
export async function recommendFor(q: Queryable, current: EntryWithNames, limit = 5): Promise<Recommendation[]> {
  const r = await q.query<EntryWithNames>(
    `${ENTRY_SELECT} WHERE e.id <> $1 AND e.kind = 'tool' AND e.lifecycle <> 'retired' AND NOT e.frozen
       AND (e.mode = 'external' OR EXISTS (SELECT 1 FROM deployments d WHERE d.entry_id = e.id AND d.active_version_id IS NOT NULL))
     ORDER BY e.created_at DESC LIMIT 500`,
    [current.id],
  );
  const currentTags = new Set(current.tags);
  const twoWeeksAgo = Date.now() - 14 * 86400_000;
  const scored: Recommendation[] = r.rows.map((e) => {
    const shared = e.tags.filter((t) => currentTags.has(t));
    let score = 0;
    let reasonKey: Recommendation["reasonKey"] = "recent";
    let reason = "Recently added";
    if (shared.length) {
      score += 3 * shared.length;
      reasonKey = "shared_tag";
      reason = `Also about ${shared[0]}`;
    }
    if (e.creator_id === current.creator_id) {
      score += 1;
      if (!shared.length) {
        reasonKey = "same_creator";
        reason = `Also by ${e.creator_name}`;
      }
    }
    if (e.featured) {
      score += 2;
      if (!shared.length && e.creator_id !== current.creator_id) {
        reasonKey = "featured";
        reason = "Featured by your installation";
      }
    }
    if (new Date(e.created_at).getTime() > twoWeeksAgo) {
      score += 1;
    }
    if (e.lifecycle === "maintained") score += 0.5;
    return { entry: e, reason, reasonKey, score };
  });
  scored.sort((a, b) => b.score - a.score || new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());
  const top = scored.slice(0, limit);
  const differs = (rec: Recommendation) => rec.entry.creator_id !== current.creator_id && (rec.entry.creator_team ?? null) !== (current.creator_team ?? null) || (rec.entry.creator_id !== current.creator_id && !current.creator_team);
  if (top.length && !top.some(differs)) {
    const alt = scored.find((rec) => rec.entry.creator_id !== current.creator_id);
    if (alt) {
      top.splice(Math.min(2, top.length), 0, alt);
      // Remove a duplicate if alt already present deeper in the list, then trim.
      const seen = new Set<string>();
      const dedup = top.filter((x) => (seen.has(x.entry.id) ? false : (seen.add(x.entry.id), true)));
      return dedup.slice(0, limit);
    }
  }
  return top;
}

export async function recentEntries(q: Queryable, limit = 12): Promise<EntryWithNames[]> {
  const r = await q.query<EntryWithNames>(`${ENTRY_SELECT} WHERE e.lifecycle <> 'retired' ORDER BY e.created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

export async function allTags(q: Queryable): Promise<{ tag: string; n: number }[]> {
  const r = await q.query<{ tag: string; n: number }>(
    `SELECT tg AS tag, count(*)::int AS n FROM entries e, jsonb_array_elements_text(e.tags) tg WHERE e.lifecycle <> 'retired' GROUP BY tg ORDER BY n DESC, tg LIMIT 50`,
  );
  return r.rows;
}
