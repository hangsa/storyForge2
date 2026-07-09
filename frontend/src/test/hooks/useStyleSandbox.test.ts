import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStyleSandbox } from "../../hooks/useStyleSandbox";
import type { SavedStyleConfig } from "../../api/client";
import { DEFAULT_SANDBOX_PARAMS } from "../../api/client";

vi.mock("../../api/client", () => {
  const ApiError = class extends Error {};
  return {
    default: {
      styleSandboxPreview: vi.fn(),
      styleSandboxSave: vi.fn(),
      styleSandboxListConfigs: vi.fn(),
      styleSandboxLoadConfig: vi.fn(),
    },
    ApiError,
    DEFAULT_SANDBOX_PARAMS: {
      sentence: { avg_length_range: [15, 45], short_sentence_ratio: 0.3, paragraph_length_range: [80, 200] },
      dialogue: { ratio: 0.35, max_consecutive_lines: 6 },
      rhythm: { pacing_bpm: 300, scene_change_frequency: 0.5 },
      density: { description_ratio: 0.4, action_ratio: 0.3 },
      satisfaction: { satisfaction_beat_count: 5, suspense_hook_required: true },
    },
  };
});

import api from "../../api/client";

const CFG: SavedStyleConfig = {
  name: "x", path: "/p/x.yaml", params: DEFAULT_SANDBOX_PARAMS, created_at: "2026-06-29T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(api.styleSandboxPreview).mockReset();
  vi.mocked(api.styleSandboxSave).mockReset();
  vi.mocked(api.styleSandboxListConfigs).mockReset();
  vi.mocked(api.styleSandboxLoadConfig).mockReset();
});

describe("useStyleSandbox", () => {
  it("preview stores response", async () => {
    vi.mocked(api.styleSandboxPreview).mockResolvedValueOnce({
      rendered_text: "改写文本", source_avg_length: 30, rendered_avg_length: 15,
      tokens_used: 100,
    } as any);
    const { result } = renderHook(() => useStyleSandbox("p1"));
    await act(async () => { await result.current.preview("x".repeat(200), DEFAULT_SANDBOX_PARAMS); });
    expect(result.current.previewResponse?.rendered_text).toBe("改写文本");
  });

  it("save calls api and refreshes configs", async () => {
    vi.mocked(api.styleSandboxSave).mockResolvedValueOnce({ name: "x", path: "/p/x.yaml" } as any);
    vi.mocked(api.styleSandboxListConfigs).mockResolvedValueOnce({ configs: [CFG] } as any);
    const { result } = renderHook(() => useStyleSandbox("p1"));
    await act(async () => { await result.current.save("x", DEFAULT_SANDBOX_PARAMS); });
    expect(api.styleSandboxListConfigs).toHaveBeenCalledWith("p1");
    expect(result.current.configs).toEqual([CFG]);
  });

  it("loadConfigs populates configs state", async () => {
    vi.mocked(api.styleSandboxListConfigs).mockResolvedValueOnce({ configs: [CFG] } as any);
    const { result } = renderHook(() => useStyleSandbox("p1"));
    await act(async () => { await result.current.loadConfigs(); });
    expect(result.current.configs).toEqual([CFG]);
  });

  it("previewError stores message on failure", async () => {
    vi.mocked(api.styleSandboxPreview).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useStyleSandbox("p1"));
    await act(async () => { await result.current.preview("x".repeat(200), DEFAULT_SANDBOX_PARAMS); });
    expect(result.current.previewError).toBe("boom");
  });
});
