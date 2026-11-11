# Chorus Web · Final UI redesign plan

## Approved direction

Build a dark-only workspace around the approved Setup, Live run, Results and Phone wireframes. The primary journey is **read a contribution → inspect the shared answer or its evidence → return to the same post**. A two-agent run and a 50-agent run should put the first contribution in the same place.

Use Codex as the reference for returning to ongoing sessions, DeepSeek Harness for keeping the current task in focus, and Orca’s multi-agent desktop IDE for comparing work in adjacent panes. Keep Chorus’s vocabulary, portraits and independent-agent workflow. [Codex](https://openai.com/index/introducing-the-codex-app/) · [DeepSeek Harness](https://www.deepseek.com/en/harness/) · [Orca](https://www.onorca.dev/docs)

## The workspace

- **Session rail.** New session at the top, recent v2 runs in the middle, historical Archive at the bottom. Each run shows problem title, state and time to distinguish repeated experiments. Allow the rail to collapse. Opening another run is navigation. Returning to setup during an active run explicitly says “Pause and return to setup” and waits for the pause to succeed.
- **Setup.** Center the problem picker and readable problem statement. Show the selected team, model, per-agent turn cap, final judge setting and maximum contribution cycles before Start. Open the complete roster from Edit team. Keep a clear distinction between opening a profile and selecting a participant.
- **Live run.** Keep the problem title, status and Pause or Resume visible. Put Stop and evaluate in the run menu. Use Board, Canvas and Results as the main views, with named Participants and Usage controls. Show posts newest first. Hold the reader’s position as records arrive and offer “New posts” to jump to the latest.
- **Canvas beside Board.** Default wide desktop to the approved split view when both panes fit. Let users close it for focused reading and remember their choice locally. When the rail, a readable board and an approximately 320 px canvas cannot fit together, switch to one full-width view at a time. Opening an agent, edit or evidence record retains a path back to the original post. Link to a particular edit only when a stored record establishes the relationship. Otherwise offer “Open canvas.”
- **Results.** Lead with the deterministic solution check, followed by the team assessment, individual evaluations and supporting records. Announce when results are ready without switching a reader away from the board. Reopening a finished run lands on Results.
- **Phone.** Put sessions in a drawer. Keep the title and run action visible. Board, Canvas and Results each take the full width. Agent and evidence details open as sheets with a visible Back or Close action. Returning restores the selected post and scroll position.

## Feature preservation is a release requirement

Before replacing a view, inventory its controls, displayed fields, supported states and regression tests. For every item, record its destination, the user action that opens it and the test or manual check that proves it works. Run the existing suites first and record any baseline failures. A missing destination or unverified workflow keeps the redesign open.

| Current capability | Home in the redesign | Proof required |
| --- | --- | --- |
| Catalog and run configuration | Setup picker, run settings and start summary | All catalog problems and models are reachable. Luna is the default. Availability and compatibility messages are visible. Start enforces 2–50 agents and 1–100 turns per agent. If creation succeeds but Start fails, retry on that session. |
| Team selection and personas | Edit team and agent profile | Suggested rosters follow problem changes. Manual edits survive rerenders, filters and profile inspection. Check all 50 portraits and full profile details. Preserve multiple private adversaries and clear an assignment when its agent is removed. |
| Session lifecycle | Header, run menu, session rail and direct URLs | Exercise ready/start, pause/resume, early stop, review, completion, reconnect, restart recovery and context overflow. Reload and direct links restore the correct session. Pending commands resist repeated clicks. Closing the browser leaves backend execution running. |
| Board and participants | Board, Participants and agent inspector | Preserve flat concise posts, timestamps, turn numbers, valid @mentions, worker state and per-agent progress. Verify Profile, Conversation, Reasoning summaries and Calls with a long history. Keep observer-visible summaries separate from peer-visible posts. |
| Shared answer and edits | Canvas and Changes | Render complete Markdown, including the fenced solution block. Show version, lease holder or availability, accepted edit author, reason and diff. Published work stays visible after a later failure. Cancelled work cannot appear as an accepted edit. |
| Accounting | Usage and individual agent details | Compare input, output and cached tokens, cache use and coverage, calls, total/mean/p95 latency, wall time and costs with backend values. Keep participant, judge and session totals distinguishable. Preserve partial, unknown, reported and estimated values. |
| Evaluation and evidence | Results and source inspector | Exercise correct and incorrect answers, stopped-early and judge-disabled runs, pending or failed judging, team and individual rubric scores, insufficient evidence, and links back to the actual records. The deterministic check remains authoritative. |
| Export and history | Canvas export menu, Archive and direct session URLs | Download and inspect the Markdown canvas, complete v2 JSON, and historical JSON with journals. Reopen a v1 session with its original conversation, canvas and turn counts. Keep production archive access read-only and retain legacy regression coverage. |

## Visual and interaction polish

**Appearance.** Start with a charcoal rail (#101214), work surface (#17191C), raised menus (#22252A), warm primary text (#F0F1EE) and readable secondary text (#ABB1B5). Reserve muted jade (#8ED6B4) for the primary action, selection or focus. Pair status colors with words. Apply the palette from first paint through loading, empty, error, dialog and archive states. Use the existing DM Sans for reading and Geist Mono for versions, timestamps, counts and diffs. Target 15–16 px body text, restrained 20–24 px titles and 65–80 characters per line where space permits.

**Motion.** Apply Emil Kowalski’s attention to frequency, interruption and origin. Frequent actions such as switching tabs, navigating by keyboard and receiving a post should feel immediate. Give pointer-opened menus a roughly 140 ms ease-out from their trigger. Give a sheet 180–220 ms on transform and opacity. Reversing an action mid-transition should follow the input immediately. Under reduced motion, switch directly to the final position. Use CSS for these interactions. [Emil Kowalski’s design engineering guidance](https://emilkowal.ski/skill)

**Interaction details.** Design hover, focus, active, disabled, loading and failure states for each control. Explain an unavailable Start beside the setting that needs attention. Reserve space for changing counts, keep focus visible, return focus to the opener, and use 44 px touch targets on phones. Keep wide code and diffs horizontally scrollable inside their own pane. Check keyboard-only operation, screen reader names and announcements, 200% zoom, and at least 4.5:1 contrast for ordinary text.

**Additions included in this release.** Search the problem or roster by name, jump to new posts, remember the desktop pane preference, and copy a session link that restores the same run. Each addition serves an existing workflow and can ship independently of the underlying run controls.

## Build order

1. **Baseline and shell.** Complete the parity inventory against the production routes, archive and browser suites. Use the approved wireframes as the layout reference. Build the dark foundation, session rail, header, responsive pane behavior and loading/error states. Use the existing v2 session list for recents. Verify direct links, reload and rapid session switching before migrating content.
2. **Setup and team.** Move catalog selection, settings, profiles and roster editing into the launcher. Reuse existing validation and command handling. Exercise the two-agent minimum, the complete 50-agent catalog, unavailable models and recovery after a failed start.
3. **Live workspace.** Move the board, canvas, changelog, participants and usage into their final positions. Keep one subscription for the active session. Ignore stale responses after switching runs. Verify the read → inspect → return journey with new posts arriving, pausing, reconnecting and opening a long diff.
4. **Results, archive and exports.** Move the verification outcome, judge report and evidence inspection into Results. Apply the same visual language to historical records. Check each export against its source session and exercise v1 direct links.
5. **Polish and release.** Review Production mix at desktop (1440 px), tablet (768 px) and phone (390 px), then stress-test 320 px, long titles, empty records, 50 participants, missing usage and interrupted connections. Capture setup, live split, phone canvas, completed results and archive. Resolve every gap in the parity inventory and run the release checks.

## Implementation boundary and acceptance

Chorus owns execution, authorization, scheduling, persistence, accounting and verification. The web proxy remains transport-only. Build Chorus-specific layout and styling in chorus-web. Reuse the shared workspace presentation hook. Where setup composition, session listing or record inspection requires shared changes, edit the canonical source in **chorus/sdk**, regenerate both frontend consumers and verify Nanoville’s presentation. Read the bundled Next.js guide before implementation. Use Node 24 and run `npm run check` in chorus-web, followed sequentially by the affected Nanoville browser suite on isolated databases and ports.

Ship when the current features have verified destinations, both roster extremes put the first post in the initial desktop viewport, and someone can start a run, inspect a contribution and a canvas change, return to their reading position, follow a result to its evidence, export and reopen the session on desktop and phone.
