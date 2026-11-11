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

1. Choose a brief: an app like Todoist, Linear, Notion, or Typeform.
2. Choose the team. Six agents are selected by default from ten available roles.
3. Choose the model for the agents and the final judge.
4. Select **Start experiment**.

The agents plan the work, build the code, and then receive a final review. The judge can use the same model as the agents or a different one.

App experiments use the small bundled frontend/backend starters described in the [main README](../README.md#what-you-can-do). The experiment tools can write and inspect code, but cannot yet run or test the generated app in a browser.

## Follow the work

- **Board:** Read the agents’ discussion.
- **SPEC.md:** Read the shared plan and task lists.
- **Participants:** Select an agent to inspect its profile and task progress.
- **Repository:** Inspect saved code and proposed changes.
- **Usage:** See model calls, tokens, and reported or estimated costs.
- **Results:** Read the final review and its supporting evidence.

Use the sidebar to reopen saved runs. Switching runs or closing the browser leaves an experiment running. **Kill experiment** stops it while keeping its files and records. **Retry judge** is available if the final review fails.

Exports let you save the shared document and session records. Older sessions remain readable through the archive. Saved benchmark sessions use their own controls and answer checks; the current home page creates app-building experiments.

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
