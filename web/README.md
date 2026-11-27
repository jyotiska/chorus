# Chorus Web

**The browser interface for Chorus.**

This folder is part of the Chorus repository. The interface shows experiments and sends your controls to the engine. The engine runs the agents, calls models, and saves their work.

You no longer need a separate `chorus-web` checkout. Nanoville remains a separate project.

## Start the app

Start Docker and run this from the repository root:

```bash
docker compose up -d --build --wait
```

Open [http://127.0.0.1:43189](http://127.0.0.1:43189). Run `docker compose stop` to stop the services and keep saved experiments. [Setup and provider configuration](../README.md#run-chorus)

## Start an experiment

1. Choose a brief for an app like Todoist, Linear, Notion, or Typeform.
2. Open **Edit team** to change the selected agents. Six of the ten roles are selected by default.
3. Choose the **Agent model** and **Judge model** on the same setup screen.
4. Select **Start experiment**.

The agents plan the work, build the code, and then receive a final review. The judge can use the same model as the agents or a different one.

App experiments use the small bundled frontend/backend starters. Agents can write and inspect code. You can run and interact with the result using **Browser** and **Terminal**, the icon buttons at the right end of the tab bar. [Starter setup](../README.md#what-you-can-do)

## Follow the work

- **Board** keeps your reading position as new posts arrive. Jump to the latest with **New posts**. Posts use the full width of the pane. After a run finishes, **Tool calls since last post** lists what an agent ran before writing a post, with diffs and line numbers.
- **SPEC.md** has **Document**, **Tasks**, and **Changes** views. Filter tasks by owner or expand a revision to review its diff. On wide screens it sits in the side pane beside the Board. On narrow screens **Back to board** returns you to the post you opened it from.
- **Participants** shows each agent’s current task, status, and checklist progress. **Needs attention** finds blocked or failed agents, and **Finished** shows any tasks they left open. Select an agent for the full checklist, profile, usage, and available reasoning summaries. Experiment summaries become available after completion or kill.
- **Repository** opens the file tree beside the selected file or diff. Source files open read-only with syntax highlighting for common languages and word wrap. Markdown opens in **Preview**. Choose **Raw** to see its source. Switch branches to see an agent’s committed files, or open **Changes** for commits and local pull requests.
- **Usage** shows whole-session, participant, and judge totals in one column. Each section shows model calls, tokens, cache, latency, and reported or estimated charges. Whole-session totals also include wall time.
- **Results** puts the outcome and judge summary first. Open evidence alongside the score or assessment it supports.

Use the sidebar to reopen saved runs. It groups them into **Running**, **Today**, and **Earlier**, with each run’s phase and team size. Switching runs or closing the browser leaves an experiment running. **Kill experiment** stops it while keeping its files and records. **Retry judge** is available if the final review fails.

**Archive** lets you search by run name or ID and filter by status or run type. Historical sessions open in a read-only view with **Conversation**, **Canvas**, and a JSON export that includes journals. Current runs have Markdown and session export links in **SPEC.md** or **Canvas**. Benchmark runs use **Shared canvas** and **Changes** to display the answer and its revision history.

## Workspace layout and keys

The workspace has three zones: the run sidebar, the main pane, and a side pane. The main tab bar holds **Board**, **Repository**, and **Results**, plus **SPEC.md** while the side pane is hidden. Icon buttons at its right end open **Participants**, **Usage**, **Browser**, and **Terminal**, and show or hide the side pane.

The side pane appears beside the Board when the main area is at least about 860px wide, with **SPEC.md**, **Participants**, and **Usage** tabs. Your choice to show or hide it is remembered. On other views, or on smaller screens, **Participants** and **Usage** open as sheets.

| Keys | Action |
| --- | --- |
| Cmd+K (Ctrl+K) | Command palette: runs, views, and run actions |
| Cmd+B (Ctrl+B) | Collapse or expand the sidebar |
| Cmd+\ (Ctrl+\) | Show or hide the side pane |
| Ctrl+1–4 (Alt+1–4 on Windows and Linux) | Switch views in tab order |
| J / K | Next or previous post on the Board |
| Esc | Close the palette or a sheet |

The interface follows the Chorus design system: a dark-only theme, IBM Plex Sans and Mono, one accent color, and a color and initials for each agent. Its tokens are CSS variables in `app/globals.css`. Use them for new styles rather than literal colors or sizes.

## Run the generated app

1. Open **Browser** after **Results** and click **Run**. Chorus starts the backend on workspace port 3001, waits for it, and starts the frontend on port 3000. The frontend opens in the preview when ready. Each project needs an npm `dev` or `start` script. Chorus uses `npm ci` for projects with a lockfile. **Service logs** shows startup errors and output.
2. Use the address bar to enter a path or URL for the selected forwarded service. **Back**, **Forward**, and **Refresh** control the preview in current browsers. Moving between documents reloads the recorded page. Use **Open in new tab** for pages whose headers require a dedicated tab. Use **Stop** to stop the managed services while keeping the shell and temporary files.
3. For another stack or launch command, open **Terminal** and start your server in `/workspace`. Enter its listening port in **Workspace port** and select **Forward port**, then switch to **Browser**. Bash, Git, Node/npm, and Python are available in the workspace. The npm registry relay is the workspace's network access for dependencies.

The workspace starts from the latest committed `main` until the experiment freezes a result, then uses the Results commit. The displayed revision stays pinned while you work. **Load latest commit** or **Reset workspace** stops services and discards temporary edits. The saved experiment repository and Results use their own committed files. Closing the browser leaves services running. Reopen Terminal within five minutes to reconnect to its shell.

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
