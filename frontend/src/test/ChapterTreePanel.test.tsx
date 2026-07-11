import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChapterTreePanel, { type WorkspaceChapterNode } from "../components/workspace/ChapterTreePanel";

const CHAPTERS: WorkspaceChapterNode[] = [
  { chapter_number: 1, title: "第一章", scenes: [{ scene_id: "1-1", title: "开场" }, { scene_id: "1-2", title: "发现" }] },
  { chapter_number: 2, title: "第二章", scenes: [{ scene_id: "2-1", title: "冲突" }] },
];

describe("ChapterTreePanel", () => {
  it("lists chapters with titles", () => {
    render(
      <ChapterTreePanel
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
        chapters={CHAPTERS}
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
});
