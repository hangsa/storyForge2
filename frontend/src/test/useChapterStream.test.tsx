import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/* Mock EventSource mirrors the same shape as useAutopilotSession.test.tsx */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  lastEventIdAcked = 0;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Capture the Last-Event-ID header the browser would send on reconnect.
    // jsdom EventSource doesn't expose headers; we capture it through a
    // custom property the mock understands (set externally by tests).
    Promise.resolve().then(() => {
      this.readyState = 1;
      this.listeners["open"]?.forEach((fn) => fn(new MessageEvent("open")));
    });
  }
  addEventListener(t: string, fn: (ev: MessageEvent) => void) {
    (this.listeners[t] ??= []).push(fn);
  }
  close() {
    this.readyState = 2;
  }
  emit(type: string, data: unknown, id?: number) {
    if (id !== undefined) this.lastEventIdAcked = id;
    const ev = new MessageEvent(type, {
      data: typeof data === "string" ? data : JSON.stringify(data),
      lastEventId: id !== undefined ? String(id) : "",
    });
    (this.listeners[type] ?? []).forEach((fn) => fn(ev));
  }
  simulateError() {
    this.readyState = 0;
    this.listeners["error"]?.forEach((fn) => fn(new MessageEvent("error")));
  }
}

let openImpl: (
  handlers: {
    onEvent: (ev: unknown) => void;
    onError?: () => void;
  },
) => { close: () => void };

vi.mock("../api/autopilot", async () => {
  const real = await vi.importActual<typeof import("../api/autopilot")>(
    "../api/autopilot",
  );
  return {
    ...real,
    connectChapterStreamSSE: (
      _projectId: string,
      handlers: { onEvent: (e: unknown) => void; onError?: () => void },
    ) => openImpl(handlers),
  };
});

import { useChapterStream } from "../hooks/useChapterStream";

function setupMockConnect(
  impl: (
    handlers: { onEvent: (ev: unknown) => void; onError?: () => void },
  ) => { close: () => void },
) {
  openImpl = impl;
}

