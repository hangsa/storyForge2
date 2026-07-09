import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStage4Exemptions } from "../../hooks/useStage4Exemptions";

vi.mock("../../api/client", () => ({
  default: {
    listExemptions: vi.fn(),
    approveExemption: vi.fn(),
    rejectExemption: vi.fn(),
    getExemptionAntipatterns: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
import api from "../../api/client";

const sampleItem = {
  id: "ex1", scene_id: "s1",
  rule_to_break: { layer: "L1", rule_id: "r1", rule_description: "d", constraint_type: "c" },
  creative_intent: "i", expected_effect: "e", status: "pending" as const,
  requested_by: "writer", requested_at: "2026-06-29T00:00:00Z",
  approved_by: null, rejected_reason: null, outcome: null,
};

describe("useStage4Exemptions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refresh_succeeds_setsItems", async () => {
    vi.mocked(api.listExemptions).mockResolvedValueOnce([sampleItem]);
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.items).toEqual([sampleItem]);
    expect(result.current.error).toBeNull();
  });

  it("refresh_fails_setsError", async () => {
    vi.mocked(api.listExemptions).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe("boom");
  });

  it("approve_callsApiAndRefreshes", async () => {
    vi.mocked(api.approveExemption).mockResolvedValueOnce({ id: "ex1", status: "approved" });
    vi.mocked(api.listExemptions).mockResolvedValueOnce([]);  // post-approve refresh
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    await act(async () => { await result.current.approve("ex1", "user_default"); });
    expect(api.approveExemption).toHaveBeenCalledWith("proj_1", "ex1", "user_default");
    expect(api.listExemptions).toHaveBeenCalledWith("proj_1", "pending");
  });

  it("reject_callsApiAndRefreshes", async () => {
    vi.mocked(api.rejectExemption).mockResolvedValueOnce({ id: "ex1", status: "rejected" });
    vi.mocked(api.listExemptions).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    await act(async () => { await result.current.reject("ex1", "不通过"); });
    expect(api.rejectExemption).toHaveBeenCalledWith("proj_1", "ex1", "不通过");
    expect(api.listExemptions).toHaveBeenCalledWith("proj_1", "pending");
  });

  it("getAntipatterns_succeeds_returnsArray", async () => {
    const antipatterns = [{ rule_id: "r1", creative_intent_pattern: "p", count: 3, representative_case: "x" }];
    vi.mocked(api.getExemptionAntipatterns).mockResolvedValueOnce(antipatterns);
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    let out: typeof antipatterns = [];
    await act(async () => { out = await result.current.getAntipatterns("ex1"); });
    expect(out).toEqual(antipatterns);
  });

  it("getAntipatterns_fails_returnsEmptyArray", async () => {
    vi.mocked(api.getExemptionAntipatterns).mockRejectedValueOnce(new Error("err"));
    const { result } = renderHook(() => useStage4Exemptions("proj_1"));
    let out: unknown[] | null = null;
    await act(async () => { out = await result.current.getAntipatterns("ex1"); });
    expect(out).toEqual([]);
  });
});
