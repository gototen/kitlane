# Session guide (D0)

The session takes 20–30 minutes, over a screen-shared call or in person. The participant uses their own browser and is already signed in. You observe and take notes. Ask before recording anything; notes alone are enough.

The one rule: **don't mention, point to, or look meaningfully at the rail, the drawer, recommendations, Today, or other tools** before the task is over. If they ask what something is, answer "What do you think it is?" or "Whatever you'd normally do is fine." Keep anything they say before you prompt (spontaneous) separate from anything they say after you prompt (prompted).

## Script

**Opening (2 min).**

> Thanks for doing this. I'm going to give you a small task with the focus timer you've been using. Please think aloud as you go. There are no wrong moves, and I'm testing the software, not you. I'll mostly stay quiet.

**Start.** Ask them to go to https://kit.kitlane.dev/focus. If they're already there, have them reload. Note how they got there: typed it, a bookmark, browser history, or Today.

**Task (10–15 min).** Read it aloud once and paste it into the chat:

> Set the timer up the way you'd want it for tomorrow's work: focus and break lengths, and a label for what you'll be working on. Then tell me how many focus sessions you've logged this week, and what the most recent one was for. Finally, set the focus length to 1 minute, run one session to the end, and put your real length back.

Stay silent while they work. Answer only questions about the task wording.

**After the task (3 min).** Say "Thanks, that's the task done," and then say nothing for up to three minutes while they wrap up in their own way. Don't suggest exploring. Write down what they do.

**Neutral questions (5–10 min).** Ask in this order, and stop prompting once you reach the prompted section:

1. "How did that go?" *(spontaneous)*
2. "Was anything on the screen confusing or in your way?" *(spontaneous)*
3. "Did you notice anything else on the page besides the timer?" *(prompted; record their answer, and if they say no, leave it there. Don't show them.)*
4. Only if they opened another tool: "You opened [tool]. Had you used it, or something like it, before today?" *(prior familiarity)*
5. Only if they opened another tool: "Was it useful for anything, or might it be?" *(value)*

**Close.** "That's it. Keep using whatever you like on the demo, or nothing at all. I'll send you two or three short questions in about a week." Don't ask them to come back to any tool.

## Observation sheet

Copy this into your own notes for each participant, outside the repository.

```text
Participant code:            (P1, P2, ...; the name lives only in your roster)
Assigned team label:          (and why)
Session date/time (UTC):
Familiarity days before D0:   (from the report: active days before the session)
Drawer cards on focus at D0:  (titles in order, with the reason shown)

Arrival
  How they reached kit/focus:

Task
  Completed?  Y / N / partly        Time taken:
  Stuck points (time, what, how resolved):

Rail and drawer: spontaneous only, before prompting
  Looked at or hovered the rail?  Y / N   (when)
  Opened the drawer?              Y / N   (when, during task / after task)
  Launched a card?                Y / N   (which, position, reason shown)
  What they did in the other tool:
  Came back to focus?             Y / N
  Remarks, verbatim:

Prompted recall (after question 3)
  What they said they noticed:

Prior familiarity (question 4):
Value, as they put it (question 5):

Anything else (bugs, confusion, design remarks):
```

## After the session

- Open `/.admin/measurement?cohort=assigned&days=60` and check that the participant's row matches what you saw. If they opened the drawer but there's no *Drawer* count, or launched a card but there's no *Picks* count, note it as a measurement defect.
- Put the D8 follow-up date in your calendar.
