# Pilot study runbook

This is the operator's plan for the first discovery study on the public demo at https://kit.kitlane.dev. It applies the protocol in [measurement.md](../measurement.md) and specification section 11 to the setup chosen on 2026-10-15.

| Decision | Choice | Consequence |
|---|---|---|
| Cohort | A small group of friends and peers (3–6) signing in with personal Google accounts | Teams are assigned by the administrator, so every result is a **usability study** result, never cross-team or organizational adoption. |
| Timing | Decoupled from the 2026-10-24 release | The release notes say the pilot is in progress. Each participant gets a full seven-day window; nobody's window is shortened to meet a date. |
| Tools | The seed examples as they are: `kit/focus` is the familiar tool; `kit/meet`, `kit/prep`, `kit/briefs-editor` and `kit/statuspage` are there to be discovered | Focus is the only seed tool with a recurring reason to use it outside a scenario. Prep's companies are fictional, so any value it shows is a usability signal only. |
| Environment | The public demo, with passers-by filtered out by cohort | The measurement report's **study cohort** view counts only people with assigned teams. The demo must not be reset until the last follow-up is done. |

Materials in this folder:

- [invitation.md](invitation.md): the invitation, the measurement disclosure, and the reminder and follow-up messages.
- [session-guide.md](session-guide.md): the facilitator script, observation sheet, and neutral questions.
- [results-template.md](results-template.md): the write-up, structured the way section 11 asks for.

Filled-in observation sheets, the participant roster, and anything else that names people are personal data. Keep them outside the repository. `pilot-records/` at the repository root is gitignored if you want a local folder.

## Before the first invitation

1. **Nightly reset stays off.** On the server, `/etc/cron.d/kitlane-demo-reset` must not exist. Do not run `deploy/compose/scripts/reset-demo.sh` until the study closes; it deletes accounts, assigned teams, and every discovery event.
2. **Google sign-in admits the participants.** In the Google Cloud console, open the OAuth consent screen for the demo's client. If the publishing status is *Testing*, add each participant's Google address under *Test users* before you invite them, or they will be refused at sign-in. If it is *In production*, nothing to do.
3. **Privacy notice is current.** https://kitlane.dev/privacy.html (from `site/privacy.html`) has an *Invited study participants* section and says scheduled resets are paused. The invitation links to it.
4. **Feature `kit/prep`.** Sign in as the administrator, open `kit/prep`'s details page, and use *Feature on Today and in the rail*. Featuring changes what the drawer recommends, so do it now, before anyone's familiarity days begin, and leave it alone until the study ends.
5. **Look at the familiar tool's drawer once.** Open https://kit.kitlane.dev/focus, open the drawer, and note the cards and their order in the observation sheet header (expected, from the scoring in `services/search.ts`: Meeting time finder, "Also about productivity", then the featured Pre-call brief). Skip in Focus doesn't log a session, which is why the session task uses a one-minute run. If the cards change mid-study, note when.
6. **Don't touch the seed tools.** No new versions, renames, freezes, or lifecycle changes to the seed entries during the study. If something must change, note the date and time in the results.
7. **Check the report works.** Open https://kit.kitlane.dev/.admin/measurement?cohort=assigned. It should say *study cohort (0 with assigned teams)*.

Your own administrator account is not in the cohort. Never assign yourself a team, and don't use Focus or the drawer from your account during sessions, because the *everyone* view counts you.

## Per participant

Day 0 is the observed session. Plan backwards from a date that suits the participant.

| Day | What happens | Who |
|---|---|---|
| D−5 to D−3 | Send the invitation. The participant signs in once at https://kit.kitlane.dev/focus. | Operator, participant |
| Same day | Assign the participant's team at `/.admin` (*People → Assign a team*, by email). Do it before they use Focus for real: events record the team at the moment they happen, and earlier events stay unattributed. | Operator |
| D−3 to D−1 | The participant uses Focus during ordinary work on at least two days. No other tasks, no tour. | Participant |
| D0 | The 20–30 minute observed session, following [session-guide.md](session-guide.md). | Operator, participant |
| D1 to D7 | Nothing assigned. No reminders about other tools. | — |
| D8 | The follow-up message, or a ten-minute call, from [invitation.md](invitation.md). Then fill in the participant's row in the results. | Operator |

**Choosing the team label.** Use a short label for what the person actually does ("design", "teaching", "operations"), and record the reason in your roster. Don't pick labels to make the cross-team count bigger. For reference, the seed tools' creators are synthetic users: Pre-call brief is finance, Briefs editor is research, Focus timer is marketing, and Meeting time finder and the status page are engineering. If someone's honest label matches one of those, keep it.

**Discovery before the session.** A participant may open the drawer and try another tool during the familiarity days. That counts as uncoached discovery through ordinary use, the very thing being measured, so record it. Don't treat it as a protocol failure, and don't tell them to avoid the drawer.

## During the study

- Check `/.admin/measurement?cohort=assigned&days=60` after each session and before each follow-up. The *Study participants* table shows active days, rail opportunities, drawer opens, picks launched, and each tool a person first reached through the rail, marked *returned* when they came back on a later day within seven days.
- That table names people, so it's for you as the facilitator only. Aggregate before sharing anything.
- Retention is 90 days by default (`KITLANE_DISCOVERY_RETENTION_DAYS`). Write the results up before the earliest events age out, or raise the setting.
- If someone withdraws, clear their team, delete their events (`DELETE FROM discovery_events WHERE user_id = '<id>'`), ask if they also want their account removed, and report the withdrawal as a count only.

## Closing the study

1. When the last participant's D8 has passed, export the cohort report (save the page, or call `measurementReport(db, days, "assigned")`) and fill in [results-template.md](results-template.md).
2. Put the aggregated result in `RELEASE-NOTES.md` under *Verified*, labelled as a usability study with assigned teams and synthetic content.
3. Tell participants the study is over and thank them. Then decide whether to reset the demo and whether to restore the nightly reset cron. The privacy notice tells participants the demo is reset when the study ends, so a reset needs a deliberate go-ahead, and so does keeping their data.
