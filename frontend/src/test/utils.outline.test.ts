import { describe, it, expect } from "vitest";
import type { NovelOutline } from "../api/client";
import {
  computeFirstVolumeEnd,
  computePlannedTotal,
  parseVolumes,
  groupChaptersByVolume,
  type ParsedVolume,
  type WorkspaceVolumeGroup,
  type WorkspaceChapterNode,
} from "../utils/outline";

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

describe("computeFirstVolumeEnd", () => {
  it("returns 0 when novelOutline is null", () => {
    expect(computeFirstVolumeEnd(null)).toBe(0);
  });

  it("returns 0 when volumes is empty", () => {
    expect(
      computeFirstVolumeEnd({
        core_conflict_theme: "",
        volumes: [],
        mc_growth_arc: [],
        key_plot_points: [],
        generated_at: "",
        updated_at: "",
      }),
    ).toBe(0);
  });

  it("returns Volume 1's end for a single-volume novel", () => {
    expect(computeFirstVolumeEnd(withVolumes(["1-50"]))).toBe(50);
  });

  it("returns only Volume 1's end for a multi-volume novel (ignores later volumes)", () => {
    // v2.1: wizard batch is sized to Volume 1, not the whole novel. Despite
    // Volume 2+ extending to 200, Volume 1 alone is 50.
    expect(computeFirstVolumeEnd(withVolumes(["1-50", "51-120", "121-200"]))).toBe(50);
  });

  it("tolerates whitespace inside the range", () => {
    expect(computeFirstVolumeEnd(withVolumes(["1 - 80"]))).toBe(80);
  });

  it("returns 0 when Volume 1's range is unparseable (even if later volumes are valid)", () => {
    // First volume is garbage; helper stops there instead of falling through.
    expect(computeFirstVolumeEnd(withVolumes(["garbage", "20-50"]))).toBe(0);
  });

  it("returns 0 for invalid Volume 1 range (start < 1 or end < start)", () => {
    expect(computeFirstVolumeEnd(withVolumes(["0-30"]))).toBe(0);
    expect(computeFirstVolumeEnd(withVolumes(["5-1"]))).toBe(0);
  });

  it("returns 0 for empty or null range strings", () => {
    expect(computeFirstVolumeEnd(withVolumes([""]))).toBe(0);
    expect(computeFirstVolumeEnd(withVolumes([null]))).toBe(0);
  });

  it("handles a Volume 1 with non-standard start (e.g. '3-7' → 7)", () => {
    // Some LLM outputs use a non-1 start. Returned end is the upper bound.
    expect(computeFirstVolumeEnd(withVolumes(["3-7"]))).toBe(7);
  });
});

describe("parseVolumes", () => {
  it("returns [] when novelOutline is null", () => {
    expect(parseVolumes(null)).toEqual([]);
  });

  it("returns [] when volumes is missing", () => {
    expect(parseVolumes({ volumes: undefined } as unknown as NovelOutline)).toEqual([]);
  });

  it("parses a single '1-30' range into one ParsedVolume", () => {
    const result = parseVolumes(withVolumes(["1-30"]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "v0", start: 1, end: 30, chapter_range: "1-30" });
  });

  it("skips volumes with unparseable chapter_range", () => {
    expect(parseVolumes(withVolumes(["garbage", "1-10"]))).toHaveLength(1);
  });

  it("skips volumes with end < start", () => {
    expect(parseVolumes(withVolumes(["5-1", "1-10"]))).toHaveLength(1);
  });

  it("skips volumes with start < 1", () => {
    expect(parseVolumes(withVolumes(["0-30", "1-10"]))).toHaveLength(1);
  });

  it("tolerates whitespace inside the range", () => {
    expect(parseVolumes(withVolumes(["  1-30  "]))).toHaveLength(1);
    expect(parseVolumes(withVolumes(["1 - 30"]))).toHaveLength(1);
  });
});

describe("groupChaptersByVolume", () => {
  const chapters: WorkspaceChapterNode[] = [
    { chapter_number: 1, title: "第一章", scenes: [] },
    { chapter_number: 5, title: "第五章", scenes: [] },
    { chapter_number: 35, title: "第三十五章", scenes: [] },
  ];

  it("returns [] when chapters is empty", () => {
    expect(groupChaptersByVolume([], null)).toEqual([]);
  });

  it("returns a single '未分组' bucket when novelOutline is null", () => {
    const result = groupChaptersByVolume(chapters, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("未分组");
    expect(result[0].chapters).toEqual(chapters);
  });

  it("returns a single '未分组' bucket when no volumes are parseable", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["garbage"]));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("未分组");
    expect(result[0].chapters).toEqual(chapters);
  });

  it("groups chapters into matching volume buckets", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["1-30", "31-60"]));
    expect(result.map((g) => g.name)).toEqual(["v0", "v1"]);
    expect(result[0].chapters.map((c) => c.chapter_number)).toEqual([1, 5]);
    expect(result[1].chapters.map((c) => c.chapter_number)).toEqual([35]);
  });

  it("routes chapters outside any volume to a trailing '未分组' bucket", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["1-10"]));
    expect(result.map((g) => g.name)).toEqual(["v0", "未分组"]);
    // chapter 1 and chapter 5 are inside volume 1 (1-10); only chapter 35
    // is outside the planned range and ends up in the trailing bucket.
    expect(result[1].chapters.map((c) => c.chapter_number)).toEqual([35]);
  });

  it("suppresses the '未分组' bucket when it would be empty", () => {
    const result = groupChaptersByVolume(
      [{ chapter_number: 1, title: "第一章", scenes: [] }],
      withVolumes(["1-30"]),
    );
    expect(result.map((g) => g.name)).toEqual(["v0"]);
  });
});
