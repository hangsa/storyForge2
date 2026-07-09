import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import api, { ApiError } from "../api/client";

describe("ApiError", () => {
  it("creates error with code and message", () => {
    const err = new ApiError("TEST_ERROR", "测试错误", { key: "value" });
    expect(err.code).toBe("TEST_ERROR");
    expect(err.message).toBe("测试错误");
    expect(err.detail).toEqual({ key: "value" });
    expect(err.name).toBe("ApiError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("HTTP error format handling", () => {
  it("recognizes FastAPI error format", () => {
    const fastApiError = {
      detail: {
        error: true,
        code: "PROJECT_NOT_FOUND",
        message: "项目 test 不存在",
        detail: {},
      },
    };
    const errorPayload = fastApiError.detail || fastApiError;
    expect(errorPayload.error).toBe(true);
    expect(errorPayload.code).toBe("PROJECT_NOT_FOUND");
    expect(errorPayload.message).toBe("项目 test 不存在");
  });

  it("recognizes direct error format", () => {
    const directError: Record<string, unknown> = {
      error: true,
      code: "VALIDATION_ERROR",
      message: "intent 不能为空",
    };
    // Same logic as client.ts: unwrap FastAPI detail wrapper or use direct
    const errorPayload = (directError.detail as Record<string, unknown>) || directError;
    expect(errorPayload.error).toBe(true);
    expect(errorPayload.code).toBe("VALIDATION_ERROR");
  });

  it("handles success response (error: false)", () => {
    const successResp: Record<string, unknown> = {
      error: false,
      code: "OK",
      message: "",
    };
    const errorPayload = (successResp.detail as Record<string, unknown>) || successResp;
    expect(errorPayload.error).toBe(false);
  });
});

// Helper: build a mock Response-like object that the real `request<T>` accepts.
function makeJsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return {
    status: init.status ?? 200,
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    json: async () => body,
  } as Response;
}

describe("stage4 exemptions + sf-log + precheck client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("listExemptions_sendsPendingByDefault", async () => {
    await api.listExemptions("p1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/exemptions?status=pending");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("listExemptions_respectsStatusParam", async () => {
    await api.listExemptions("p1", "approved");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/exemptions?status=approved");
    expect(init.method).toBe("GET");
  });

  it("approveExemption_sendsApprovedByAsQuery", async () => {
    await api.approveExemption("p1", "e1", "alice");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/exemptions/e1/approve?approved_by=alice");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeUndefined();
  });

  it("rejectExemption_sendsReasonAsQuery", async () => {
    await api.rejectExemption("p1", "e1", "no");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/exemptions/e1/reject?reason=no");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeUndefined();
  });

  it("getExemptionAntipatterns_callsGetEndpoint", async () => {
    await api.getExemptionAntipatterns("p1", "e1");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/exemptions/e1/antipatterns");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("suggestSFLogChanges_postsBody", async () => {
    await api.suggestSFLogChanges("p1", "s1", "original-text", "modified-text");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/scenes/s1/sf-log-suggestions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      original_text: "original-text",
      modified_text: "modified-text",
    });
  });

  it("applySFLogSuggestions_putsBody", async () => {
    const suggestions = [
      {
        type: "missing" as const,
        severity: "warning" as const,
        event_type: "character_emotion",
        suggested_tag: "<!-- SF_LOG character_emotion -->",
        location_hint: "段1",
        reason: "缺少情绪标记",
      },
    ];
    await api.applySFLogSuggestions("p1", "s1", "scene-text", suggestions);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/p1/scenes/s1/sf-logs");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "scene-text",
      suggestions,
    });
  });
});
