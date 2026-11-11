import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const backend = process.env.BACKEND_URL || "http://127.0.0.1:3001";
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path.startsWith("/api/")) {
      const body = [];
      for await (const chunk of request) body.push(chunk);
      const upstream = await fetch(backend + request.url, {
        method: request.method,
        headers: { "content-type": request.headers["content-type"] || "application/json" },
        body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(body),
        signal: AbortSignal.timeout(10000),
      });
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } else if (path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(new URL("./index.html", import.meta.url)));
    } else {
      response.writeHead(404);
      response.end("Not found");
    }
  } catch {
    response.writeHead(502);
    response.end("Backend unavailable");
  }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");
