import type { Queryable } from "../db/index.js";
import { badRequest } from "../errors.js";

export type DiscoveryEventType = "rail_rendered" | "drawer_opened" | "recommendation_launched" | "tool_accessed" | "portal_launched" | "search";
const TYPES = new Set<DiscoveryEventType>(["rail_rendered", "drawer_opened", "recommendation_launched", "tool_accessed", "portal_launched", "search"]);

export interface DiscoveryEventInput {
  type: DiscoveryEventType;
  userId: string | null;
  sessionKey: string | null;
  sourceEntryId?: string | null;
  targetEntryId?: string | null;
  placement?: number | null;
  reason?: string | null;
  via?: string | null;
  userTeam?: string | null;
}

/**
 * Minimal discovery measurement. Records who (pseudonymous user ID), which entries, event type,
 * placement, and time. Never records prompt text, tool inputs, or query strings.
 */
export async function recordDiscoveryEvent(q: Queryable, input: DiscoveryEventInput): Promise<void> {
  if (!TYPES.has(input.type)) throw badRequest("Unknown discovery event type");
  let targetCreatorTeam: string | null = null;
  if (input.targetEntryId) {
    const r = await q.query<{ team: string | null }>(`SELECT u.team FROM entries e JOIN users u ON u.id = e.creator_id WHERE e.id = $1`, [input.targetEntryId]);
    targetCreatorTeam = r.rows[0]?.team ?? null;
  }
  await q.query(
    `INSERT INTO discovery_events (user_id, session_key, event_type, source_entry_id, target_entry_id, placement, reason, via, user_team, target_creator_team)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.userId,
      input.sessionKey,
      input.type,
      input.sourceEntryId ?? null,
      input.targetEntryId ?? null,
      input.placement ?? null,
      input.reason ? input.reason.slice(0, 80) : null,
      input.via ?? null,
      input.userTeam ?? null,
      targetCreatorTeam,
    ],
  );
}

export type MeasurementCohort = "all" | "assigned";

export interface CohortParticipant {
  userId: string;
  name: string;
  email: string | null;
  team: string | null;
  railOpportunities: number;
  drawerOpens: number;
  picksLaunched: number;
  activeDays: number;
  lastSeenAt: string | null;
  discoveries: { targetEntryId: string; title: string; firstAt: string; returned: boolean }[];
}

export interface MeasurementReport {
  since: string;
  cohort: MeasurementCohort;
  stages: { opportunity: number; engagement: number; discovery: number; accessEvents: number };
  eligible: { eligibleUsers: number; usersWithRailOpportunity: number };
  railOriginated: {
    pairs: number;
    returningWithin7Days: number;
    crossTeamReturning: number;
    unknownTeamReturning: number;
  };
  bySourceTool: { source_entry_id: string; title: string; launches: number }[];
  assignedTeams: number;
  /** Present for the assigned-team cohort only: one row per participant, for the facilitator's follow-ups. */
  participants?: CohortParticipant[];
  notes: string[];
}

/**
 * North star: unique user/tool pairs whose first recorded launch of the target came through the
 * rail, where the user's team differs from the target creator's team, and the user returned on a
 * later day within seven days. Creators and maintainers testing their own tools are excluded.
 *
 * The "assigned" cohort limits every measure to people whose team an administrator assigned, which
 * is how a study on a public installation separates its participants from passers-by.
 */
export async function measurementReport(q: Queryable, sinceDays = 30, cohort: MeasurementCohort = "all"): Promise<MeasurementReport> {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const inCohort = (col: string) => (cohort === "assigned" ? ` AND ${col} IN (SELECT id FROM users WHERE team_locked)` : "");
  const stages = await q.query<{ event_type: string; n: number }>(
    `SELECT event_type, count(*)::int AS n FROM discovery_events WHERE at >= $1${inCohort("user_id")} GROUP BY event_type`,
    [since],
  );
  const count = (t: string) => stages.rows.find((r) => r.event_type === t)?.n ?? 0;

  const eligible = await q.query<{ eligible: number; with_rail: number }>(
    `SELECT (SELECT count(*)::int FROM users WHERE ${cohort === "assigned" ? "team_locked" : "TRUE"}) AS eligible,
            (SELECT count(DISTINCT user_id)::int FROM discovery_events WHERE event_type = 'rail_rendered' AND at >= $1${inCohort("user_id")}) AS with_rail`,
    [since],
  );

  // First launch per (user, target), excluding maintainers of the target.
  const railCtes = `WITH launches AS (
       SELECT user_id, target_entry_id, at, event_type, user_team, target_creator_team
       FROM discovery_events
       WHERE at >= $1 AND user_id IS NOT NULL AND target_entry_id IS NOT NULL${inCohort("user_id")}
         AND event_type IN ('recommendation_launched', 'tool_accessed', 'portal_launched')
         AND NOT EXISTS (SELECT 1 FROM maintainers m WHERE m.entry_id = discovery_events.target_entry_id AND m.user_id = discovery_events.user_id)
     ),
     firsts AS (
       SELECT DISTINCT ON (user_id, target_entry_id) user_id, target_entry_id, at AS first_at, event_type AS first_type, user_team, target_creator_team
       FROM launches ORDER BY user_id, target_entry_id, at ASC
     ),
     rail_first AS (
       SELECT rf.*, EXISTS (
         SELECT 1 FROM launches l WHERE l.user_id = rf.user_id AND l.target_entry_id = rf.target_entry_id
           AND l.at > rf.first_at AND l.at <= rf.first_at + interval '7 days'
           AND date_trunc('day', l.at) > date_trunc('day', rf.first_at)
       ) AS returned
       FROM firsts rf WHERE rf.first_type = 'recommendation_launched'
     ),
     returners AS (SELECT * FROM rail_first WHERE returned)`;
  const rail = await q.query<{ pairs: number; returning: number; cross_team: number; unknown_team: number }>(
    `${railCtes}
     SELECT (SELECT count(*)::int FROM rail_first) AS pairs,
            (SELECT count(*)::int FROM returners) AS returning,
            (SELECT count(*)::int FROM returners WHERE user_team IS NOT NULL AND target_creator_team IS NOT NULL AND user_team <> target_creator_team) AS cross_team,
            (SELECT count(*)::int FROM returners WHERE user_team IS NULL OR target_creator_team IS NULL) AS unknown_team`,
    [since],
  );

  const bySource = await q.query<{ source_entry_id: string; title: string; launches: number }>(
    `SELECT d.source_entry_id, e.title, count(*)::int AS launches FROM discovery_events d JOIN entries e ON e.id = d.source_entry_id
     WHERE d.event_type = 'recommendation_launched' AND d.at >= $1${inCohort("d.user_id")} GROUP BY d.source_entry_id, e.title ORDER BY launches DESC LIMIT 20`,
    [since],
  );

  let participants: CohortParticipant[] | undefined;
  if (cohort === "assigned") {
    const people = await q.query<{ id: string; display_name: string; email: string | null; team: string | null; last_seen_at: Date | null; rail: number; drawer: number; picks: number; active_days: number }>(
      `SELECT u.id, u.display_name, u.email, u.team, u.last_seen_at,
              count(d.id) FILTER (WHERE d.event_type = 'rail_rendered')::int AS rail,
              count(d.id) FILTER (WHERE d.event_type = 'drawer_opened')::int AS drawer,
              count(d.id) FILTER (WHERE d.event_type = 'recommendation_launched')::int AS picks,
              count(DISTINCT date_trunc('day', d.at))::int AS active_days
       FROM users u LEFT JOIN discovery_events d ON d.user_id = u.id AND d.at >= $1
       WHERE u.team_locked GROUP BY u.id ORDER BY u.display_name`,
      [since],
    );
    const found = await q.query<{ user_id: string; target_entry_id: string; title: string; first_at: Date; returned: boolean }>(
      `${railCtes}
       SELECT rf.user_id, rf.target_entry_id, e.title, rf.first_at, rf.returned FROM rail_first rf JOIN entries e ON e.id = rf.target_entry_id ORDER BY rf.first_at`,
      [since],
    );
    participants = people.rows.map((p) => ({
      userId: p.id,
      name: p.display_name,
      email: p.email,
      team: p.team,
      railOpportunities: p.rail,
      drawerOpens: p.drawer,
      picksLaunched: p.picks,
      activeDays: p.active_days,
      lastSeenAt: p.last_seen_at ? new Date(p.last_seen_at).toISOString() : null,
      discoveries: found.rows
        .filter((f) => f.user_id === p.id)
        .map((f) => ({ targetEntryId: f.target_entry_id, title: f.title, firstAt: new Date(f.first_at).toISOString(), returned: f.returned })),
    }));
  }

  const assigned = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE team_locked`);
  return {
    since: since.toISOString(),
    cohort,
    assignedTeams: assigned.rows[0].n,
    stages: { opportunity: count("rail_rendered"), engagement: count("drawer_opened"), discovery: count("recommendation_launched"), accessEvents: count("tool_accessed") },
    eligible: { eligibleUsers: eligible.rows[0].eligible, usersWithRailOpportunity: eligible.rows[0].with_rail },
    railOriginated: {
      pairs: rail.rows[0].pairs,
      returningWithin7Days: rail.rows[0].returning,
      crossTeamReturning: rail.rows[0].cross_team,
      unknownTeamReturning: rail.rows[0].unknown_team,
    },
    bySourceTool: bySource.rows,
    participants,
    notes: [
      "A rail-rendered event is an opportunity, not proof the person noticed the rail.",
      "A first recorded launch is not proof the person had never used the tool; confirm prior familiarity in follow-ups.",
      "Pairs with unknown team attribution are reported separately and are not counted as cross-team adoption.",
      "External tools only record platform-mediated launches; their return data is incomplete.",
      "Creators and maintainers of a target tool are excluded from that tool's adoption measures.",
    ],
  };
}

export async function pruneDiscoveryEvents(q: Queryable, retentionDays: number): Promise<number> {
  const r = await q.query(`DELETE FROM discovery_events WHERE at < now() - ($1 || ' days')::interval`, [String(retentionDays)]);
  return r.rowCount;
}
