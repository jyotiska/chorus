import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "/api/chorus/v2";

async function createExperiment(request: APIRequestContext) {
  const response = await request.post(`${api}/experiments`, {
    data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status(), await response.text()).toBe(201);
  const state = await response.json();
  return { id: state.id as string, revision: state.experiment.repository.mainCommit as string };
}

function view(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Session views" }).getByRole("button", { name, exact: true });
}

function app(page: Page) {
  return page.frameLocator('iframe[title="Application preview"]').frameLocator('iframe[title="Generated app"]');
}

async function shell(page: Page, command: string) {
  await page.locator(".runtime-terminal-screen .xterm-helper-textarea").focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press("Enter");
}

test("runs the saved starter and shares a real isolated shell with Browser", async ({ page, request }) => {
  const { id, revision } = await createExperiment(request);
  const runtime = `${api}/sessions/${id}/runtime`;
  try {
    await page.goto(`/?session=${id}`);
    await expect(page.getByRole("navigation", { name: "Session views" }).getByRole("button"))
      .toHaveText(["Board", "SPEC.md", "Repository", "Results", "Browser", "Terminal"]);
    await view(page, "Browser").click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const browser = page.getByRole("region", { name: "Browser workspace" });
    await expect(browser.getByRole("status").first()).toHaveText("Running", { timeout: 25000 });
    await expect(app(page).getByRole("heading").first()).toBeVisible();
    const data = await (await request.get(runtime)).json();
    expect(data.revision).toBe(revision);
    const frontend = data.forwards.find((route: { port: number }) => route.port === 3000).url;
    expect(await (await request.get(`${frontend}api/health`)).json()).toEqual({ status: "ok" });
    const invalid = await request.post(runtime, { headers: { Origin: frontend.slice(0, -1) }, data: { action: "reset" } });
    expect(invalid.status()).toBe(403);

    await view(page, "Terminal").click();
    await expect(page.getByText("Shell connected")).toBeVisible();
    await shell(page, "printf 'shell-check:%s:%s\\n' \"$(pwd)\" \"$(printf hi | tr a-z A-Z)\"; test ! -e /runtime/control.sock && test ! -e /var/run/docker.sock && test -z \"$CHORUS_API_KEY\" && printf 'shell-%s\\n' isolated");
    const terminal = page.locator(".runtime-terminal-screen .xterm-rows");
    await expect(terminal).toContainText("shell-check:/workspace:HI");
    await expect(terminal).toContainText("shell-isolated");
    await shell(page, "sleep 30");
    await page.keyboard.press("Control+c");
    await shell(page, "printf 'interrupted-%s\\n' ok; stty size");
    await expect(terminal).toContainText("interrupted-ok");
    await expect(terminal).toContainText(/\d+ \d+/);
    await view(page, "Browser").click();
    await expect(app(page).getByRole("heading").first()).toBeVisible();
    await browser.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(browser.getByRole("status")).toHaveText("Stopped");
    expect((await request.get(frontend)).status()).toBe(404);

    await view(page, "Terminal").click();
    await expect(terminal).toContainText("shell-check:/workspace:HI");
    await shell(page, "mv backend/package.json backend/package.saved");
    await view(page, "Browser").click();
    await browser.getByRole("button", { name: "Run", exact: true }).click();
    await expect(browser.getByRole("status").first()).toHaveText("Failed", { timeout: 15000 });
    await expect(browser.getByText(/needs a dev or start script/)).toBeVisible();
    const saved = await request.get(`${api}/sessions/${id}/repository/file`, {
      params: { revision, path: "backend/package.json" },
    });
    expect(saved.ok()).toBeTruthy();

    await view(page, "Terminal").click();
    const dependency = { "chorus-preview-fixture": "1.0.0" };
    const manifest = { name: "smoke-app", dependencies: dependency, scripts: { start: "node registry.cjs" } };
    const lock = { name: manifest.name, lockfileVersion: 3, packages: {
      "": { name: manifest.name, dependencies: dependency },
      "node_modules/chorus-preview-fixture": { version: "1.0.0", resolved: "https://registry.npmjs.org/chorus-preview-fixture/-/chorus-preview-fixture-1.0.0.tgz" },
    } };
    const files = { "package.json": JSON.stringify(manifest), "package-lock.json": JSON.stringify(lock),
      "registry.cjs": "console.log(require('chorus-preview-fixture')); require('node:http').createServer((_, res) => res.end('registry-ready')).listen(3001, '127.0.0.1');" };
    const write = Object.entries(files).map(([name, content]) =>
      `printf %s ${Buffer.from(content).toString("base64")} | base64 -d > backend/${name}`).join("; ");
    await shell(page, `${write}; printf 'fixture-%s\\n' ready`);
    await expect(terminal).toContainText("fixture-ready");
    await view(page, "Browser").click();
    await browser.getByRole("button", { name: "Run", exact: true }).click();
    await expect(browser.getByRole("status").first()).toHaveText("Running", { timeout: 25000 });
    await expect.poll(async () => (await (await request.get(runtime)).json()).logs.backend).toContain("registry-probe");
  } finally {
    await request.post(runtime, { data: { action: "reset" } });
  }
});

test("coalesces repeated Run requests while two active experiments keep distinct ports", async ({ request }) => {
  const [first, second] = await Promise.all([createExperiment(request), createExperiment(request)]);
  const routes = [first, second].map(({ id }) => `${api}/sessions/${id}/runtime`);
  const read = async (path: string) => (await request.get(path)).json();
  try {
    const requests = await Promise.all([routes[0], routes[0], routes[1]].map((url) => request.post(url, { data: { action: "run" } })));
    for (const response of requests) expect(response.ok(), await response.text()).toBeTruthy();
    await expect.poll(async () => Promise.all(routes.map(async (url) => (await read(url)).state)), { timeout: 25000 })
      .toEqual(["running", "running"]);
    const [a, b] = await Promise.all(routes.map(read));
    expect(a.forwards).toHaveLength(1);
    expect(a.forwards[0].url).not.toBe(b.forwards[0].url);
    await request.post(routes[0], { data: { action: "reset" } });
    expect((await request.get(a.forwards[0].url)).status()).toBe(404);
    expect((await request.get(b.forwards[0].url)).ok()).toBeTruthy();
  } finally {
    await Promise.all(routes.map((url) => request.post(url, { data: { action: "reset" } })));
  }
});

test("forwards a manually started app and keeps navigation and forms interactive", async ({ page, request }) => {
  const { id } = await createExperiment(request);
  const runtime = `${api}/sessions/${id}/runtime`;
  try {
    await page.goto(`/?session=${id}`);
    await view(page, "Terminal").click();
    await expect(page.getByText("Shell connected")).toBeVisible();
    const server = [
      "const http = require('node:http');",
      "const { createHash } = require('node:crypto');",
      "let count = 0;",
      "const server = http.createServer((req, res) => {",
      "  if (req.url === '/redirect') { res.writeHead(302, {location:'/second?x=1#section'}).end(); return; }",
      "  if (req.url === '/blocked') { res.setHeader('X-Frame-Options', 'DENY'); res.end('Blocked'); return; }",
      "  if (req.method === 'POST') { count++; res.writeHead(303, {location:'/saved'}).end(); return; }",
      "  res.setHeader('Content-Type', 'text/html; charset=utf-8');",
      "  res.end('<h1>' + (req.url === '/saved' ? 'Saved ' + count : req.url.startsWith('/second') ? 'Second page' : 'First page') + '</h1>' +",
      '  `<a href="/redirect">Next page</a><button onclick="history.pushState({}, \'\', \'/client#inside\')">Client route</button><form method="post"><input name="entry" aria-label="Entry"><button>Save</button></form>`);',
      "});",
      "server.on('upgrade', (req, socket) => {",
      "  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');",
      "  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');",
      "  const text = Buffer.from('fixture-message'); socket.write(Buffer.concat([Buffer.from([129, text.length]), text]));",
      "});",
      "server.listen(8088, '127.0.0.1', () => console.log('listening-' + 8088));",
    ].join("\n");
    const script = Buffer.from(server).toString("base64");
    await shell(page, `printf %s ${script} | base64 -d > manual.cjs; node manual.cjs`);
    await expect(page.locator(".runtime-terminal-screen .xterm-rows")).toContainText("listening-8088");
    await page.getByRole("spinbutton", { name: "Workspace port" }).fill("8088");
    await page.getByRole("button", { name: "Forward port" }).click();
    await expect(page.getByText("Port 8088 is available in Browser.")).toBeVisible();
    await view(page, "Browser").click();
    const browser = page.getByRole("region", { name: "Browser workspace" });
    const address = browser.getByRole("textbox", { name: "Address" });
    const frame = app(page);
    await expect(frame.getByRole("heading", { name: "First page" })).toBeVisible();
    const socketMessage = await frame.locator("body").evaluate(() => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${location.host}/echo`);
      socket.onmessage = (event) => { resolve(event.data); socket.close(); };
      socket.onerror = () => reject(new Error("Preview WebSocket failed"));
    }));
    expect(socketMessage).toBe("fixture-message");
    await frame.getByRole("link", { name: "Next page" }).click();
    await expect(frame.getByRole("heading", { name: "Second page" })).toBeVisible();
    await expect(address).toHaveValue(/\/second\?x=1#section$/);
    await browser.getByRole("button", { name: "Back", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "First page" })).toBeVisible();
    await browser.getByRole("button", { name: "Forward", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "Second page" })).toBeVisible();
    await frame.getByRole("button", { name: "Client route" }).click();
    await expect(address).toHaveValue(/\/client#inside$/);
    await browser.getByRole("button", { name: "Back", exact: true }).click();
    await expect(address).toHaveValue(/\/second\?x=1#section$/);
    await frame.getByRole("textbox", { name: "Entry" }).fill("A task");
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "Saved 1" })).toBeVisible();
    await browser.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "Saved 1" })).toBeVisible();
    await address.fill("https://example.org/");
    await browser.getByRole("button", { name: "Go", exact: true }).click();
    await expect(browser.getByRole("alert")).toHaveText(/selected forwarded port/);
    await address.fill("/blocked");
    await address.press("Enter");
    await expect(browser.getByText(/could not be displayed/)).toBeVisible();
    await expect(browser.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", /\/blocked$/);
  } finally {
    await request.post(runtime, { data: { action: "reset" } });
  }
});
