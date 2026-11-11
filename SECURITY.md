# Security and private data

Chorus is a local, single-user research application. Run one engine against a database. The launcher binds both services to loopback. Do not expose it to the public internet or a shared network: it has no multi-user authentication or permissions system. Remote hosting is not a supported deployment.

## Report a problem

Use the repository's **Security → Report a vulnerability** option if available. If it is unavailable, open an issue asking for a private contact without exploit details or sensitive data. Do not post keys, session exports, private prompts or unredacted logs in an issue.

## What leaves your computer

The engine sends selected problem, persona and conversation/tool context to the configured model provider. App-building agents and the final judge may receive workspace code. Choose providers and input data accordingly. Keys stay in the backend environment, never the browser. No provider is silently substituted.

Local databases and experiment repositories can retain prompts, outputs, code and usage records. Some records are hidden during experiments but become visible after completion or kill; this is an application visibility rule, not encryption. Review exports before sharing. Do not commit them to Git.

## Starter files

Bundled starters contain no credentials. Custom starters are trusted local inputs: review their content before using them. Imports exclude environment files except `.env.example`, common key/credential files, databases and generated artifacts. Symlinks and special files are rejected. Limits are 5 MiB per file and 50 MiB per frontend/backend project. These checks do not detect secrets embedded in ordinary source files. Generated code is untrusted and is not executed by the experiment tools.

## Dependencies

`npm audit` is part of the full check; high/critical findings fail it. The November 2026 maintenance update moves Next to 16.4.6 and updates the lockfile without forced major downgrades. Remaining low/moderate findings in deepmerge/shadcn and minimatch tooling are tracked by the audit and dependency updates. They are not evidence of an exploit in the local application; do not use the shadcn CLI with untrusted registry input. Recheck applicability when dependencies or usage change.

## Current limits

App experiments do not yet have an overall call/time/spend budget. Watch paid runs and use Kill experiment when appropriate. A judge report does not prove generated code is safe or runnable. The project does not yet provide a complete automated secret scanner or hosted-service hardening.
