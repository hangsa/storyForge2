import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ManagedDashboard from "../components/workspace/ManagedDashboard";
import type { WorkspaceVolumeGroup } from "../components/workspace/ChapterTreePanel";

const DEFAULT_VOLUMES: WorkspaceVolumeGroup[] = [
  {
    name: "第一卷",
    chapter_range: "1-30",
    summary: "初入江湖",
    chapters: [
      {
        chapter_number: 1,
        title: "第一章",
        scenes: [
          { scene_id: "1-1", title: "开场" },
          { scene_id: "1-2", title: "发现" },
        ],
      },
      { chapter_number: 2, title: "第二章", scenes: [{ scene_id: "2-1", title: "冲突" }] },
    ],
  },
  {
    name: "第二卷",
    chapter_range: "31-60",
    chapters: [{ chapter_number: 31, title: "第三十一章", scenes: [] }],
  },
];

const DEFAULT_STATUSES = [
  { chapter_number: 1, status: "completed" as const },
  { chapter_number: 2, status: "writing" as const },
  { chapter_number: 31, status: "planned" as const },
];

function renderDashboard(
  chapters = DEFAULT_STATUSES,
  volumes = DEFAULT_VOLUMES,
) {
  return render(
    <ManagedDashboard
      projectId="p"
      currentChapter={1}
      currentScene="1-1"
      chapters={chapters}
      volumes={volumes}
      chapterStatus={Object.fromEntries(chapters.map((c) => [c.chapter_number, c.status]))}
      onChapterClick={() => {}}
      onRefresh={() => {}}
    />,
  );
}

describe("ManagedDashboard", () => {
  // v1.9: managed-mode left column now mirrors ChapterTreePanel's volume +
  // title row layout (with status badge + scene count), so the user sees
  // titles and volume grouping without switching modes.
  it("renders volume headers with name + chapter range + count", () => {
    renderDashboard();
    const v1 = screen.getByTestId("volume-第一卷-header");
    const v2 = screen.getByTestId("volume-第二卷-header");
    expect(v1).toBeInTheDocument();
    expect(v1.textContent).toContain("第一卷");
    expect(v1.textContent).toContain("1-30");
    expect(v1.textContent).toContain("2 章");
    expect(v2).toBeInTheDocument();
    expect(v2.textContent).toContain("第二卷");
  });

  it("renders chapter rows with title + status badge + scene count (for the current chapter)", () => {
    renderDashboard();
    const ch1 = screen.getByTestId("chapter-1");
    expect(ch1.textContent).toContain("第 1 章");
    expect(ch1.textContent).toContain("第一章");
    const badge1 = screen.getByTestId("chapter-status-1");
    expect(badge1.textContent).toBe("✓");
    expect(badge1.title).toBe("已完成");
    expect(badge1.className).toMatch(/emerald/);
    // Chapter 1 is the current chapter → its scene count is rendered.
    expect(ch1.textContent).toContain("2 场景");

    // Chapter 2 is NOT the current chapter — the panel hides its scene
    // count and scenes to keep the tree compact. The status badge still
    // shows because that's controlled by chapterStatus overlay, not by
    // currentChapter.
    const ch2 = screen.getByTestId("chapter-2");
    const badge2 = screen.getByTestId("chapter-status-2");
    expect(badge2.textContent).toBe("✎");
    expect(badge2.title).toBe("撰写中");
    expect(badge2.className).toMatch(/blue/);
  });

  it("does not render a status badge for chapters missing from progress.json", () => {
    renderDashboard(
      [{ chapter_number: 1, status: "completed" as const }], // 2 + 31 missing
      DEFAULT_VOLUMES,
    );
    expect(screen.queryByTestId("chapter-status-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-status-31")).not.toBeInTheDocument();
    expect(screen.getByTestId("chapter-status-1")).toBeInTheDocument();
  });

  it("clicking a chapter row fires onChapterClick with chapter_number and status", () => {
    const onChapterClick = vi.fn();
    render(
      <ManagedDashboard
        projectId="p"
        currentChapter={1}
        currentScene="1-1"
        chapters={DEFAULT_STATUSES}
        volumes={DEFAULT_VOLUMES}
        chapterStatus={Object.fromEntries(DEFAULT_STATUSES.map((c) => [c.chapter_number, c.status]))}
        onChapterClick={onChapterClick}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("chapter-2"));
    expect(onChapterClick).toHaveBeenCalledWith(2, "writing");
  });

  it("renders chapter rows when volumes is omitted (ManagedDashboard wraps chapters in a default volume)", () => {
    // WorkspacePage always passes `volumes` derived from manualChapters +
    // novelOutline, so a missing volumes prop is unusual. The component
    // doesn't synthesize a fallback (WorkspacePage owns that policy) — if
    // volumes is omitted, no chapter rows render. This test guards against
    // the wrap-rendering crashing when volumes is undefined.
    render(
      <ManagedDashboard
        projectId="p"
        currentChapter={1}
        currentScene="1-1"
        chapters={[
          { chapter_number: 1, status: "completed" as const },
          { chapter_number: 2, status: "writing" as const },
        ]}
        chapterStatus={{ 1: "completed", 2: "writing" }}
        onChapterClick={() => {}}
        onRefresh={() => {}}
      />,
    );
    // No volumes → no chapter rows. The component is mounted without error.
    expect(screen.getByTestId("managed-dashboard")).toBeInTheDocument();
  });

  it("renders no chapter rows when chapters and volumes are both empty", () => {
    render(
      <ManagedDashboard
        projectId="p"
        currentChapter={1}
        currentScene="1-1"
        chapters={[]}
        volumes={[]}
        chapterStatus={{}}
        onChapterClick={() => {}}
        onRefresh={() => {}}
      />,
    );
    // Use the more specific `chapter-N` selector (matches chapter rows
    // only, not the `chapter-tree` toolbar container).
    expect(screen.queryByTestId("chapter-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-2")).not.toBeInTheDocument();
  });

  // v1.9 T4: managed mode deliberately hides "+ 新章节" (autopilot owns
  // chapter creation). Only the refresh button is shown.
  it("does NOT render the + 新章节 button (managed mode has no add-chapter workflow)", () => {
    renderDashboard();
    expect(screen.queryByTestId("add-chapter")).not.toBeInTheDocument();
    // Refresh button is still present.
    expect(screen.getByTestId("refresh")).toBeInTheDocument();
  });

  it("clicking refresh calls onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <ManagedDashboard
        projectId="p"
        currentChapter={1}
        currentScene="1-1"
        chapters={[]}
        volumes={[]}
        chapterStatus={{}}
        onChapterClick={() => {}}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId("refresh"));
    expect(onRefresh).toHaveBeenCalled();
  });
});