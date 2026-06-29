import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStage4Impact } from "../../hooks/useStage4Impact";

vi.mock("../../api/client", () => {
  const ApiError = class extends Error {};
  return { default: { analyzeImpact: vi.fn() }, ApiError };
});
import api from "../../api/client";

describe("useStage4Impact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("run_succeeds_setsReport", async () => {
    const report = { items: [{ priority: "P0", file: "x.md", description: "d" }] };
    vi.mocked(api.analyzeImpact).mockResolvedValueOnce(report);
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    expect(result.current.report).toEqual(report);
    expect(result.current.error).toBeNull();
  });

  it("run_fails_setsError", async () => {
    vi.mocked(api.analyzeImpact).mockRejectedValueOnce(new Error("LLM down"));
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    expect(result.current.report).toBeNull();
    expect(result.current.error).toBe("LLM down");
  });

  it("clear_emptiesReport", async () => {
    vi.mocked(api.analyzeImpact).mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() => useStage4Impact("proj_1"));
    await act(async () => { await result.current.run(); });
    act(() => result.current.clear());
    expect(result.current.report).toBeNull();
  });
});
