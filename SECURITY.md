# Security and private data

Chorus is a local, single-user research application. Run one engine against a database. Compose publishes the web and preview listeners on host loopback. Keep those bindings local because Chorus has no multi-user authentication or permissions system.

## Report a problem

Use the repository's **Security → Report a vulnerability** option if available. If it is unavailable, open an issue asking for a private contact without exploit details or sensitive data. Do not post keys, session exports, private prompts or unredacted logs in an issue.

## What leaves your computer

The engine sends selected problem, persona and conversation/tool context to the configured model provider. App-building agents and the final judge may receive workspace code. Choose providers and input data accordingly. Keys stay in the backend environment, never the browser. No provider is silently substituted.

Local databases and experiment repositories can retain prompts, outputs, code and usage records. Some records are hidden during experiments but become visible after completion or kill; this is an application visibility rule, not encryption. Review exports before sharing. Do not commit them to Git.

## Starter files

Bundled starters contain no credentials. Custom starters are trusted local inputs: review their content before using them. Imports exclude environment files except `.env.example`, common key/credential files, databases and generated artifacts. Symlinks and special files are rejected. Limits are 5 MiB per file and 50 MiB per frontend/backend project. These checks do not detect secrets embedded in ordinary source files.

Opted-in public checks run generated code from committed snapshots in a disposable offline container. The trusted operator supplies a locally available image containing only public tools and dependencies. The container gets the committed file copy and scratch space. Its command output is untrusted repository data and can enter the agents' model context. Keep credentials and private fixtures out of both inputs. [Public check setup](docs/running-chorus.md#enable-agent-requested-public-checks)

## Browser and Terminal

The trusted Compose controller has access to the local Docker socket. Run it only with a Docker installation you control. The controller API is available to the engine through a dedicated volume and Unix socket. Workspace containers use a non-root user, a read-only image, bounded temporary storage, and no Docker network. They have access to their own loopback and a read-only socket for downloading npm packages from the configured registry. The repository copy, terminal history, and service output are temporary. [Docker daemon privileges](https://docs.docker.com/engine/security/#docker-daemon-attack-surface)

The preview is generated web content. Each service has its own origin, and the embedded preview restricts form and navigation behavior to that context. Chorus accepts terminal connections only from its local web origins with a single-use, short-lived ticket. Workspace code has no mount for the engine's database, Git worktrees, or provider settings. Keep secrets out of generated files and temporary terminal input.

## Dependencies

`npm audit` is part of the full check; high/critical findings fail it. The November 2026 maintenance update moves Next to 16.4.6 and updates the lockfile without forced major downgrades. Remaining low/moderate findings in deepmerge/shadcn and minimatch tooling are tracked by the audit and dependency updates. They are not evidence of an exploit in the local application; do not use the shadcn CLI with untrusted registry input. Recheck applicability when dependencies or usage change.

## Current limits

App experiments do not yet have an overall call/time/spend budget. Watch paid runs and use Kill experiment when appropriate. A judge report does not prove generated code is safe or runnable. The project does not yet provide a complete automated secret scanner or hosted-service hardening.
