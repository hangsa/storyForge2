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

  it("clears text and updates header when next scene_start arrives after scene_done", async () => {
    // Bug 2026-07-17: cockpit showed the previous scene's text and the old
    // ch/scene header even after the runner moved on to the next scene.
    // After scene_done, the hook calls scheduleReopen(true) which closes the
    // old SSE and opens a new one. The new connection then receives
    // scene_start for the next scene — text must reset to empty, header must
    // show the new ch/scene, and chunks for the new scene must accumulate.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst1 = findInstance();

    // First scene: streaming normally.
    act(() => {
      inst1.emit("scene_start", { chapter_number: 17, scene_number: 2 });
      inst1.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 2, text: "夜风如刀" });
    });
    await waitFor(() => {
      expect(result.current.text).toBe("夜风如刀");
      expect(result.current.current).toEqual({ chapter: 17, scene: 2 });
    });

    // scene_done → scheduleReopen(true) → new EventSource is opened.
    act(() => {
      inst1.emit("scene_done",
        { chapter_number: 17, scene_number: 2, status: "completed", total_chars: 4 });
    });

    // After close + reopen, there should be a 2nd EventSource.
    await waitFor(() => {
      expect((MockEventSource as any).instances.length).toBe(2);
    });
    const inst2 = findInstance();

    // New scene starts on the new connection — text must clear and header
    // must update to the new ch/scene.
    act(() => {
      inst2.emit("scene_start", { chapter_number: 17, scene_number: 3 });
      inst2.emit("scene_chunk",
        { seq: 1, chapter_number: 17, scene_number: 3, text: "新章开端" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新章开端");
      expect(result.current.current).toEqual({ chapter: 17, scene: 3 });
      expect(result.current.active).toBe(true);
    });
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

  it("does not loop on replayed scene_done from broadcaster history", async () => {
    // Bug 2026-07-17: when the hook reconnects via scheduleReopen(true)
    // after scene_done, the new EventSource has no Last-Event-ID (close +
    // new EventSource is a fresh connection). The backend therefore replays
    // the FULL broadcaster history, which includes the scene_done we just
    // processed. The scene_done handler called scheduleReopen(true) again,
    // which closed and re-opened yet another EventSource — infinite loop,
    // and the new scene_start never gets processed because the connection
    // is being torn down before it arrives.
    const { result } = renderHook(() => useChapterStream("proj_a"));
    const inst1 = findInstance();

    act(() => {
      inst1.emit("scene_start", { chapter_number: 31, scene_number: 3 });
      inst1.emit("scene_done",
        { chapter_number: 31, scene_number: 3, status: "completed" });
    });

    // Wait for the post-scene_done reopen.
    await waitFor(() => {
      expect((MockEventSource as any).instances.length).toBe(2);
    });
    const inst2 = findInstance();

    // Backend history replay (no Last-Event-ID) sends the OLD scene_done
    // first. The hook MUST ignore it — otherwise it tears down inst2 again
    // before the real scene_start for the new scene can arrive.
    act(() => {
      inst2.emit("scene_done",
        { chapter_number: 31, scene_number: 3, status: "completed" });
      inst2.emit("scene_start", { chapter_number: 31, scene_number: 4 });
      inst2.emit("scene_chunk",
        { seq: 1, chapter_number: 31, scene_number: 4, text: "新场景" });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("新场景");
      expect(result.current.current).toEqual({ chapter: 31, scene: 4 });
      expect(result.current.active).toBe(true);
    });
    // Confirm we didn't thrash — at most 1 extra connection beyond inst2.
    expect((MockEventSource as any).instances.length).toBeLessThanOrEqual(3);
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

  it("uses partial_text only when buffer is empty on scene_failed", async () => {
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

    // Now: failed with NO chunks yet
    const inst2 = (MockEventSource as any).instances[1];
    act(() => {
      inst2.emit("scene_start", { chapter_number: 1, scene_number: 2 });
      inst2.emit("scene_failed", {
        chapter_number: 1, scene_number: 2,
        error: "kaboom", partial_text: "从writer拿到的部分文本",
      });
    });

    await waitFor(() => {
      expect(result.current.text).toBe("从writer拿到的部分文本");
    });
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