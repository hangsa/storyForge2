import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChapterTreePanel, {
  type WorkspaceChapterNode,
  type WorkspaceVolumeGroup,
} from "../components/workspace/ChapterTreePanel";

const CHAPTERS: WorkspaceChapterNode[] = [
  { chapter_number: 1, title: "第一章", scenes: [{ scene_id: "1-1", title: "开场" }, { scene_id: "1-2", title: "发现" }] },
  { chapter_number: 2, title: "第二章", scenes: [{ scene_id: "2-1", title: "冲突" }] },
];

// Default test fixture: a single "未分组" volume (used when no
// novel_outline.volumes is available). All volumes are auto-opened on first
// render, so chapter buttons are visible by default.
const VOLUMES: WorkspaceVolumeGroup[] = [
  { name: "未分组", chapter_range: "", chapters: CHAPTERS },
];

describe("ChapterTreePanel", () => {
  it("lists chapters with titles", () => {
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getAllByText(/第一章/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/第二章/).length).toBeGreaterThan(0);
  });

  it("expands the current chapter and shows scenes", () => {
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("scene-1-1")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-2")).toBeInTheDocument();
    expect(screen.queryByTestId("scene-2-1")).not.toBeInTheDocument();
  });

  it("clicking a chapter header selects it", () => {
    const onSelect = vi.fn();
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={onSelect}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("chapter-2"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("clicking a scene selects it", () => {
    const onSelectScene = vi.fn();
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={onSelectScene}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-1-2"));
    expect(onSelectScene).toHaveBeenCalledWith(1, "1-2");
  });

  it("+ 新章节 calls onAddChapter", () => {
    const onAdd = vi.fn();
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={onAdd}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("add-chapter"));
    expect(onAdd).toHaveBeenCalled();
  });

  it("renders all three view-mode buttons (扁平 / 树形 / 按幕)", () => {
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("view-mode-flat")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-tree")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-act")).toBeInTheDocument();
  });

  it("clicking a view-mode button highlights it (v1.8: label-only, no filter)", () => {
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("view-mode-tree"));
    expect(screen.getByTestId("view-mode-tree").className).toContain("bg-primary-container");
    expect(screen.getByTestId("view-mode-flat").className).not.toContain("bg-primary-container");
  });

  it("renders volume headers with name + chapter range + count", () => {
    const volumes: WorkspaceVolumeGroup[] = [
      { name: "第一卷", chapter_range: "1-30", summary: "初入江湖", chapters: [CHAPTERS[0]] },
      { name: "第二卷", chapter_range: "31-60", chapters: [CHAPTERS[1]] },
    ];
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("volume-第一卷-header")).toBeInTheDocument();
    expect(screen.getByTestId("volume-第一卷-header").textContent).toContain("第一卷");
    expect(screen.getByTestId("volume-第一卷-header").textContent).toContain("1-30");
    expect(screen.getByTestId("volume-第二卷-header")).toBeInTheDocument();
    // Volume's detailed outline (summary) is intentionally hidden — the panel
    // shows the volume name + chapter range for orientation, but not the prose
    // outline the writer authored separately.
    expect(screen.queryByTestId("volume-第一卷-summary")).not.toBeInTheDocument();
    // Chapter 1 belongs to volume 1, so its scenes are visible.
    expect(screen.getByTestId("scene-1-1")).toBeInTheDocument();
    // Chapter 2 is in volume 2 (not current) — its scenes are hidden.
    expect(screen.queryByTestId("scene-2-1")).not.toBeInTheDocument();
  });

  it("clicking a volume header toggles its open state", () => {
    const volumes: WorkspaceVolumeGroup[] = [
      { name: "第一卷", chapter_range: "1-30", chapters: [CHAPTERS[0]] },
      { name: "第二卷", chapter_range: "31-60", chapters: [CHAPTERS[1]] },
    ];
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    // Volume 1 is auto-opened (current chapter is 1, in volume 1).
    expect(screen.getByTestId("chapter-1")).toBeInTheDocument();
    // Close volume 1.
    fireEvent.click(screen.getByTestId("volume-第一卷-header"));
    expect(screen.queryByTestId("chapter-1")).not.toBeInTheDocument();
  });

  it("renders no volume containers when volumes list is empty", () => {
    render(
      <ChapterTreePanel
        volumes={[]}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByTestId(/^volume-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-1")).not.toBeInTheDocument();
  });

  it("renders per-chapter status badges for all three states", () => {
    const volumes: WorkspaceVolumeGroup[] = [
      { name: "未分组", chapter_range: "", chapters: [
        { chapter_number: 1, title: "第一章", scenes: [{ scene_id: "1-1", title: "开场" }] },
        { chapter_number: 2, title: "第二章", scenes: [{ scene_id: "2-1", title: "冲突" }] },
        { chapter_number: 3, title: "第三章", scenes: [{ scene_id: "3-1", title: "高潮" }] },
      ] },
    ];
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        chapterStatus={{ 1: "completed", 2: "writing", 3: "planned" }}
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    const s1 = screen.getByTestId("chapter-status-1");
    const s2 = screen.getByTestId("chapter-status-2");
    const s3 = screen.getByTestId("chapter-status-3");
    // completed → ✓
    expect(s1.textContent).toBe("✓");
    expect(s1.title).toBe("已完成");
    expect(s1.className).toMatch(/emerald/);
    // writing → ✎
    expect(s2.textContent).toBe("✎");
    expect(s2.title).toBe("撰写中");
    expect(s2.className).toMatch(/blue/);
    // planned → ○
    expect(s3.textContent).toBe("○");
    expect(s3.title).toBe("未写");
    expect(s3.className).toMatch(/gray/);
  });

  it("does not render status badges when chapterStatus is omitted", () => {
    render(
      <ChapterTreePanel
        volumes={VOLUMES}
        currentChapter={1}
        currentScene="1-1"
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByTestId("chapter-status-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chapter-status-2")).not.toBeInTheDocument();
  });
});
