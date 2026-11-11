# Bundled starter projects

Version 1. These small, dependency-free Node 24 projects were written for Chorus and are covered by the repository's Apache 2.0 license. They provide a blank frontend and a health endpoint, not solutions to the experiment briefs.

Run `npm start` in each project. The frontend listens on 3000 and forwards `/api/` to the backend on 3001. Override `PORT` or `BACKEND_URL` locally if needed. Chorus agents cannot run these commands yet.

Custom starters must provide frontend/ and backend/ directories. Private configuration, databases, logs, and common large artifacts are excluded. Links and special files are rejected. Each copied file is limited to 5 MiB and each project to 50 MiB. Review custom starters before use; filename filtering cannot identify every secret.
