import { describe, it, expect, vi, beforeEach } from "vitest";
import { rangePreview } from "../autopilot";

vi.mock("../client", () => ({
  default: {
    rangePreview: vi.fn(),
  },
}));

import api from "../client";

describe("rangePreview", () => {
  beforeEach(() => {
    vi.mocked(api.rangePreview).mockReset();
  });

  it("calls api.rangePreview with correct args", async () => {
    vi.mocked(api.rangePreview).mockResolvedValue({
      outline_max: 12,
      valid: true,
      error: null,
      regenerate_chapters: [2, 3],
      defaults: { start_chapter: 4, end_chapter: 12 },
    });

    const result = await rangePreview("p1", 5, 10);

    expect(api.rangePreview).toHaveBeenCalledWith("p1", 5, 10, undefined);
    expect(result.outline_max).toBe(12);
    expect(result.regenerate_chapters).toEqual([2, 3]);
  });

  it("passes scope when provided", async () => {
    vi.mocked(api.rangePreview).mockResolvedValue({
      outline_max: 0,
      valid: false,
      error: "项目缺少 outline.json",
      regenerate_chapters: [],
      defaults: null,
    });

    await rangePreview("p1", 1, 5, "all_planned");

    expect(api.rangePreview).toHaveBeenCalledWith("p1", 1, 5, "all_planned");
  });

  it("returns the preview shape unchanged", async () => {
    vi.mocked(api.rangePreview).mockResolvedValue({
      outline_max: 0,
      valid: false,
      error: "项目缺少 outline.json",
      regenerate_chapters: [],
      defaults: null,
    });

    const result = await rangePreview("p1", 1, 5);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("项目缺少 outline.json");
    expect(result.regenerate_chapters).toEqual([]);
    expect(result.defaults).toBeNull();
  });
});