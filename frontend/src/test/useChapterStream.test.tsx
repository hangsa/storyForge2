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