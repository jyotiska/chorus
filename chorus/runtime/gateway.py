"""HTTP and WebSocket forwarding for explicitly registered loopback services."""

import asyncio
from pathlib import Path

from aiohttp import ClientError, WSMsgType, web
from multidict import CIMultiDict
from yarl import URL


FRAME = "/.chorus-preview/"
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
       "transfer-encoding", "upgrade"}


def headers(items, exclude=()):
    connection = {value.strip().lower() for line in items.getall("Connection", []) for value in line.split(",")}
    return CIMultiDict((key, value) for key, value in items.items()
                       if key.lower() not in HOP and key.lower() not in connection and key.lower() not in exclude)


async def websocket(request, client, address, outgoing):
    protocols = [name.strip() for name in request.headers.get("Sec-WebSocket-Protocol", "").split(",") if name.strip()]
    async with client.ws_connect(address, headers=outgoing, protocols=protocols, max_msg_size=4 * 1024 * 1024) as upstream:
        downstream = web.WebSocketResponse(protocols=[upstream.protocol] if upstream.protocol else ())
        await downstream.prepare(request)

        async def copy(source, target):
            async for message in source:
                if message.type == WSMsgType.TEXT:
                    await target.send_str(message.data)
                elif message.type == WSMsgType.BINARY:
                    await target.send_bytes(message.data)

        workers = [asyncio.create_task(copy(upstream, downstream)), asyncio.create_task(copy(downstream, upstream))]
        try:
            await asyncio.wait(workers, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for worker in workers:
                worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            await downstream.close()
        return downstream


async def stream(request, upstream, *, response_headers=None):
    response = web.StreamResponse(status=upstream.status, headers=response_headers or headers(upstream.headers))
    await response.prepare(request)
    try:
        async for block in upstream.content.iter_chunked(65536):
            await response.write(block)
        await response.write_eof()
    except (ClientError, ConnectionError, TimeoutError):
        response.force_close()
        if request.transport:
            request.transport.close()
    return response


async def proxy(request, client, forward):
    if request.method in {"CONNECT", "TRACE"} or not request.raw_path.startswith("/"):
        raise web.HTTPBadRequest()
    address = URL(f"http://127.0.0.1:{forward.target}{request.raw_path}", encoded=True)
    try:
        if request.headers.get("Upgrade", "").lower() == "websocket":
            outgoing = headers(request.headers, {"sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol",
                                                 "sec-websocket-extensions"})
            return await websocket(request, client, address, outgoing)
        outgoing = headers(request.headers, {"expect", "proxy-connection", "forwarded", "x-forwarded-host"})
        outgoing["X-Forwarded-Host"] = request.host
        data = request.content.iter_chunked(65536) if request.body_exists else None
        async with client.request(request.method, address, headers=outgoing, data=data, allow_redirects=False) as upstream:
            frame_options = upstream.headers.get("X-Frame-Options", "").strip().upper()
            ancestry = (part.strip().lower().split() for policy in upstream.headers.getall("Content-Security-Policy", [])
                        for part in policy.split(";"))
            restricted = any(directive in (["frame-ancestors", "'none'"], ["frame-ancestors", "'self'"])
                             for directive in ancestry)
            if request.headers.get("Sec-Fetch-Dest") == "iframe" and (frame_options in {"DENY", "SAMEORIGIN"} or restricted):
                # Show a local placeholder without embedding the protected response.
                return web.Response(status=403, text='<!doctype html><meta name="chorus-preview-blocked">'
                                    '<p>This page requires a separate browser tab.</p>', content_type="text/html",
                                    headers={"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'"})
            incoming = headers(upstream.headers, {"clear-site-data"})
            if location := incoming.get("Location"):
                destination = URL(location)
                if destination.host in {"127.0.0.1", "localhost"} and destination.port == forward.port:
                    incoming["Location"] = str(URL(f"http://{request.host}").with_path(destination.path)
                                               .with_query(destination.query).with_fragment(destination.fragment))
            return await stream(request, upstream, response_headers=incoming)
    except (ClientError, OSError, TimeoutError):
        raise web.HTTPBadGateway(text="The server in this workspace is unavailable.") from None


async def serve_frame(request, origins):
    parents = " ".join(sorted(origins))
    policy = f"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors {parents}"
    response_headers = {"Content-Security-Policy": policy, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    if request.path == FRAME + "frame.js":
        return web.Response(body=Path(__file__).with_name("frame.js").read_bytes(),
                            headers=response_headers, content_type="text/javascript")
    if request.path != FRAME or request.query.get("parent") not in origins:
        raise web.HTTPNotFound()
    return web.Response(text="""<!doctype html><html lang="en"><meta charset="utf-8">
<title>Chorus app preview</title><style>html,body,iframe{height:100%;width:100%;margin:0;border:0;display:block}</style>
<iframe title="Generated app" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer"></iframe>
<script src="/.chorus-preview/frame.js" defer></script></html>""", content_type="text/html", headers=response_headers)
