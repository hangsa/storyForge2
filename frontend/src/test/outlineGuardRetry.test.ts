import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  buildViolationFeedback,
  extractViolations,
  runWithGuardRetry,
} from "../utils/outlineGuardRetry";

function forbiddenError(violations: { path: string; term: string; snippet: string }[]) {
  return new ApiError(
    "FORBIDDEN_TERM_DETECTED",
    "章节大纲包含 N 处未在世界观中声明的境界术语",
    { violations },
  );
}

describe("buildViolationFeedback", () => {
  it("lists each violation as 'term @ path'", () => {
    const fb = buildViolationFeedback([
      { path: "chapters[2].scenes[0].conflict", term: "元婴", snippet: "..." },
      { path: "chapters[3].scenes[1].goal", term: "金丹", snippet: "..." },
    ]);
    expect(fb).toContain("'元婴' @ chapters[2].scenes[0].conflict");
    expect(fb).toContain("'金丹' @ chapters[3].scenes[1].goal");
  });

  it("summarizes overflow when > 5 violations", () => {
    const vs = Array.from({ length: 8 }, (_, i) => ({
      path: `chapters[${i}].x`, term: "元婴", snippet: "",
    }));
    expect(buildViolationFeedback(vs)).toContain("（共 8 处）");
  });

  it("does not include overflow marker when ≤ 5 violations", () => {
    const vs = Array.from({ length: 5 }, (_, i) => ({
      path: `chapters[${i}].x`, term: "元婴", snippet: "",
    }));
    expect(buildViolationFeedback(vs)).not.toContain("（共");
  });
});

describe("extractViolations", () => {
  it("returns null for non-ApiError", () => {
    expect(extractViolations(new Error("net"))).toBeNull();
  });

  it("returns null when code is not FORBIDDEN_TERM_DETECTED", () => {
    expect(extractViolations(new ApiError("OTHER", "msg", {}))).toBeNull();
  });

  it("returns null when detail.violations is missing", () => {
    expect(extractViolations(new ApiError("FORBIDDEN_TERM_DETECTED", "msg", {}))).toBeNull();
  });

  it("returns the violations array on a matching 422", () => {
    const vs = [{ path: "x", term: "元婴", snippet: "..." }];
    expect(extractViolations(forbiddenError(vs))).toEqual(vs);
  });
});

describe("runWithGuardRetry", () => {
  it("returns immediately on first success (no retry)", async () => {
    const call = vi.fn().mockResolvedValue({ ok: true });
    const result = await runWithGuardRetry(call, "");
    expect(result).toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries up to 3 times and surfaces attempt counts", async () => {
    let n = 0;
    const call = vi.fn(async (mods: string) => {
      n += 1;
      if (n < 3) {
        throw forbiddenError([{ path: "x", term: "元婴", snippet: "..." }]);
      }
      return { ok: true };
    });

    const result = await runWithGuardRetry(call, "user-said-X", {
      onAttempt: () => {},
    });
    expect(result).toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(3);
    // First call: original mods; second call: original + feedback; third call: original + 2× feedback.
    const firstMods = call.mock.calls[0][0] as string;
    const secondMods = call.mock.calls[1][0] as string;
    const thirdMods = call.mock.calls[2][0] as string;
    expect(firstMods).toBe("user-said-X");
    expect(secondMods).toContain("user-said-X");
    expect(secondMods).toContain("【自动反馈");
    expect(thirdMods).toContain("【自动反馈");
  });

  it("throws the last ApiError after maxAttempts is exhausted", async () => {
    const call = vi.fn(async () => {
      throw forbiddenError([{ path: "x", term: "元婴", snippet: "..." }]);
    });
    await expect(runWithGuardRetry(call, "", { maxAttempts: 3 })).rejects.toMatchObject({
      code: "FORBIDDEN_TERM_DETECTED",
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-FORBIDDEN errors (e.g. network)", async () => {
    const call = vi.fn(async () => {
      throw new ApiError("NETWORK_ERROR", "fetch failed", {});
    });
    await expect(runWithGuardRetry(call, "")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("onAttempt fires once per attempt with 1-based index", async () => {
    let n = 0;
    const call = vi.fn(async () => {
      n += 1;
      if (n < 2) throw forbiddenError([{ path: "x", term: "元婴", snippet: "" }]);
      return "ok";
    });
    const seen: number[] = [];
    await runWithGuardRetry(call, "", { onAttempt: (a) => seen.push(a) });
    expect(seen).toEqual([1, 2]);
  });
});
