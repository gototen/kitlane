# Discovery measurement

Minimal measurement of whether the rail leads to discovery, use, and return. The design records who (pseudonymously), which entries, what kind of event, placement, and time. It records no prompt text, tool inputs, or query strings.

## Events

| Event | Recorded by | Meaning |
|---|---|---|
| `rail_rendered` | Shell client (`navigator.sendBeacon` to `/.api/discovery`) | An eligible shell session rendered the visible rail. An opportunity, not proof the person noticed it. |
| `drawer_opened` | Shell client | The person opened the drawer. Engagement. |
| `recommendation_launched` | Shell client, with `targetEntryId`, `placement` (1-based card position), and `reason` (`shared_tag`, `same_creator`, `recent`, `featured`) | A drawer card launched a different tool. Discovery. |
| `tool_accessed` | Server, when a release's `index.html` is served; `via` is `shell` (iframe) or `direct` | A minimal authenticated access event for native tools. Lets later direct launches count as returns. |
| `portal_launched` | Server, when an external entry's short link redirects | The only observable event for external tools; it does not prove the destination was used. |

Each event stores the user's team and the target creator's team as snapshots at that moment, so later team changes do not rewrite history. The browser API accepts only the three client event types; everything else is server-side.

## Pseudonymity and retention

`user_id` is Kitlane's opaque user ID. `session_key` is an HMAC (keyed by `KITLANE_SECRET`) of the session identifier, truncated. These are still potentially personal data: disclose the measurement to participants, define retention, and aggregate before sharing. The control service prunes `discovery_events` older than `KITLANE_DISCOVERY_RETENTION_DAYS` (default 90) every ten minutes while it runs; set it to 0 to keep events indefinitely and manage retention yourself (for example `DELETE FROM discovery_events WHERE at < now() - interval '90 days'`). Aggregate the report before sharing it.

## Stages and the north star

The administrator report at `/.admin/measurement` (optionally `?days=<n>`, default 30) shows:

| Stage | Definition |
|---|---|
| Opportunity | Count of `rail_rendered` |
| Engagement | Count of `drawer_opened` |
| Discovery | Count of `recommendation_launched` |
| Access events | Count of `tool_accessed` |

North star: unique user/tool pairs where the user's **first recorded launch** of the target tool was a `recommendation_launched` event, and the same user has a later launch of that tool (`tool_accessed`, `recommendation_launched`, or `portal_launched`) on a **later calendar day within seven days**. The report shows these pairs, the subset that returned, the subset of returners whose team differs from the target creator's team (both known), and separately the returners with unknown team attribution. It also lists launches by source tool and the cohort size (users with at least one rail opportunity).

Exclusions: launches by a user who is a maintainer of the target tool are excluded from that tool's measures (creators testing their own tools). Obvious automated traffic is not detected automatically; filter it when analysing.

## Interpretation limits (also printed on the report)

- A rail-rendered event is an opportunity, not proof the person noticed the rail.
- A first recorded launch is not proof the person had never used the tool. Ask about prior familiarity neutrally after the task and report confirmed new-to-user discoveries separately.
- Pairs with unknown team attribution are reported separately and are not counted as cross-team adoption.
- External tools only record platform-mediated launches; their return data is incomplete. Supplement with voluntary reports.
- A redirect is not proof the destination was used.

There is no invented numerical success threshold for a first small cohort. The release decision records whether discovery occurred without coaching, whether discovered tools proved useful, where participants got stuck, and whether later use supports a larger pilot. Raw visits, copy counts, and drawer opens are diagnostic signals.

## Pilot protocol (not yet performed)

Summarised from specification section 11; none of it has been run for this release.

1. Recruit a small cohort with a recurring reason to use a seed tool and a plausible reason to use another creator's tool. If team identities or scenarios are simulated, label the result a usability study.
2. Let participants use the first seed tool for a few days before the session so familiarity is real.
3. Initial session: give a task in the familiar tool, starting at its normal shell URL. Do not mention the rail, drawer, portal, or discovering other tools. Observe whether the participant opens the drawer and follows a recommendation. Afterwards ask neutrally what else they noticed; keep prompted recall separate from spontaneous actions.
4. Keep the tools available for seven days. Do not assign a return visit. Record later-day returns and ask neutral questions about usefulness.
5. Report the eligible cohort size, uncoached discoveries, confirmed new-to-user discoveries, returns, and where people got stuck. Do not manufacture a seven-day result for late recruits.

## Running the report

Sign in as an administrator and open `/.admin/measurement`. Programmatically, `measurementReport(db, days)` in `packages/server/src/services/discovery.ts` returns the same structure as JSON.

## Assigned teams for studies

When participants sign in with accounts that carry no team (personal Google accounts, for example), an administrator can assign a team label to a user on the `/.admin` page. The label is kept on later sign-ins until cleared, and the measurement report states how many users have assigned teams. Results computed from assigned teams are a usability study result: report them as "cross-team" only with that label attached, never as organizational adoption. Snapshots taken at discovery time use whatever team the user had then, so assign teams before the study sessions start.
