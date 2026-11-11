// Transport only: all execution and validation belongs to Chorus.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) return Response.json({ error: "Origin is not allowed.", code: "FORBIDDEN", requestId: crypto.randomUUID() }, { status: 403 });
  const { path } = await context.params;
  const base = process.env.CHORUS_API_URL || "http://127.0.0.1:43187";
  const version = path[0] === "v2" ? "v2" : "v1";
  const segments = version === "v2" ? path.slice(1) : path;
  const url = new URL(`/api/${version}/${segments.map(encodeURIComponent).join("/")}`, base);
  url.search = new URL(request.url).search;
  const headers = new Headers();
  for (const name of ["content-type", "last-event-id"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  try {
    const upstream = await fetch(url, { method: request.method, headers, signal: request.signal, cache: "no-store", ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}) });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return Response.json({ error: "Cannot reach Chorus. Start the backend and retry.", code: "BACKEND_UNAVAILABLE", requestId: crypto.randomUUID() }, { status: 502 });
  }
}
export const GET = forward;
export const POST = forward;
