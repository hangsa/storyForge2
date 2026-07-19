import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePromptDetail } from "../../hooks/usePromptDetail";

vi.mock("../../api/promptPlaza", () => ({
  getPlazaPrompt: vi.fn(),
}));

import { getPlazaPrompt } from "../../api/promptPlaza";

const SAMPLE_DETAIL = {
  name: "scene_writing",
  builtin_yaml: { system_prompt: "default", temperature: 0.9 },
  override: { temperature: 0.5, _modified_at: "x" },
  effective: { system_prompt: "default", temperature: 0.5 },
};

describe("usePromptDetail", () => {
  beforeEach(() => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockReset();
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => usePromptDetail("proj_x", null));
    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toBeNull();
    expect(getPlazaPrompt).not.toHaveBeenCalled();
  });

  it("fetches when name is provided", async () => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_DETAIL);
    const { result } = renderHook(() => usePromptDetail("proj_x", "scene_writing"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toEqual(SAMPLE_DETAIL);
    expect(result.current.error).toBeNull();
  });

  it("captures error on fetch failure", async () => {
    (getPlazaPrompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => usePromptDetail("proj_x", "scene_writing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("404");
  });
});