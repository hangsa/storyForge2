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

// --- 4xx/5xx contract (proj 2026-09-11, S1→S2 decompose regression) -----------
//
// Backend two HTTPException styles coexist today:
//   - Style A (nested envelope, ~project.py):  {"detail": {error: true, code, message, detail}}
//   - Style B (bare string, ~three_b_routes.py + most error paths): {"detail": "<字符串>"}
//
// Pre-fix, `request()` only threw on Style A (and top-level `error`). Style B
// 4xx/5xx responses slipped through as data — the S1→S2 decompose call returned
// `"DECOMPOSE_FAILED: 'genre_secondary'"` (string) as if it were a successful
// decomposition, the reducer coerced undefined `dimensions` to `[]`, no error
// banner showed, and the user perceived "nothing happened".
//
// These tests lock the post-fix contract: any 4xx/5xx with a parseable JSON
// body must throw ApiError. The ONLY exception is the probe-result case
// (2xx + `detail.error` is a STRING, not boolean true) which is a success
// payload from /llm-config/probe.
describe("4xx/5xx must throw ApiError (proj 2026-09-11 regression guard)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("throws ApiError on style-B 503 with bare string detail", async () => {
    // This is the EXACT shape three_b_routes.py /decompose returned when
    // firstness_decompose.yaml referenced {genre_secondary} and the
    // .format(**fmt) call raised KeyError. Before the fix, request()
    // returned the string as data and the reducer silently swallowed it.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ detail: "DECOMPOSE_FAILED: 'genre_secondary'" }, { status: 503 }),
    );

    await expect(request("POST", "/decompose", { prompt: "x".repeat(20) })).rejects.toBeInstanceOf(ApiError);
    await expect(request("POST", "/decompose", { prompt: "x".repeat(20) })).rejects.toMatchObject({
      code: "HTTP_503",
      message: "DECOMPOSE_FAILED: 'genre_secondary'",
    });
  });

  it("throws ApiError on style-A 400 with nested envelope", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse(
        {
          detail: {
            error: true,
            code: "VALIDATION_ERROR",
            message: "项目名称必填",
            detail: {},
          },
        },
        { status: 400 },
      ),
    );

    let caught: unknown;
    try {
      await request("POST", "/project/create", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("VALIDATION_ERROR");
    expect((caught as ApiError).message).toBe("项目名称必填");
  });

  it("throws ApiError on 422 with bare string detail (FastAPI default ValidationError)", async () => {
    // FastAPI's request-validation 422 returns `{"detail": [{loc, msg, type}, ...]}`
    // (array, not string). That's neither top-level error nor nested envelope,
    // so it slipped through pre-fix. The new fallback catches it.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse(
        {
          detail: [{ loc: ["body", "prompt"], msg: "field required", type: "value_error.missing" }],
        },
        { status: 422 },
      ),
    );

    await expect(request("POST", "/x", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError on 422 with FORBIDDEN_TERM_DETECTED envelope (style A path still works)", async () => {
    // The existing outlineGuardRetry.ts path. Backend wraps detail={code,
    // detail:{violations:[...]}} under HTTPException(detail=envelope). Style
    // A's nested-error check fires first, then callers can read err.detail.violations.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse(
        {
          detail: {
            error: true,
            code: "FORBIDDEN_TERM_DETECTED",
            message: "违反了白名单",
            detail: { violations: [{ path: "ch1", term: "元婴", snippet: "..." }] },
          },
        },
        { status: 422 },
      ),
    );

    let caught: unknown;
    try {
      await request("POST", "/x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("FORBIDDEN_TERM_DETECTED");
    expect((caught as ApiError).detail).toMatchObject({
      violations: [{ path: "ch1", term: "元婴", snippet: "..." }],
    });
  });

  it("does NOT throw on probe-result success (200 + detail.error is a string)", async () => {
    // The carve-out that justified the existing nested-error-only check:
    // /llm-config/probe returns 200 with body shaped like:
    //   {detail: {success: false, error: "Invalid API key", error_code: "auth_error"}}
    // Here detail.error is the STRING "Invalid API key", not boolean true —
    // we must NOT mis-parse it as an error envelope. The probe caller reads
    // result.detail.error / .error_code to surface the auth error in the UI.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({
        detail: {
          success: false,
          error: "Invalid API key",
          error_code: "auth_error",
        },
      }, { status: 200 }),
    );

    const result = await request<{ success: boolean; error: string; error_code: string }>(
      "POST",
      "/llm-config/probe",
      {},
    );
    expect(result).toEqual({
      success: false,
      error: "Invalid API key",
      error_code: "auth_error",
    });
  });

  it("throws ApiError when status is 4xx but body is empty", async () => {
    // 404 with empty body — the request helper's existing empty-body branch
    // would have returned null silently pre-fix, breaking any reducer that
    // assumed the call reached the backend.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse(undefined, { status: 404 }),
    );

    await expect(request("GET", "/missing")).rejects.toBeInstanceOf(ApiError);
    await expect(request("GET", "/missing")).rejects.toMatchObject({ code: "HTTP_404" });
  });

  it("ApiError thrown from style-B path carries status + parsed body in detail", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeJsonResponse({ detail: "rate limited" }, { status: 429 }),
    );

    let caught: unknown;
    try {
      await request("POST", "/x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.detail).toMatchObject({
      path: "/x",
      status: 429,
      body: { detail: "rate limited" },
    });
  });
});
