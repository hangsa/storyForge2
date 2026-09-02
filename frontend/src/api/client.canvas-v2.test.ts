import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, type RawIntent } from "@/api/client";

// Mirrors makeJsonResponse in src/test/client.test.ts — local copy because
// that helper is not exported.
function makeJsonResponse(body: unknown, status = 200): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
    json: async () => body,
  } as Response;
}

describe("v2 canvas API client methods", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const pid = "proj_x";

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ detail: { ok: true } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("postCanvasV2Init sends RawIntent to /creative/canvas/{pid}/session/init", async () => {
    const rawIntent: RawIntent = { prompt: "p", genre_primary: "xianxia" };
    await api.postCanvasV2Init(pid, rawIntent);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/creative/canvas/${pid}/session/init`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe("p");
    expect(body.genre_primary).toBe("xianxia");
  });

  it("getCanvasV2State fetches /creative/canvas/{pid}/session/state", async () => {
    await api.getCanvasV2State(pid);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/creative/canvas/${pid}/session/state`);
    expect(init.method).toBe("GET");
  });

  it("postCanvasV2NextStep sends current_step", async () => {
    await api.postCanvasV2NextStep(pid, { current_step: 2 });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/creative/canvas/${pid}/session/next-step`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).current_step).toBe(2);
  });

  it("postCanvasV2Select sends step + option_id", async () => {
    await api.postCanvasV2Select(pid, { step: 1, option_id: "opt_1_b" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/creative/canvas/${pid}/session/select`);
    const body = JSON.parse(init.body as string);
    expect(body.step).toBe(1);
    expect(body.option_id).toBe("opt_1_b");
  });

  it("postCanvasV2Commit posts empty body to /session/commit", async () => {
    await api.postCanvasV2Commit(pid);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/creative/canvas/${pid}/session/commit`);
    expect(init.method).toBe("POST");
  });
});
