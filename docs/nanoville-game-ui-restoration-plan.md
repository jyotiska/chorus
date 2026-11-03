# Restore Nanoville's 2D game UI

Date: 4 November 2026  
Status: Reviewed; implementation authorized on 4 November 2026 and in progress.

## Outcome

Opening Nanoville should feel like entering a small Sims-inspired 2D world: recognizable pixel characters inhabit furnished locations, show activity above their heads, and open character panels when selected. The world is the primary interface. The board, shared canvas, accounting, and final evaluation remain readily accessible through a compact game HUD and panels.

Keep the current Chorus v2 engine, fifty-person catalog, independent workers, per-agent turn caps, saved sessions, and final-only judging. This restores Nanoville's presentation and interactions around those capabilities.

## What happened

The change is traceable to Nanoville commit `93fd17d` on 2 November, subsequently merged through PR #8 (`d4e7078`). `src/app/page.tsx` switched from `ScenarioStudio` to the generated `HarnessApp mode="nanoville"`. Both Nanoville and chorus-web now receive the same workspace component and CSS from `chorus/sdk/`.

The Nanoville mode adds a scene to the shared workspace, but it is a ten-column grid of character buttons. It does not restore location selection, the furnished scene, or the old floating stat effects. Large usage and roster sections also occupy the main page. This explains why the product resembles chorus-web.

The artwork and earlier UI were largely retained:

- `nanoville/public/scenes/` contains the meeting room, garden, and university classroom.
- `nanoville/public/agents/` contains the earlier pixel characters, and `public/nanoville-image.png` is a useful visual baseline.
- `nanoville/src/components/studio/scene.tsx`, `profile.tsx`, `stat-popups.tsx`, and `src/components/scenario-studio.module.css` retain the earlier presentation.
- `chorus/chorus/harness/art-manifest.json` maps the current fifty identities to sixteen-frame sprite sheets. These are different assets from the earlier pixel characters.
- The legacy studio is reachable through an explicit test-only archive switch; normal production archives use the read-only archive browser.

The previous harness plan explicitly removed energy/confidence effects. It also required the new sprites to fit the existing artwork and a spatial scene with legible clusters. Current tests check artwork presence, participant counts, zoom, and overflow, but do not protect the old visual identity or furnished locations.

These findings come from local code, history, assets, and tests. The deployed UI has not been inspected in this planning pass.

## Product and visual specification

### World and locations

Restore the corporate meeting room, garden, and university classroom as selectable locations in setup, with image previews. Show the selected team inside the chosen environment before starting. Carry the location into the live session and restore that choice on reload in the same browser.

Match the earlier screenshot's pixel scale, furniture, warm colors, and character proportions. Give characters visible feet/ground contact, sensible positions around furniture, and correct foreground/background layering. Restore the Nanoville logo. A background image behind the existing tile grid does not meet this specification.

Use stable agent-ID placement and authored location anchors. Concurrent activity must not reshuffle the room or move a selected person out of view. Treat optional walking or idle movement as ambient presentation; it must never suggest an unrecorded conversation or canvas action.

Support the full roster without shrinking fifty people into one five-seat image:

- 2–6 participants: an intimate room or garden grouping, close to the original composition.
- 7–20: an expanded location with multiple furnished work areas.
- 21–50: a larger version of the same location, with spatial zones, pan/zoom, a location overview, and search-to-focus.

Those ranges are proposed layout tiers to validate visually. Expanded scenes need coherent extended artwork or composable environment pieces; the original backgrounds alone cannot furnish every scale. All selected participants remain present and discoverable in one world.

### Characters and interaction

Keep the current stable persona IDs and names. Reuse the old art as the style reference; do not assign old characters to new identities merely by array position. Audit the current fifty sprite sets against that reference, then adapt or replace inconsistent artwork while retaining a complete ID-to-asset manifest. Matching portraits and sprites should clearly represent the same person.

Selecting a character shows a ground selection marker and opens a game-style character popup with portrait, name, role, traits, worker status, current turn/cap, completed cycles, and shortcuts to posts, reasoning summaries, conversation, and usage. Scene selection, roster selection, and @Name links share one selected identity. Add a follow action that keeps the selected character in view; Escape closes the panel and returns focus.

An interaction menu may offer Inspect, Follow, Read latest post, and View canvas contributions. These are observer controls backed by existing records. Directing agents to talk, changing their behavior, or inventing social relationships is a separate engine feature.

### Speech, activity, and popups

Restore short speech bubbles using published board text, activity bubbles from committed worker state, and event popups such as “Posted”, “Updated canvas”, and “Turn complete”. Clicking a speech bubble opens its exact board record; clicking an edit notification opens the attributed change.

The engine is concurrent: several characters can work at once. Prioritize the selected character and recent activity; cap visible speech bubbles and queue or coalesce notifications to keep the room readable. There is no single “up next” agent in the current engine.

