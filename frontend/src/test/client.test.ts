import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import api, { ApiError, request } from "../api/client";
import type { RawIntent } from "../api/client";

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
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    status: init.status ?? 200,
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    text: async () => text,
    json: async () => body,
  } as Response;
}

// Helper: build a Response-like that returns a non-JSON body (e.g. an upstream
// proxy error page). Mirrors the real fetch Response contract: text() succeeds,
// json() throws.
function makeNonJsonResponse(body: string, init: { status?: number } = {}): Response {
  return {
    status: init.status ?? 500,
    ok: false,
    text: async () => body,
    json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); },
  } as Response;
}

describe("empty success response handling", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns null for a successful JSON null response", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(null));

    await expect(request<void>("PUT", "/stage2/character", {})).resolves.toBeNull();
  });

  it("returns null for a successful response with no body", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse(undefined));

    await expect(request<void>("PUT", "/stage2/character", {})).resolves.toBeNull();
  });
});

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

  // v1.9: a 500 with a non-JSON body (e.g. an upstream proxy's HTML error page)
  // used to surface as bare "服务器返回无效响应 (500)" — impossible to debug.
  // Now the message includes the method, path, and a body preview.
  it("non-JSON 5xx surfaces method + path + body preview in the error", async () => {
    fetchSpy.mockResolvedValue(
      makeNonJsonResponse("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    let caught: unknown;
    try {
      await api.createProject({
        title: "测试项目", genre: "cool_novel", min_words: 2000,
        target_total_words: 1000000, target_length_category: "标准商业连载",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.code).toBe("PARSE_ERROR");
    expect(err.message).toContain("502");
    expect(err.message).toContain("POST");
    expect(err.message).toContain("/project/create");
    expect(err.message).toContain("502 Bad Gateway");
    expect(err.detail).toMatchObject({ path: "/project/create", status: 502 });
  });

  it("regenerateConceptSection_sendsSectionAndModifications", async () => {
    await api.regenerateConceptSection("p1", "concept", "更热血");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage1/regenerate-section?project_id=p1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "concept",
      user_modifications: "更热血",
    });
  });

  it("regenerateWorldSection_postsBody", async () => {
    await api.regenerateWorldSection("p1", "power_system", "");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage2/regenerate-world-section?project_id=p1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "power_system",
      user_modifications: "",
    });
  });

  it("regenerateCharacterSection_includesKeepExisting", async () => {
    await api.regenerateCharacterSection("p1", "c1", "personality", { keepExisting: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage2/regenerate-character-section?project_id=p1&character_id=c1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "personality",
      keep_existing: true,
      user_modifications: "",
    });
  });

  it("regenerateNovelOutlineSection_postsBody", async () => {
    await api.regenerateNovelOutlineSection("p1", "volumes", "");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stage3/regenerate-novel-outline-section?project_id=p1");
    expect(JSON.parse(init.body as string)).toEqual({
      section: "volumes",
      user_modifications: "",
    });
  });

  it("regenerateChapterOutlineRange_postsBody", async () => {
    await api.regenerateChapterOutlineRange("p1", 3, 5, "let me adjust");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/stage3/regenerate-chapter-outline?project_id=p1",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      chapter_start: 3,
      chapter_end: 5,
      user_modifications: "let me adjust",
    });
  });
});

// --- v2.1 Creative Divergence: postDivergeInit accepts RawIntent ---
//
// The backend /diverge/init endpoint now expects the full RawIntent shape
// (prompt + genre_primary + genre_secondary + target_reader + ...), not just
// a bare `premise` string. This test pins the new signature so callers
// (S0AInputStep in particular) don't silently fall back to the legacy
// {premise} body shape.
describe("postDivergeInit", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeJsonResponse({}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("accepts a RawIntent object (not just premise string)", async () => {
    const rawIntent: RawIntent = {
      prompt: "长生者寻死",
      genre_primary: "xianxia",
      genre_secondary: "xuanyi",
    };
    // TypeScript compile-time check: second arg accepts RawIntent type
    expect(typeof api.postDivergeInit).toBe("function");

    await api.postDivergeInit("proj_test", rawIntent);

    // Verify the body sent is the full RawIntent (not the legacy {premise} wrapper)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/proj_test/creative/diverge/init");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe("长生者寻死");
    expect(body.genre_primary).toBe("xianxia");
    expect(body.genre_secondary).toBe("xuanyi");
    // Crucial regression guard: must NOT wrap under {premise} anymore.
    expect(body.premise).toBeUndefined();
  });
});
