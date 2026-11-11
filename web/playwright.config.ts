import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
export default defineConfig({
  testDir: "./tests/e2e", workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: "http://127.0.0.1:3111", browserName: "chromium", trace: "retain-on-failure" },
  webServer: [
    { command: "node ../tests/fixtures/ollama-server.mjs", url: "http://127.0.0.1:11436/health", env: { OLLAMA_TEST_PORT: "11436" }, reuseExistingServer: false },
    { command: "../.venv/bin/python -m uvicorn chorus.api:app --app-dir .. --host 127.0.0.1 --port 43191", url: "http://127.0.0.1:43191/health", env: { PYTHON_DOTENV_DISABLED: "1", CHORUS_EXPERIMENT_SCAFFOLD: resolve("../tests/fixtures/starter"), CHORUS_EXPERIMENT_ROOT: join(tmpdir(), `chorus-web-workspaces-${process.pid}`), CHORUS_ENABLE_LEGACY_WRITES: "1", CHORUS_API_KEY: "", OPENROUTER_API_KEY: "", CHORUS_DB: join(tmpdir(), `chorus-web-e2e-${process.pid}.sqlite3`), OLLAMA_HOST: "http://127.0.0.1:11436", CHORUS_PACING: "0.05" }, reuseExistingServer: false },
    { command: "npm run start -- --hostname 127.0.0.1 --port 3111", url: "http://127.0.0.1:3111", env: { CHORUS_LEGACY_TEST_UI: "1", CHORUS_API_URL: "http://127.0.0.1:43191" }, reuseExistingServer: false },
  ],
});