Implement event effects with session-scoped record IDs, initial-load watermarks, bounded lifetimes, and explicit cleanup. Initial load/reload/reconnect shows saved state without replaying old effects; session changes clear transient state. On a reconnect, baseline historical catch-up quietly and animate only new arrivals after synchronization. Pause stops activity animation; Stop shows committed results; stale responses cannot create new effects. A canvas-editing indicator requires the backend's currently valid lease.

The existing scene defines a posting animation but never chooses it in its animation mapping. Connect posting feedback to actual published records while restoring the scene.

Energy/confidence meters and numeric floating stat changes are a separate decision: current v2 sessions contain no authoritative values. The first restoration includes activity and contribution popups. If the original stats are also wanted, scope a follow-up backend design for their meaning, update rules, persistence, schema migration, exports, and effects on agent behavior. Never manufacture those numbers in the browser. Historical sessions retain their original values and visibility rules.

### HUD and information panels

At desktop size, the room takes roughly two thirds of the main working area, with an adjacent panel for Discussion, Shared canvas, and Results. A compact bottom HUD holds the selected character, team thumbnails, Pause/Resume, Stop, progress, and a summarized usage entry point. Keep problem context one click away. Put detailed tokens, latency, costs, calls, and diffs in drawers or inspectors; the underlying accounting remains unchanged.

On narrow screens, place the room first with switchable full-width panels and a character bottom sheet. Keep pan gestures inside the scene, provide buttons and keyboard equivalents, and avoid page-wide horizontal overflow. Offer fit-to-world, focus selected, visible focus, readable labels, reduced motion, and accessible status descriptions. Announce selected-agent activity and major session transitions without announcing fifty simultaneous updates.

## Architecture and ownership

Give Nanoville a local app shell and presentation components under `nanoville/src/components/game/` and presentation hooks/selectors under `nanoville/src/features/game/`. Wire `src/app/page.tsx` to that shell only once it has functional parity with the current v2 workspace.

Share typed clients, catalog/session loading, revision handling, commands, records, usage, and exports through canonical `chorus/sdk/` modules. Introduce typed presentation slots in `harness-workspace.tsx` so Nanoville can compose its own scene, setup preview, and workspace while retaining the tested session/record lifecycle and inspectors. Extract additional shared hooks only when a concrete second consumer needs them. Keep chorus-web's existing workspace as its own consumer. Update `scripts/export_contracts.py` to export any new shared modules; generated frontend copies must never be edited directly.

Nanoville owns location layouts, camera, HUD, selection, and popup presentation. Chorus retains the current persona artwork/manifest ownership and all authoritative execution and data. Reuse legacy CSS/assets selectively; legacy session hooks and scheduler assumptions are unsuitable for v2 concurrency.

Initially store location and camera as versioned, namespaced presentation preferences keyed by session ID. They affect no prompts or execution and do not require a database migration. Direct URLs opened in another browser use a documented default location. Cross-device/exported location persistence would require additive session metadata and is outside the first restoration. Keep durable records distinct from ephemeral popup queues and cosmetic positions.

## Implementation sequence and completion gates

### 1. Establish the visual baseline and shared state boundary

Capture the current interface and original room reference; inventory artwork and ID mappings. Define annotated layouts for setup, a five-agent scene, a fifty-agent scene, and mobile. Extract shared v2 session/record logic and add the Nanoville-owned shell with existing functional controls.

Completion: both shells restore and control the same v2 session correctly; chorus-web's presentation stays stable. The design reference explicitly covers locations, pixel characters, speech bubbles, character popups, and HUD placement.

### 2. Restore the recognizable five-agent experience

Implement location selection/preview and the three furnished scenes, stable placement, pixel characters, selection markers, compact controls, and character popups. Restore board/canvas access in the new layout and same-browser location restoration.

Completion: all three locations, before and during a session, visibly match the intended 2D game style; a character can be selected and inspected from the scene, roster, or board. This is the first reviewable visual milestone.

### 3. Restore live interaction feedback

Connect worker statuses, published speech, accepted edits, and completed turns to bubbles and popups. Add record navigation, notification limits, follow selection, cancellation handling, and watermark-based suppression of historical effects.

Completion: concurrent agents visibly reflect real activity; only the valid lease owner appears to edit; notification clicks reach the correct records. Reload, reconnect, pause/resume, and rapid session switches do not duplicate or misattribute effects.

### 4. Extend the world to fifty participants

Complete the identity-consistent sprite set and expanded environments. Implement stable spatial zones, camera bounds, pan/zoom, overview, and searchable selection; tune motion and popup density for large casts.

Completion: 2-, 5-, 20-, and 50-person fixtures work across every location. Every agent is findable and inspectable without overlap or unusably small sprites. Profile and board interaction remain responsive under concurrent updates; record a reproducible browser performance trace rather than inventing a performance claim.

### 5. Verify, document, and make it the default

Add meaningful component/client coverage for selection synchronization, event ordering/deduplication, session isolation, camera math, and preferences. Add browser journeys for all locations, setup preview, popups, keyboard/focus behavior, reduced motion, mobile, fifty agents, reload, and concurrent activity/lease changes. Capture deterministic visual regression references for the room and HUD with animations frozen for screenshots.