beforeEach(() => {
  MockEventSource.instances = [];
  setupMockConnect((handlers) => {
    const inst = new MockEventSource(
      "/api/v1/projects/proj_a/autopilot/chapter-stream",
    );
    for (const evt of [
      "scene_start", "scene_chunk", "scene_done", "scene_failed", "idle",
      "scene_transition",
    ] as const) {
      inst.addEventListener(evt, (raw: MessageEvent) => {
        handlers.onEvent({
          event: evt,
          data: JSON.parse(raw.data as string),
        });
      });
    }
    inst.addEventListener("error", () => handlers.onError?.());
    return { close: () => inst.close() };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const findInstance = () => {
  const arr = (MockEventSource as any).instances as MockEventSource[];
  return arr[arr.length - 1];
};

describe("useChapterStream", () => {
  it("buffers scene_chunk events into text", async () => {
    const { result } = renderHook(() => useChapterStream("proj_a"));

    // initial open
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 2 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "夜风" });
      inst.emit("scene_chunk",
        { seq: 2, chapter_number: 17, scene_number: 2, text: "如刀" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("夜风如刀");
      expect(result.current.active).toBe(true);
      expect(result.current.current).toEqual({ chapter: 17, scene: 2 });
    });
  });

  it("flips to inactive on scene_done without clearing text", async () => {
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 1 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 1, scene_number: 1, text: "x" });
      inst.emit("scene_done",
        { chapter_number: 1, scene_number: 1, status: "completed", total_chars: 1 });
    });

    await waitFor(() => {
      expect(result.current.active).toBe(false);
      expect(result.current.text).toBe("x");
      expect(result.current.failed).toBe(false);
    });
  });

  it("clears text immediately on scene_transition and resyncs on next scene_start", async () => {
    // Bug 2026-07-17: when the runner is between scenes, the backend emits
    // a `scene_transition` event (replacing the old `idle: current_task_changed
    // + close` behavior that caused reconnect thrash). The cockpit must
    // clear the previous scene's text right away and show a transitional
    // hint, then update normally when the next scene_start arrives.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 2 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "旧" });
    });
    await waitFor(() => {
      expect(result.current.text).toBe("旧");
    });

    act(() => {
      inst.emit("scene_transition",
        { reason: "current_task_changed", chapter_number: 17 });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("");
      expect(result.current.active).toBe(false);
      expect(result.current.current).toBeNull();
    });

    // The connection must stay open — the same EventSource receives the
    // next scene_start.
    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 3 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 3, text: "新" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新");
      expect(result.current.current).toEqual({ chapter: 17, scene: 3 });
      expect(result.current.active).toBe(true);
    });
    // Confirm we did NOT reconnect — the same instance received both events.
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("clears text on next scene_start arriving on the same connection after scene_done", async () => {
    // After the Direction B fix, scene_done does NOT close the EventSource.
    // The backend keeps the same connection open and emits the next
    // scene_start on it. The hook must still hard-reset text + header
    // when that scene_start arrives (mirroring the scene_transition case
    // at :144-188). The connection must remain singular — any reconnect
    // here would race the backend's history replay.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    // First scene: streaming normally.
    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 2 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "夜风如刀" });
    });
    await waitFor(() => {
      expect(result.current.text).toBe("夜风如刀");
      expect(result.current.current).toEqual({ chapter: 17, scene: 2 });
    });

    // scene_done — connection stays open. active flips to false, text
    // preserved so the user still sees the completed scene.
    act(() => {
      inst.emit("scene_done",
        { chapter_number: 17, scene_number: 2, status: "completed", total_chars: 4 });
    });

    await waitFor(() => {
      expect(result.current.active).toBe(false);
      expect(result.current.text).toBe("夜风如刀");
    });
    // Still a single connection — no reconnect on scene_done.
    expect((MockEventSource as any).instances.length).toBe(1);

    // Next scene_start arrives on the same connection — text must clear
    // and header must update to the new ch/scene.
    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 3 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 3, text: "新章开端" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新章开端");
      expect(result.current.current).toEqual({ chapter: 17, scene: 3 });
      expect(result.current.active).toBe(true);
    });
    // Confirm we did NOT reconnect throughout the entire scene transition.
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("ignores chunks for an older scene (stale-chunk guard)", async () => {
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 17, scene_number: 2 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "新" });
      // Stale chunk from ch16·scene1 arrives AFTER scene_start
      inst.emit("scene_chunk",
        { seq: 2, chapter_number: 16, scene_number: 1, text: "陈旧" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新");
    });
  });

  it("survives a replayed scene_done on the same connection without reconnecting", async () => {
    // Direction B regression: when the backend replays an old scene_done
    // (e.g., a scene_done that was already in the broadcaster history
    // when the current scene started), the hook must NOT call
    // scheduleReopen. The pre-fix code did exactly that, which led to an
    // infinite reconnect loop that throttled live chunks to the cockpit
    // (verified by curl: chapter-stream replays the last scene_done on
    // every fresh connect).
    //
    // Under Direction B the hook never reconnects after scene_done, so
    // the entire transition fits on a single EventSource instance.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 31, scene_number: 3 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 31, scene_number: 3, text: "旧场景" });
      inst.emit("scene_done",
        { chapter_number: 31, scene_number: 3, status: "completed" });
      // Backend history replay: the SAME scene_done arrives again.
      // Pre-fix this triggered scheduleReopen → new EventSource →
      // history replay → loop. Post-fix it must be a no-op.
      inst.emit("scene_done",
        { chapter_number: 31, scene_number: 3, status: "completed" });
    });

    // Next scene flows on the same connection.
    act(() => {
      inst.emit("scene_start", { chapter_number: 31, scene_number: 4 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 31, scene_number: 4, text: "新场景" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新场景");
      expect(result.current.current).toEqual({ chapter: 31, scene: 4 });
      expect(result.current.active).toBe(true);
    });
    // Hard assertion: exactly ONE EventSource for the whole scene cycle.
    // No escape hatch (length <= 3) — any reconnect here is a regression.
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("does not reconnect when backend replays multiple stale scene_done events on same connection", async () => {
    // The canonical regression test for the 2026-07-23 infinite-reconnect
    // bug on proj_a601cee9. Before the fix, scene_done fired
    // scheduleReopen(true) which closed the EventSource and opened a fresh
    // one. The fresh connection had no Last-Event-ID, so the backend
    // chapter_stream endpoint replayed the full broadcaster history —
    // which included the scene_done we had just processed. That
    // re-triggered scheduleReopen(true) again, ad infinitum. Browser
    // request throttling dropped live chunks, producing the visible
    // "实时写作流不更新" symptom.
    //
    // Post-fix, every scene_done is a no-op for connection management:
    // the backend keeps the same stream open, the next scene_start flows
    // through, and the hook must NOT create a second EventSource even
    // when scene_done is replayed many times.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 1 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 1, scene_number: 1, text: "夜风" });
      inst.emit("scene_done",
        { chapter_number: 1, scene_number: 1, status: "completed" });
      // Backend replays the SAME scene_done 3 more times — simulating
      // the broadcaster history being re-emitted (which is what happens
      // in production when the frontend force-reconnects without
      // Last-Event-ID).
      inst.emit("scene_done",
        { chapter_number: 1, scene_number: 1, status: "completed" });
      inst.emit("scene_done",
        { chapter_number: 1, scene_number: 1, status: "completed" });
      inst.emit("scene_done",
        { chapter_number: 1, scene_number: 1, status: "completed" });
    });

    // Sanity: the very first scene_done should have flipped active=false
    // without losing text. Subsequent replayed scene_dones must NOT
    // reconnect.
    await waitFor(() => {
      expect(result.current.active).toBe(false);
      expect(result.current.text).toBe("夜风");
    });
    expect((MockEventSource as any).instances.length).toBe(1);

    // The next scene_start arrives on the same connection and the next
    // scene's chunk is rendered. If the hook had reconnected even once
    // during the scene_done storm, instances.length would be >= 2 and
    // this assertion would fail.
    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 2 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 1, scene_number: 2, text: "新场景" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新场景");
      expect(result.current.current).toEqual({ chapter: 1, scene: 2 });
      expect(result.current.active).toBe(true);
    });
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("accepts scene_chunk replayed WITHOUT a prior scene_start (live reconnect)", async () => {
    // Bug 2026-07-17: when the browser opens a fresh SSE connection to a
    // project mid-stream, the backend's /chapter-stream replays existing
    // chunks from SceneChunkStore BEFORE any scene_start has been emitted
    // on the live broadcaster. The stale-chunk guard used to drop them
    // because currentSceneRef was still null, leaving the cockpit stuck on
    // "等待 AI 开始下一场景" until the next scene_start arrived.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      // No scene_start — only chunks. This mimics the SceneChunkStore
      // replay path on a fresh browser connect.
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "夜" });
      inst.emit("scene_chunk",
        { seq: 2, chapter_number: 17, scene_number: 2, text: "风" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("夜风");
      expect(result.current.current).toEqual({ chapter: 17, scene: 2 });
    });
  });

  it("ignores chunks whose seq <= lastSeq (dedup on reconnect)", async () => {
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 1 });
      inst.emit("scene_chunk",
        { seq: 5, chapter_number: 1, scene_number: 1, text: "seen" });
      // Replay chunk with older seq arrives — should be ignored
      inst.emit("scene_chunk",
        { seq: 5, chapter_number: 1, scene_number: 1, text: "duplicate" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("seen");
    });
  });

  it("uses partial_text only when buffer is non-empty on scene_failed (same connection)", async () => {
    // Direction B: scene_failed no longer reconnects. Buffer dedup
    // (don't overwrite accumulated text with partial_text) still applies
    // — verified on the same connection.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 1 });
      inst.emit("scene_chunk",
        { seq: 1, chapter_number: 1, scene_number: 1, text: "already-in" });
      inst.emit("scene_failed", {
        chapter_number: 1, scene_number: 1,
        error: "boom", partial_text: "already-in",
      });
    });

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
      expect(result.current.text).toBe("already-in"); // no duplicate
      expect(result.current.error).toContain("boom");
    });
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("uses partial_text when buffer is empty on scene_failed (same connection)", async () => {
    // Direction B: scene_failed with no prior chunks falls back to the
    // writer's partial_text. Single connection.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();

    act(() => {
      inst.emit("scene_start", { chapter_number: 1, scene_number: 1 });
      inst.emit("scene_failed", {
        chapter_number: 1, scene_number: 1,
        error: "kaboom", partial_text: "从writer拿到的部分文本",
      });
    });

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
      expect(result.current.text).toBe("从writer拿到的部分文本");
      expect(result.current.error).toContain("kaboom");
    });
    expect((MockEventSource as any).instances.length).toBe(1);
  });

  it("reconnects on error with dedup (single timer per error burst)", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      shouldAdvanceTime: true,
    });
    const { result } = renderHook(() => useChapterStream("proj_a"));
    let inst1 = findInstance();
    expect((MockEventSource as any).instances.length).toBe(1);

    act(() => {
      inst1.simulateError();
      inst1.simulateError(); // duplicate fire within same tick
      inst1.simulateError();
    });
    // Even with 3 errors back-to-back, only 1 reconnect should schedule.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect((MockEventSource as any).instances.length).toBe(2);

    // And the new connection should be wired to receive new events too.
    const inst2 = findInstance();
    act(() => {
      inst2.emit("scene_start", { chapter_number: 2, scene_number: 1 });
      inst2.emit("scene_chunk",
        { seq: 1, chapter_number: 2, scene_number: 1, text: "after-reconnect" });
    });
    await waitFor(() => {
      expect(result.current.text).toBe("after-reconnect");
    });
    vi.useRealTimers();
  });

  it("cleans up connection on unmount", async () => {
    const { unmount } = renderHook(() => useChapterStream("proj_a"));
    const inst = findInstance();
    await Promise.resolve(); // flush microtask that sets readyState=1
    expect(inst.readyState).toBe(1);
    unmount();
    expect(inst.readyState).toBe(2);
  });
});