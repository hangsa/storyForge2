import { describe, it, expect } from "vitest";
import type { NovelOutline } from "../api/client";
import { computePlannedTotal } from "../utils/outline";

function withVolumes(chapter_ranges: (string | null)[]): NovelOutline {
  return {
    core_conflict_theme: "",
    volumes: chapter_ranges.map((r, i) => ({
      name: `v${i}`,
      chapter_range: r ?? "",
      summary: "",
      key_events: [],
    })),
    mc_growth_arc: [],
    key_plot_points: [],
    generated_at: "",
    updated_at: "",
  };
}

describe("computePlannedTotal", () => {
  it("returns 0 when novelOutline is null", () => {
    expect(computePlannedTotal(null)).toBe(0);
  });

  it("returns 0 when volumes is empty", () => {
    expect(
      computePlannedTotal({
        core_conflict_theme: "",
        volumes: [],
        mc_growth_arc: [],
        key_plot_points: [],
        generated_at: "",
        updated_at: "",
      }),
    ).toBe(0);
  });

  it("parses a single '1-30' range to 30", () => {
    expect(computePlannedTotal(withVolumes(["1-30"]))).toBe(30);
  });

  it("tolerates whitespace inside the range", () => {
    expect(computePlannedTotal(withVolumes(["1 - 30"]))).toBe(30);
    expect(computePlannedTotal(withVolumes(["  1-30  "]))).toBe(30);
  });

  it("returns 0 for unparseable chapter_range", () => {
    expect(computePlannedTotal(withVolumes(["garbage"]))).toBe(0);
    expect(computePlannedTotal(withVolumes([""]))).toBe(0);
    expect(computePlannedTotal(withVolumes([null]))).toBe(0);
  });

  it("multi-volume novel: returns max end", () => {
    const novel = withVolumes(["1-30", "31-60", "61-90"]);
    expect(computePlannedTotal(novel)).toBe(90);
  });

  it("skips invalid ranges (end < start) but keeps valid ones", () => {
    expect(computePlannedTotal(withVolumes(["5-1", "1-30"]))).toBe(30);
  });

  it("skips ranges with start < 1", () => {
    // 0-30 is invalid (start < 1); 1-20 wins.
    expect(computePlannedTotal(withVolumes(["0-30", "1-20"]))).toBe(20);
  });

  it("a mix of valid + invalid + garbage returns the max of the valid ones", () => {
    expect(
      computePlannedTotal(withVolumes(["garbage", "1-10", "5-3", "11-25"])),
    ).toBe(25);
  });
});
