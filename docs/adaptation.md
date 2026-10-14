# Adaptation: remix, pull, adapt, publish

The product assumption (specification section 4.7): the user's chosen agent or builder can infer enough from the published files and observable behaviour to make useful changes. Exact reconstruction of the original project is unnecessary. No source bundle, repository, build project, or prompt history is required, and the interface never divides copies into "editable" and "merely runnable".

## The loop

1. **Remix.** On a tool's detail page choose **Remix** (or `kitlane remix <tool> --name <new-name>`; `kitlane copy` is an alias, and the HTTP routes keep their original names, `/.tool/<id>/copy` and `/.api/cli/tools/<id>/copy`). The published files of the active version are duplicated into a new tool with its own ID, origin, owner, and name. Lineage is recorded on both detail pages; the original creator stays credited; the remix's maintainer owns responsibility for the adaptation.
2. **Download the files.** `kitlane pull <new-name> ./work` (or **Download files** on the detail page, a tar.gz). You get exactly what is served: for `kit/meet`, that is `index.html`, a minified `app.js`, and `app.css`.
3. **Adapt with any builder.** Hand the folder to an agent or open it in a visual builder. Describe the change in terms of behaviour ("add a dark-mode toggle", "add Lisbon to the city list"). Keep asset URLs relative and the SDK script tag intact.
4. **Republish.** `kitlane publish ./work --name <new-name>`. Open the remix in the shell and directly to check it.

Backends and external services absent from the files are not reproduced by copying. If the original depended on a server you cannot see, the copy will not have it.

## Data behaviour on remix

| Aspect | Behaviour |
|---|---|
| Personal storage | The remix starts empty. It cannot read the original tool's personal records, even for the same user (different tool ID). |
| Shared-collection bindings | Retained as read references to the same stable collection IDs. The remix keeps benefiting from the original curated dataset. Records are not duplicated. |
| Writer rights | None inherited. Writing to the original collection needs an explicit `tool` grant from its owner (and the writer must be a granted user). Alternatively the remix's owner creates a new collection and rebinds the name: `kitlane collections create <remix> <name>` then `kitlane collections bind <remix> <binding> <collection-id>`. |
| Theme | The declared `theme` and the publish-time detected theme travel with the remix, since it serves the same files; republishing re-sniffs. |
| Updater credentials, sessions, tokens | Not copied. |
| Capability reporting | `kitlane.tool().bindings[].canWrite` is `false` for inherited bindings, and `meta().writeBlockedReason` is `tool_not_granted`. A well-written tool shows this instead of failing silently; the seed editor does. |

## Two-builder verification (not yet performed)

The specification asks for adaptation to be documented and verified with two builders, including adaptation from only a minified or bundled artifact. This has **not** been performed for this release. The procedure and the evidence to collect:

### Builder A: a coding agent on the minified bundle

1. `kitlane remix meet --name meet-a` then `kitlane pull meet-a ./meet-a`.
2. Give the agent only `./meet-a` (three files) and the task: "Add Lisbon (Europe/Lisbon) to the city list and make the 'good' window 09:00 to 17:00."
3. Record: whether the agent located the city list and the hour thresholds inside the minified module; how many attempts; whether it preserved the SDK calls and relative asset URLs; the diff size.
4. `kitlane publish ./meet-a --name meet-a`; open it in the shell and directly; confirm favourite cities still save.

### Builder B: a different agent or a visual builder

1. `kitlane remix prep --name prep-b` then `kitlane pull prep-b ./prep-b` (single-file HTML).
2. Ask for a behavioural change: "Add a 'copy talking points' button."
3. Record the same evidence. For a visual builder that cannot import plain HTML, record that limitation; the publishing contract is still "provide the working files".

### What counts as success

The adapted remix launches in the shell and directly, the change works, data behaviour matches the table above, and the person did not need the original source, repository, or author. Partial success (the agent needed a hint about where the data lives) is also useful evidence; record it rather than smoothing it over.

## `kitlane init` for the adapted project

Run `kitlane init ./work` to write `KITLANE.md` into the adapted folder so the agent has the platform guidance (hosting constraints, SDK, storage modes, grants) without the author's intervention. It also inserts a bounded pointer into an existing `AGENTS.md` or `CLAUDE.md` and never replaces them.
