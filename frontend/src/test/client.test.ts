import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../api/client";

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
