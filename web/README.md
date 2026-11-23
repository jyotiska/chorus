# Chorus Web

**The browser interface for Chorus.**

This folder is part of the Chorus repository. The interface shows experiments and sends your controls to the engine. The engine runs the agents, calls models, and saves their work.

You no longer need a separate `chorus-web` checkout. Nanoville remains a separate project.

## Start the app

Follow the [main setup guide](../README.md#run-chorus). Then, from the repository root with the Python environment active and Node 24 selected:

```bash
chorus launch
```

Open [http://127.0.0.1:43189](http://127.0.0.1:43189). The engine runs on port 43187. Press Ctrl-C in the launcher’s terminal to stop both.

For a built version, run these commands from the repository root:

```bash
npm run build --prefix web
chorus launch --production
```

## Start an experiment

1. Choose a brief for an app like Todoist, Linear, Notion, or Typeform.
2. Open **Edit team** to change the selected agents. Six of the ten roles are selected by default.
3. Choose the **Agent model** and **Judge model** on the same setup screen.
4. Select **Start experiment**.

The agents plan the work, build the code, and then receive a final review. The judge can use the same model as the agents or a different one.

App experiments use the small bundled frontend/backend starters described in the [main README](../README.md#what-you-can-do). The experiment tools can write and inspect code, but cannot yet run or test the generated app in a browser.

## Follow the work

- **Board** keeps your reading position as new posts arrive. Jump to the latest with **New posts**.
- **SPEC.md** has **Document**, **Tasks**, and **Changes** views. Filter tasks by owner or expand a revision to review its diff. On wide screens you can keep the spec beside the Board. On narrow screens **Back to board** returns you to the post you opened it from.
- **Participants** shows each agent’s current task, status, and checklist progress. **Needs attention** finds blocked or failed agents, and **Finished** shows any tasks they left open. Select an agent for the full checklist, profile, usage, and available reasoning summaries. Experiment summaries become available after completion or kill.
- **Repository** opens the file tree beside the selected file or diff. Switch branches to see an agent’s committed files, or open **Changes** for commits and local pull requests.
- **Usage** shows whole-session, participant, and judge totals in one column. Each section shows model calls, tokens, cache, latency, and reported or estimated charges. Whole-session totals also include wall time.
- **Results** puts the outcome and judge summary first. Open evidence alongside the score or assessment it supports.

Use the sidebar to reopen saved runs. Switching runs or closing the browser leaves an experiment running. **Kill experiment** stops it while keeping its files and records. **Retry judge** is available if the final review fails.

**Archive** lets you search by run name or ID and filter by status or run type. Historical sessions open in a read-only view with **Conversation**, **Canvas**, and a JSON export that includes journals. Current runs have Markdown and session export links in **SPEC.md** or **Canvas**. Benchmark runs use **Shared canvas** and **Changes** to display the answer and its revision history.

## Work on the interface

To run just the interface, use these commands from this folder, with `chorus serve` running in another terminal:

```bash
npm ci
npm run dev
```

The interface connects to the engine on port 43187 by default. For another address, set `CHORUS_API_URL` in `web/.env.local`. Model keys belong in the engine’s environment.

Shared files in `lib/api/chorus/` come from `../sdk/`. Edit those source files, then regenerate from the repository root:

```bash
.venv/bin/python scripts/export_contracts.py
```

Nanoville is not needed for this step. Updating it requires the explicit `--nanoville` option described in the main README.

## Check changes

From this folder, run:

```bash
npm run check
```

This checks code style, types, the production build, and browser tests. The parent repository’s Python environment must be set up. Install the test browser once with `npx playwright install chromium`.

Browser tests use temporary data and fake model responses. Run them separately from Nanoville’s browser tests.
