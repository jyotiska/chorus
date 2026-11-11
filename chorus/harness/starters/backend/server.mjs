import { createServer } from "node:http";

createServer((request, response) => {
  const healthy = request.method === "GET" && request.url === "/api/health";
  response.writeHead(healthy ? 200 : 404, { "content-type": "application/json" });
  response.end(JSON.stringify(healthy ? { status: "ok" } : { error: "Not found" }));
}).listen(Number(process.env.PORT || 3001), "127.0.0.1");
