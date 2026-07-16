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
      chapters={chapters}
      volumes={volumes}
      onChapterClick={() => {}}
      onAddChapter={() => {}}
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

  it("renders the volume summary when present", () => {
    renderDashboard();
    expect(screen.getByTestId("volume-第一卷-summary")).toHaveTextContent("初入江湖");
  });

  it("renders chapter rows with title + status badge + scene count", () => {
    renderDashboard();
    const ch1 = screen.getByTestId("chapter-1");
    expect(ch1.textContent).toContain("第 1 章");
    expect(ch1.textContent).toContain("第一章");
    const badge1 = screen.getByTestId("chapter-status-1");
    expect(badge1.textContent).toBe("✓");
    expect(badge1.title).toBe("已完成");
    expect(badge1.className).toMatch(/emerald/);
    expect(ch1.textContent).toContain("2 场景");

    const ch2 = screen.getByTestId("chapter-2");
    const badge2 = screen.getByTestId("chapter-status-2");
    expect(badge2.textContent).toBe("✎");
    expect(badge2.title).toBe("撰写中");
    expect(badge2.className).toMatch(/blue/);
    expect(ch2.textContent).toContain("1 场景");
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
        chapters={DEFAULT_STATUSES}
        volumes={DEFAULT_VOLUMES}
        onChapterClick={onChapterClick}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("chapter-2"));
    expect(onChapterClick).toHaveBeenCalledWith(2, "writing");
  });

  it("falls back to a single '未分组' volume when volumes prop is omitted", () => {
    render(
      <ManagedDashboard
        projectId="p"
        chapters={[
          { chapter_number: 1, status: "completed" as const },
          { chapter_number: 2, status: "writing" as const },
        ]}
        onChapterClick={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("volume-未分组-header")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-2")).toBeInTheDocument();
  });

  it("renders an empty-state message when there are no chapters", () => {
    render(
      <ManagedDashboard
        projectId="p"
        chapters={[]}
        volumes={[]}
        onChapterClick={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText(/暂无章节/)).toBeInTheDocument();
  });

  it("+ new chapter and refresh buttons call their handlers", () => {
    const onAdd = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ManagedDashboard
        projectId="p"
        chapters={[]}
        volumes={[]}
        onChapterClick={() => {}}
        onAddChapter={onAdd}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId("add-chapter"));
    fireEvent.click(screen.getByTestId("refresh"));
    expect(onAdd).toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });
});
