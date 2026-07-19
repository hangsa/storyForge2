import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePromptList } from "../../hooks/usePromptList";

vi.mock("../../api/promptPlaza", () => ({
  listPlazaPrompts: vi.fn(),
}));

import { listPlazaPrompts } from "../../api/promptPlaza";

const SAMPLE = [
  { name: "scene_writing", category: "", label: "场景写作", has_override: false, modified_at: null, builtin: true },
  { name: "mutation", category: "creative", label: "变异", has_override: true, modified_at: "2026-07-19T00:00:00Z", builtin: true },
];

describe("usePromptList", () => {
  beforeEach(() => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockReset();
  });

  it("starts in loading state, then resolves with prompts", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => usePromptList("proj_x"));
    expect(result.current.loading).toBe(true);
    expect(result.current.prompts).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.prompts).toEqual(SAMPLE);
    expect(result.current.error).toBeNull();
  });

  it("captures error on fetch failure", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => usePromptList("proj_x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network");
    expect(result.current.prompts).toEqual([]);
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => usePromptList(null));
    expect(result.current.loading).toBe(false);
    expect(listPlazaPrompts).not.toHaveBeenCalled();
  });

  it("refresh() re-fetches", async () => {
    (listPlazaPrompts as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => usePromptList("proj_x"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listPlazaPrompts).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refresh();
    });
    expect(listPlazaPrompts).toHaveBeenCalledTimes(2);
  });
});