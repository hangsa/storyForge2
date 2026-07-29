import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useGenres } from "../hooks/useGenres";

vi.mock("../api/client", () => ({
  default: {
    listGenres: vi.fn().mockResolvedValue([
      { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
      { id: "xianxia", label_zh: "仙侠", label_en: "Xianxia", family: "cultivation", ui_visible: true },
      { id: "xuanhuan", label_zh: "玄幻", label_en: "Xuanhuan", family: "cultivation", ui_visible: true },
      { id: "dushi", label_zh: "都市", label_en: "Contemporary", family: "contemporary", ui_visible: true },
      { id: "kehuan", label_zh: "科幻", label_en: "Sci-Fi", family: "sci_fi", ui_visible: true },
      { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
      { id: "yanqing", label_zh: "言情", label_en: "Romance", family: "romance", ui_visible: true },
    ]),
  },
}));

describe("useGenres hook", () => {
  it("returns all 7 catalog genres", async () => {
    const { result } = renderHook(() => useGenres(true));
    await waitFor(() => {
      expect(result.current.length).toBe(7);
    });
    const ids = result.current.map((g) => g.id).sort();
    expect(ids).toEqual(["cool_novel", "dushi", "kehuan", "xianxia", "xuanhuan", "xuanyi", "yanqing"]);
  });

  it("includes the two previously missing genres (xuanyi, yanqing)", async () => {
    const { result } = renderHook(() => useGenres(true));
    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });
    const ids = result.current.map((g) => g.id);
    expect(ids).toContain("xuanyi");
    expect(ids).toContain("yanqing");
  });
});
