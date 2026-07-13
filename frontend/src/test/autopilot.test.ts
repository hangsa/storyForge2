import { describe, it, expect, vi, beforeEach } from "vitest";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = 0;          // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;        // OPEN
      this.onopen?.(new Event("open"));
    }, 0);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.readyState = 2;
  }
  /** Test helper: emit a named SSE event with id + JSON payload. */
  emit(type: string, data: unknown, id?: number) {
    const ev = new MessageEvent(type, {
      data: typeof data === "string" ? data : JSON.stringify(data),
      lastEventId: id !== undefined ? String(id) : "",
    });
    (this.listeners[type] ?? []).forEach((fn) => fn(ev));
    if (type === "message" && this.onmessage) this.onmessage(ev);
  }
  /** Test helper: simulate transport error. */
  simulateError() {
    this.readyState = 0;
    const ev = new Event("error");
    this.onerror?.(ev);
    (this.listeners["error"] ?? []).forEach((fn) => fn(ev as unknown as MessageEvent));
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
});

import { connectAutopilotSSE } from "../api/autopilot";

describe("connectAutopilotSSE", () => {
  it("connects to the canonical autopilot SSE URL", () => {
    const handle = connectAutopilotSSE("p_1", { onEvent: () => {} });
    expect(MockEventSource.instances[0].url).toBe(
      "/api/v1/projects/p_1/autopilot/session/events"
    );
    handle.close();
  });

  it("forwards typed events to the subscriber", async () => {
    const events: { event: string; data: unknown; id?: number }[] = [];
    const handle = connectAutopilotSSE("p_2", {
      onEvent: (ev) => events.push(ev),
      onOpen: () => {},
      onError: () => {},
    });
    // Wait for open
    await new Promise((r) => setTimeout(r, 5));
    MockEventSource.instances[0].emit("snapshot", { state: "running" }, 1);
    MockEventSource.instances[0].emit("task_start", { chapter: 7 }, 2);
    expect(events).toEqual([
      { event: "snapshot", data: { state: "running" }, id: 1 },
      { event: "task_start", data: { chapter: 7 }, id: 2 },
    ]);
    handle.close();
  });

  it("parses JSON payloads automatically", async () => {
    const events: { event: string; data: unknown }[] = [];
    const handle = connectAutopilotSSE("p_3", {
      onEvent: (ev) => events.push(ev),
    });
    await new Promise((r) => setTimeout(r, 5));
    MockEventSource.instances[0].emit("task_complete", { chapter: 1, words: 2048 }, 5);
    expect(events[0].event).toBe("task_complete");
    expect(events[0].data).toEqual({ chapter: 1, words: 2048 });
    handle.close();
  });

  it("invokes onError when transport errors", async () => {
    const onError = vi.fn();
    const handle = connectAutopilotSSE("p_4", {
      onEvent: () => {},
      onError,
    });
    await new Promise((r) => setTimeout(r, 5));
    MockEventSource.instances[0].simulateError();
    expect(onError).toHaveBeenCalled();
    handle.close();
  });

  it("close() detaches handlers and terminates connection", () => {
    const handle = connectAutopilotSSE("p_5", { onEvent: () => {} });
    const inst = MockEventSource.instances[0];
    handle.close();
    expect(inst.readyState).toBe(2);
  });
});