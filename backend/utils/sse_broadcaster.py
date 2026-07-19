"""Multi-subscriber Server-Sent-Events broadcaster for AutopilotSession.

Each subscriber owns an asyncio.Queue. publish() enqueues events into
every live subscriber's queue. subscribe() returns an async generator
that yields the subscriber's events plus periodic heartbeats when no
real activity occurs.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

HEARTBEAT_INTERVAL = 30.0  # seconds


@dataclass
class SSEEvent:
    id: int
    event: str
    data: dict
    created_at: float


@dataclass
class _Subscriber:
    queue: asyncio.Queue
    alive: bool = True
    last_heartbeat: float = field(default_factory=time.time)


class SSEBroadcaster:
    def __init__(self, history_size: int = 256, queue_max: int = 64) -> None:
        self._history: list[SSEEvent] = []
        self._history_size = history_size
        self._queue_max = queue_max
        self._subscribers: list[_Subscriber] = []
        self._next_id: int = 0

    # ------------------------------------------------------------------
    # Lifecycle (no-op: heartbeat is driven from the subscriber's own loop)
    # ------------------------------------------------------------------

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        for sub in list(self._subscribers):
            sub.alive = False
        self._subscribers.clear()

    # ------------------------------------------------------------------
    # Publish / Subscribe
    # ------------------------------------------------------------------

    def publish(self, event: str, data: dict) -> int:
        self._next_id += 1
        ev = SSEEvent(
            id=self._next_id,
            event=event,
            data=data,
            created_at=time.time(),
        )
        self._history.append(ev)
        if len(self._history) > self._history_size:
            self._history = self._history[-self._history_size:]
        for sub in list(self._subscribers):
            if not sub.alive:
                self._subscribers.remove(sub)
                continue
            try:
                sub.queue.put_nowait(ev)
            except asyncio.QueueFull:
                sub.alive = False
                self._subscribers.remove(sub)
        return ev.id

    def subscribe(
        self, last_event_id: Optional[int]
    ) -> AsyncIterator[SSEEvent]:
        """Register a subscriber synchronously and return an async generator.

        Synchronous registration matters: callers may publish events between
        subscribe() and the first __anext__() — those events must be queued
        rather than dropped.
        """
        try:
            queue: asyncio.Queue = asyncio.Queue(maxsize=self._queue_max)
        except RuntimeError:
            # Python 3.9: asyncio.Queue() binds to get_event_loop() at
            # construction, which raises when called synchronously with no
            # current loop (e.g. between asyncio.run() calls in tests). Provide
            # a loop so registration stays synchronous as documented; the queue
            # rebinds naturally once consumed inside a running loop.
            asyncio.set_event_loop(asyncio.new_event_loop())
            queue = asyncio.Queue(maxsize=self._queue_max)
        sub = _Subscriber(queue=queue)
        self._subscribers.append(sub)

        async def gen() -> AsyncIterator[SSEEvent]:
            try:
                if last_event_id is not None:
                    for ev in self._history:
                        if ev.id > last_event_id:
                            yield ev
                while True:
                    try:
                        ev = await asyncio.wait_for(
                            sub.queue.get(), timeout=HEARTBEAT_INTERVAL
                        )
                    except asyncio.TimeoutError:
                        sub.last_heartbeat = time.time()
                        yield SSEEvent(
                            id=0, event="heartbeat", data={}, created_at=time.time()
                        )
                        continue
                    yield ev
            finally:
                sub.alive = False
                if sub in self._subscribers:
                    self._subscribers.remove(sub)

        return gen()

    @property
    def history(self) -> list[SSEEvent]:
        return list(self._history)