Retain the existing engine/records/accounting/export and legacy archive regressions. Run Nanoville's full documented check, relevant Chorus tests for SDK/exporter changes, and chorus-web checks after shared changes. Run browser suites sequentially because ports are shared. Update README, TEST_PLAN, and ownership guidance, including the README screenshot to depict the shipped UI.

Completion: the normal home route opens the restored game shell without a legacy test switch. The visual references protect the environment, sprite style, HUD prominence, and character popups, in addition to verifying that image URLs load.

## Scope and release approach

Deliver five reviewable slices in the sequence above. An internal development switch can support comparison while the shell is incomplete; remove it from the normal user flow at release. Keep the old production entry point until parity is verified, then switch the default atomically. Saved sessions require no engine rollback or data conversion for this presentation restoration.

The main sizing uncertainty is coherent artwork for fifty characters and expanded locations. Reusing the original backgrounds accelerates the small-room milestone, but does not complete the large-world milestone. Do not declare restoration finished after adding a background or moving the current grid lower on the page.

Implementation was authorized by the user after review on 4 November 2026. Completion remains subject to the gates above.

## Source references

- `nanoville/src/app/page.tsx` and `git show 93fd17d -- src/app/page.tsx src/app/archive/page.tsx`.
- `chorus/sdk/harness-workspace.tsx` (`Scene`, `LiveSession`, `HarnessApp`) and its CSS Module.
- `nanoville/src/components/studio/scene.tsx`, `profile.tsx`, `stat-popups.tsx`, and `src/data/scenarios.ts`.
- `nanoville/public/nanoville-image.png`, `public/scenes/`, and `public/agents/`.
- `chorus/chorus/harness/art-manifest.json` and `chorus/scripts/export_contracts.py`.
- `nanoville/tests/e2e/harness.spec.ts`, `TEST_PLAN.md`, and `AGENTS.md`.
- `chorus/docs/real-world-harness-plan.md`, especially milestones 7–8.

## Review amendments — 4 November 2026

- Reuse session behavior through typed presentation slots to avoid a broad state-management rewrite. Nanoville owns the slot implementations.
- Ship furnished zones for large casts immediately; expanded bespoke environment art remains a separate visual gate.
- Validate the saved location value, tolerate unavailable browser storage, and scope preferences by session.
- Character artwork must retain stable persona identity. Keep the existing complete set until replacements are ready; do not silently substitute unrelated old characters.
- Preserve current accessible inspector and evidence behavior while changing layout. Include baseline browser tests for both frontends after SDK changes.

## First working build — 4 November 2026

Implemented typed setup/scene/workspace presentation slots in the shared SDK, regenerated both frontend copies, and wired the normal Nanoville home route to a local game presentation. Restored the original logo and three environment backgrounds, live roster preview, five-person furnished room zones for 2–50 agents, zoom/scroll, search-to-focus, selection markers, worker activity bubbles, existing character inspectors, and a latest-published-post panel. Browser preferences validate the location and persist it per session. Detailed accounting is expandable and the board sits beside the world on desktop.

Verification: Nanoville lint, types, 27 unit/component tests, production build, and 19 browser journeys passed. Desktop and mobile screenshots were inspected. Chorus contract/execution regressions passed (24 tests). chorus-web lint, types, production build, and all 25 browser journeys also passed.

Still pending against the full plan: original-style pixel sprites and matching portraits for all fifty identities; bespoke expanded location artwork; transient speech/edit/turn effects with reconnect suppression; observer action menus/follow behavior; compact tabbed mobile panels; deterministic visual snapshot baselines and a recorded performance trace. Current large casts use multiple furnished rooms. The screenshots are review captures, not yet visual-diff assertions. This build does not claim those remaining completion gates.

## Sprite-style decision implemented — 4 November 2026

The user requested the previous agent style for Nanoville while retaining the newer style in chorus-web. Nanoville now reuses the fifteen original seated pixel-art WebP designs. An explicit local mapping assigns all fifty persona IDs to those designs by role; related personas intentionally share a design. The same mapping supplies scene sprites, setup portraits, roster portraits, and profile popups. Backend identities and behavior are unchanged. The SDK's optional portrait presentation callback leaves chorus-web's SVG artwork as the default. This supersedes the earlier requirement to wait for fifty new unique sprites before restoring the original style.

## Proportions and setup refinement — 4 November 2026

Sprites now scale with their furnished room instead of a fixed-width container, preserving their proportions relative to chairs across viewport sizes and scene zoom. At the user's request, setup now uses compact text location choices without the scene preview, character search, or zoom controls. The interactive world appears inside sessions. This supersedes the setup-preview requirements above; the selected location still carries into a new session and persists on reload.

Nanoville's latest full check passed lint, types, 28 unit/component/client tests, the production build, and all 19 browser journeys. The updated README screenshot is a fresh capture of a completed five-agent session with the current pixel sprites, meeting room, and message board. Expanded artwork and the other outstanding interaction features remain follow-up work.
