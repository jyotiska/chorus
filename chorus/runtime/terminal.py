"""Maintain a bounded, reconnectable view of Docker's interactive PTY."""

import asyncio
from contextlib import suppress
import errno
import fcntl
import json
import os
import pty
import signal
import struct
import termios
import tty

from aiohttp import WSMsgType, web


_SCROLLBACK = 256 * 1024


class Terminal:
    def __init__(self, master, process):
        self.master = master
        self.process = process
        self.buffer = bytearray()
        self.end = 0
        self.changed = asyncio.Event()
        self.ended = False
        self.client = None
        self.expiry = None
        self.loop = asyncio.get_running_loop()
        self.loop.add_reader(master, self.read)

    @classmethod
    async def start(cls, container):
        master, slave = pty.openpty()
        try:
            tty.setraw(slave)
            os.set_blocking(master, False)
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
            process = await asyncio.create_subprocess_exec(
                "docker", "exec", "-it", container, "bash", "--noprofile", "--norc", "-i",
                stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
            )
        except BaseException:
            os.close(master)
            raise
        finally:
            os.close(slave)
        return cls(master, process)

    def read(self):
        try:
            data = os.read(self.master, 32768)
        except OSError as error:
            if error.errno == errno.EAGAIN:
                return
            data = b""
        if data:
            self.buffer.extend(data)
            self.end += len(data)
            del self.buffer[:max(0, len(self.buffer) - _SCROLLBACK)]
        else:
            self.ended = True
            self.loop.remove_reader(self.master)
        self.changed.set()

    async def output(self, client):
        cursor = self.end - len(self.buffer)
        while not client.closed:
            self.changed.clear()
            start = max(0, cursor - (self.end - len(self.buffer)))
            data = bytes(self.buffer[start:])
            cursor = self.end
            if data:
                await client.send_bytes(data)
            if self.ended:
                await client.close(message=b"Shell exited")
                return
            await self.changed.wait()

    async def input(self, client):
        async for message in client:
            if client is not self.client or self.ended:
                break
            if message.type == WSMsgType.BINARY:
                remaining = memoryview(message.data)
                while remaining and client is self.client and not self.ended:
                    try:
                        remaining = remaining[os.write(self.master, remaining):]
                    except BlockingIOError:
                        await asyncio.sleep(0.01)
                    except OSError:
                        return
            elif message.type == WSMsgType.TEXT:
                try:
                    size = json.loads(message.data)
                    rows, cols = size["rows"], size["cols"]
                    if type(rows) is not int or type(cols) is not int or not (1 <= rows <= 300 and 2 <= cols <= 500):
                        continue
                    fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                    self.process.send_signal(signal.SIGWINCH)
                except (ValueError, TypeError, KeyError, OSError):
                    continue

    async def attach(self, request):
        if self.expiry:
            self.expiry.cancel()
        client = web.WebSocketResponse(heartbeat=20, max_msg_size=65536)
        await client.prepare(request)
        previous, self.client = self.client, client
        if previous:
            await previous.close(code=4001, message=b"Terminal opened in another tab")
        outgoing = asyncio.create_task(self.output(client))
        try:
            await self.input(client)
        finally:
            outgoing.cancel()
            await asyncio.gather(outgoing, return_exceptions=True)
            if self.client is client:
                self.client = None
                if self.master is not None:
                    self.expiry = self.loop.call_later(300, lambda: asyncio.create_task(self.close()))
        return client

    async def close(self):
        if self.master is None:
            return
        master, self.master = self.master, None
        self.ended = True
        self.changed.set()
        if self.expiry:
            self.expiry.cancel()
        self.loop.remove_reader(master)
        os.close(master)
        if self.client:
            await self.client.close(code=4002, message=b"Workspace closed")
        with suppress(ProcessLookupError):
            self.process.terminate()
        try:
            await asyncio.wait_for(self.process.wait(), 2)
        except TimeoutError:
            with suppress(ProcessLookupError):
                self.process.kill()
            await self.process.wait()
