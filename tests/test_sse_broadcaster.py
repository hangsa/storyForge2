"""Tests for backend SSEBroadcaster fan-out + Last-Event-ID replay."""
import asyncio
import pytest

from backend.utils.sse_broadcaster import SSEBroadcaster


async def _drain(it, n: int) -> list:
    out = []
    async for ev in it:
        out.append(ev)
        if len(out) >= n:
            break
    return out


@pytest.mark.asyncio
async def test_subscriber_receives_events_in_publish_order():
    bc = SSEBroadcaster()
    sub = bc.subscribe(last_event_id=None)
    # Publish 3 events before subscribing finishes setup is impossible
    # (subscribe is an async generator) — instead, start subscription first.
    bc.publish("a", {"i": 1})
    bc.publish("b", {"i": 2})
    bc.publish("c", {"i": 3})
    received = await _drain(sub, 3)
    assert [e.event for e in received] == ["a", "b", "c"]
    assert [e.data["i"] for e in received] == [1, 2, 3]
    # IDs are monotonically increasing
    assert received[0].id < received[1].id < received[2].id


@pytest.mark.asyncio
async def test_two_subscribers_each_get_all_events():
    bc = SSEBroadcaster()
    s1 = bc.subscribe(last_event_id=None)
    s2 = bc.subscribe(last_event_id=None)
    bc.publish("x", {"v": 1})
    bc.publish("y", {"v": 2})
    r1, r2 = await asyncio.gather(_drain(s1, 2), _drain(s2, 2))
    assert [e.event for e in r1] == ["x", "y"]
    assert [e.event for e in r2] == ["x", "y"]


@pytest.mark.asyncio
async def test_replay_with_last_event_id_returns_only_newer_events():
    bc = SSEBroadcaster()
    bc.publish("old1", {"v": 1})
    bc.publish("old2", {"v": 2})
    third = bc.publish("old3", {"v": 3})
    sub = bc.subscribe(last_event_id=third)
    bc.publish("new1", {"v": 4})
    bc.publish("new2", {"v": 5})
    received = await _drain(sub, 2)
    assert [e.data["v"] for e in received] == [4, 5]
    assert received[0].id > third


@pytest.mark.asyncio
async def test_history_size_cap_drops_oldest_events():
    bc = SSEBroadcaster(history_size=4, queue_max=64)
    bc.publish("e1", {})
    bc.publish("e2", {})
    bc.publish("e3", {})
    bc.publish("e4", {})
    bc.publish("e5", {})        # overflows history — e1 dropped
    sub = bc.subscribe(last_event_id=1)
    received = await _drain(sub, 4)  # replay yields e2..e5 (4 events)
    assert "e1" not in {e.event for e in received}
    assert [e.event for e in received] == ["e2", "e3", "e4", "e5"]


@pytest.mark.asyncio
async def test_slow_subscriber_is_dropped_after_queue_overflow():
    """A subscriber whose queue fills (no consumer) gets disconnected so the
    publisher is not blocked."""
    bc = SSEBroadcaster(queue_max=2)
    sub = bc.subscribe(last_event_id=None)
    # Do NOT drain — fill the queue:
    bc.publish("a", {})  # buffered
    bc.publish("b", {})  # buffered (queue full)
    bc.publish("c", {})  # should trigger slow-subscriber drop
    # Subsequent publishes must not raise even though sub is gone.
    bc.publish("d", {})
    # Closing the generator must be safe.
    await sub.aclose()


@pytest.mark.asyncio
async def test_heartbeat_yields_periodic_pings():
    """The broadcaster injects a heartbeat every HEARTBEAT_INTERVAL seconds
    so proxy connections survive. We override the interval to 0.05s for
    test speed."""
    from backend.utils import sse_broadcaster as mod
    original = mod.HEARTBEAT_INTERVAL
    mod.HEARTBEAT_INTERVAL = 0.05
    try:
        bc = SSEBroadcaster()
        events = []
        # Start a consumer task; collect 2 heartbeats within ~0.2s
        async def consume():
            async for ev in bc.subscribe(last_event_id=None):
                events.append(ev)
                if len(events) >= 2:
                    break
        # Trigger subscribe start so background heartbeat task begins
        # The consumer above drives it; to avoid hanging if subscribe hangs
        # we run it with a timeout.
        await asyncio.wait_for(consume(), timeout=1.0)
        assert all(e.event == "heartbeat" for e in events)
    finally:
        mod.HEARTBEAT_INTERVAL = original