import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGrowthWorkshop } from "../../hooks/useGrowthWorkshop";
import type { ConsistencyWarning, WorkshopCheckResult } from "../../api/client";

vi.mock("../../api/client", () => {
  const ApiError = class extends Error {};
  return {
    default: {
      growthWorkshopCheck: vi.fn(),
      growthWorkshopAdjust: vi.fn(),
      growthWorkshopDiscuss: vi.fn(),
    },
    ApiError,
  };
});

import api from "../../api/client";

const FAKE_WARNINGS: ConsistencyWarning[] = [
  { rule_id: "tight_spacing", severity: "warning", stage_index: 1,
    chapter_number: 4, message: "间隔太近", suggestion: "拉大" },
];
const FAKE_RESULT: WorkshopCheckResult = {
  character_id: "c1", warnings: FAKE_WARNINGS, checked_at: "2026-06-29T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(api.growthWorkshopCheck).mockReset();
  vi.mocked(api.growthWorkshopAdjust).mockReset();
  vi.mocked(api.growthWorkshopDiscuss).mockReset();
});

describe("useGrowthWorkshop", () => {
  it("check stores result on success", async () => {
    vi.mocked(api.growthWorkshopCheck).mockResolvedValueOnce(FAKE_RESULT as any);
    const { result } = renderHook(() => useGrowthWorkshop("p1"));
    await act(async () => { await result.current.check("c1"); });
    expect(result.current.checkResult).toEqual(FAKE_RESULT);
    expect(result.current.checkError).toBeNull();
  });

  it("check stores error message on failure", async () => {
    vi.mocked(api.growthWorkshopCheck).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useGrowthWorkshop("p1"));
    await act(async () => { await result.current.check("c1"); });
    expect(result.current.checkResult).toBeNull();
    expect(result.current.checkError).toBe("boom");
  });

  it("adjust calls API and returns warnings", async () => {
    vi.mocked(api.growthWorkshopAdjust).mockResolvedValueOnce({
      stages: [], warnings: [],
    } as any);
    const { result } = renderHook(() => useGrowthWorkshop("p1"));
    let warnings: any;
    await act(async () => { warnings = await result.current.adjust("c1", []); });
    expect(api.growthWorkshopAdjust).toHaveBeenCalledWith("p1", "c1", { stages: [] });
    expect(warnings).toEqual([]);
  });

  it("discuss returns answer from API", async () => {
    vi.mocked(api.growthWorkshopDiscuss).mockResolvedValueOnce({
      answer: "节奏过快", suggestions: ["减少转折"], skipped_reason: undefined,
    } as any);
    const { result } = renderHook(() => useGrowthWorkshop("p1"));
    let resp: any;
    await act(async () => { resp = await result.current.discuss("c1", "节奏？"); });
    expect(resp.answer).toBe("节奏过快");
    expect(api.growthWorkshopDiscuss).toHaveBeenCalledWith("p1", "c1", { question: "节奏？" });
  });
});