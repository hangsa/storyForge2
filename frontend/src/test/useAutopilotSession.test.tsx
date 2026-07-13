import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
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

const { fakeSession } = vi.hoisted(() => ({
  fakeSession: (overrides = {}) => ({
    project_id: "p",
    state: "running" as const,
    current_task: { description: "writing chapter 7" },
    queue: [],
    history: [],
    config: { scope: "all_planned", cadence: "balanced", policy: "auto", notify: "milestones" },
    ...overrides,
  }),
}));

vi.mock("../api/autopilot", () => ({
  connectAutopilotSSE: (
    projectId: string,
    handlers: { onEvent: (e: unknown) => void; onOpen?: () => void; onError?: () => void },
  ) => {
    const inst = new (globalThis as any).MockEventSourceRef(
      `/api/v1/projects/${projectId}/autopilot/session/events`,
    );
    // Mirror real client: wire open/error via addEventListener so the
    // MockEventSource's open/error events reach our handlers.
    inst.addEventListener("open", () => handlers.onOpen?.());
    inst.addEventListener("error", () => handlers.onError?.());
    const typed = [
      "snapshot", "session_start", "task_start", "task_complete", "task_fail",
      "decision", "circuit_open", "circuit_close", "queue_add", "queue_remove",
    ];
    for (const ev of typed) {
      inst.addEventListener(ev, (raw: MessageEvent) => {
        let data: unknown = raw.data;
        try { data = JSON.parse(raw.data as string); } catch { /* keep as string */ }
        handlers.onEvent({ event: ev, data, id: raw.lastEventId ? Number(raw.lastEventId) : undefined });
      });
    }
    (globalThis as any).__lastInstance = inst;
    return { close: () => inst.close() };
  },
  getAutopilotSession: vi.fn().mockResolvedValue(fakeSession()),
  startAutopilotSession: vi.fn().mockResolvedValue(fakeSession()),
  stopAutopilotSession: vi.fn().mockResolvedValue(undefined),
  pauseAutopilotSession: vi.fn().mockResolvedValue(undefined),
  resumeAutopilotSession: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "../api/autopilot";
import { useAutopilotSession } from "../hooks/useAutopilotSession";

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  (globalThis as any).MockEventSourceRef = MockEventSource;
  (api as any).getAutopilotSession.mockClear();
  (api as any).startAutopilotSession.mockClear();
  (api as any).stopAutopilotSession.mockClear();
  (api as any).pauseAutopilotSession.mockClear();
  (api as any).resumeAutopilotSession.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).MockEventSourceRef;
  delete (globalThis as any).__lastInstance;
});

describe("useAutopilotSession", () => {
  it("loads initial session via REST on mount", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    expect(result.current.session?.state).toBe("running");
  });

  it("transitions to 'connected' after EventSource opens", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("accumulates events in the events buffer", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const inst = MockEventSource.instances[0];
    await act(async () => {
      inst.emit("task_complete", { chapter: 1 }, 5);
      inst.emit("circuit_open", { reason: "guard failure" }, 6);
    });
    expect(result.current.events.map((e) => e.event)).toEqual([
      "task_complete",
      "circuit_open",
    ]);
  });

  it("updates session.current_task on the latest snapshot", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    const inst = MockEventSource.instances[0];
    await act(async () => {
      inst.emit("snapshot", fakeSession({
        current_task: { description: "rewriting chapter 4" },
      }), 10);
      await Promise.resolve();
    });
    expect(result.current.session?.current_task?.description).toBe(
      "rewriting chapter 4"
    );
  });

  it("reconnects with exponential backoff on error", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useAutopilotSession("p"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(MockEventSource.instances.length).toBe(1);
      // First error -> reconnect after 1s
      await act(async () => {
        MockEventSource.instances[0].simulateError();
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(MockEventSource.instances.length).toBe(2);
      // Second error -> 2s
      await act(async () => {
        MockEventSource.instances[1].simulateError();
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(MockEventSource.instances.length).toBe(3);
      // After the 2nd reconnect succeeds, status is back to "connected".
      expect(result.current.status).toBe("connected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("status transitions to 'error' after exhausting backoff retries", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useAutopilotSession("p"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      // 6 retries exhaust the backoff table; each delayed attempt fires another error.
      for (let i = 0; i < 6; i++) {
        const inst = MockEventSource.instances[MockEventSource.instances.length - 1];
        await act(async () => {
          inst.simulateError();
          await vi.advanceTimersByTimeAsync(31_000);
        });
      }
      expect(result.current.status).toBe("error");
      // No 7th reconnect scheduled.
      const before = MockEventSource.instances.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(MockEventSource.instances.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("start() calls API and refreshes session", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(async () => {
      await result.current.start({
        scope: "next_chapter",
        cadence: "fast",
        policy: "ask",
        notify: "all",
      });
    });
    expect(api.startAutopilotSession).toHaveBeenCalledWith("p", {
      scope: "next_chapter",
      cadence: "fast",
      policy: "ask",
      notify: "all",
    });
  });

  it("stop() calls API", async () => {
    const { result } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(async () => {
      await result.current.stop();
    });
    expect(api.stopAutopilotSession).toHaveBeenCalledWith("p");
  });

  it("unmount tears down EventSource", async () => {
    const { unmount } = renderHook(() => useAutopilotSession("p"));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const inst = MockEventSource.instances[0];
    unmount();
    expect(inst.readyState).toBe(2);
  });
});