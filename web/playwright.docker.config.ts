import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/docker",
  workers: 1,
  timeout: 75000,
  use: { baseURL: `http://127.0.0.1:${process.env.CHORUS_WEB_PORT ?? "43189"}`, trace: "retain-on-failure" },
  projects: [
    { name: "Chromium", use: { browserName: "chromium" } },
    { name: "WebKit", use: { browserName: "webkit" } },
  ],
});
