import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import ChapterTreePanel, {
  type WorkspaceChapterNode,
  type WorkspaceVolumeGroup,
} from "../components/workspace/ChapterTreePanel";

// v1.9 T4 scaffold-filtering regression. The "managed" chapter list is
// the union of outline.json (WorkspaceChapterNode[]) — progress.json's
// 29 chapters (1-20 real + 21-29 scaffolds) must NOT leak into the
// chapter tree. We render the unified ChapterTreePanel directly with
// the volumes that WorkspacePage would have computed, and assert that
// only 20 chapter rows appear with status badges driven by progress.json.
describe("Workspace chapter-list unification", () => {
  // Real outline (20 chapters with scenes).
  const outlineChapters: WorkspaceChapterNode[] = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    return {
      chapter_number: n,
      title: `第 ${n} 章`,
      scenes: [{ scene_id: `${n}-1`, title: `场景 ${n}-1` }],
    };
  });

  // progress.json-derived status map (29 entries — 1-20 from outline,
  // 21-29 are scaffolds with no outline / no scenes).
  const chapterStatus: Record<number, "completed" | "writing" | "planned" | "pending"> = {};
  for (let i = 1; i <= 29; i++) {
    if (i <= 10) chapterStatus[i] = "completed";
    else if (i <= 15) chapterStatus[i] = "writing";
    else if (i <= 20) chapterStatus[i] = "planned";
    else chapterStatus[i] = "pending"; // scaffolds
  }

  const volumes: WorkspaceVolumeGroup[] = [
    { name: "第一卷", chapter_range: "1-30", summary: undefined, chapters: outlineChapters },
  ];

  it("renders only outline chapters (scaffolds 21-29 from progress.json are filtered out)", () => {
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        chapterStatus={chapterStatus}
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onRefresh={() => {}}
      />,
    );

    // 20 outline chapters render with status badges.
    for (let n = 1; n <= 20; n++) {
      expect(screen.getByTestId(`chapter-${n}`)).toBeInTheDocument();
      expect(screen.getByTestId(`chapter-status-${n}`)).toBeInTheDocument();
    }

    // Scaffolds 21-29 have NO outline → they MUST NOT render even though
    // progress.json reports a status for them. This is the core scaffold-
    // filtering guarantee of the unified tree.
    for (let n = 21; n <= 29; n++) {
      expect(screen.queryByTestId(`chapter-${n}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`chapter-status-${n}`)).not.toBeInTheDocument();
    }
  });

  it("renders the correct status-badge text for each progress.json state", () => {
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        chapterStatus={chapterStatus}
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onRefresh={() => {}}
      />,
    );

    // completed → ✓ (emerald)
    const s1 = screen.getByTestId("chapter-status-1");
    expect(s1.textContent).toBe("✓");
    expect(s1.className).toMatch(/emerald/);

    // writing → ✎ (blue)
    const s11 = screen.getByTestId("chapter-status-11");
    expect(s11.textContent).toBe("✎");
    expect(s11.className).toMatch(/blue/);

    // planned → ○ (gray)
    const s16 = screen.getByTestId("chapter-status-16");
    expect(s16.textContent).toBe("○");
    expect(s16.className).toMatch(/gray/);
  });

  it("does NOT render the + 新章节 button when onAddChapter is undefined (managed mode)", () => {
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        chapterStatus={chapterStatus}
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.queryByTestId("add-chapter")).not.toBeInTheDocument();
    // Refresh button is still rendered.
    expect(screen.getByTestId("refresh")).toBeInTheDocument();
  });

  it("DOES render the + 新章节 button when onAddChapter is provided (manual mode)", () => {
    render(
      <ChapterTreePanel
        volumes={volumes}
        currentChapter={1}
        currentScene="1-1"
        chapterStatus={chapterStatus}
        onSelectChapter={() => {}}
        onSelectScene={() => {}}
        onAddChapter={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByTestId("add-chapter")).toBeInTheDocument();
  });
});