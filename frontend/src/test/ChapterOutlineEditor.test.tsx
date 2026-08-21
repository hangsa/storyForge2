import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement } from "react";
import ChapterOutlineEditor from "../components/workspace/editors/ChapterOutlineEditor";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    getOutline: vi.fn(),
    updateOutline: vi.fn(),
    regenerateChapterOutlineRange: vi.fn(),
  },
}));

import api from "../api/client";
const mockedUpdateOutline = api.updateOutline as unknown as ReturnType<typeof vi.fn>;
const mockedRegenerateRange =
  api.regenerateChapterOutlineRange as unknown as ReturnType<typeof vi.fn>;

/** The editor calls useToast(), which throws outside a provider. App.tsx wraps
 *  the whole tree in <ToastProvider>, so mirror that here. */
function render(ui: ReactElement): RenderResult {
  return rtlRender(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
  mockedRegenerateRange.mockReset().mockResolvedValue({ chapters: [] });
});

describe("ChapterOutlineEditor", () => {
  it("renders the loading state initially", async () => {
    // The editor reads `data` synchronously on mount; if we pass `undefined`,
    // it shows a loading placeholder until the parent (ContextPanel) passes
    // real data.
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={undefined}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-loading")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-loading")).toHaveTextContent("加载中");
  });

  it("renders the empty state when chapters are empty", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{ chapters: [] }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-empty")).toHaveTextContent("尚未生成");
  });

  it("renders one chapter row per outline.chapter", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
            {
              chapter_number: 2, title: "第二章", theme: "磨炼",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-2")).toBeInTheDocument();
  });

  it("chapter title input updates local state", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const titleInput = screen.getByTestId("chapter-1-title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    expect(titleInput.value).toBe("新标题");
  });

  it("chapter theme textarea updates local state", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const themeArea = screen.getByTestId("chapter-1-theme") as HTMLTextAreaElement;
    fireEvent.change(themeArea, { target: { value: "新主题" } });
    expect(themeArea.value).toBe("新主题");
  });

  it("does not render scene rows in the right sidebar (scene editing moved elsewhere)", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] },
                { scene_number: 2, goal: "g2", conflict: "c2", emotional_arc: "a2", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByTestId("scene-row-1-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-row-2-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-1-goal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scene-1-b-accordion")).not.toBeInTheDocument();
  });

  it("save calls api.updateOutline once with the edited outline (scene_plan preserved unchanged) + calls onSaved", async () => {
    const onSaved = vi.fn();
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "原goal", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => expect(mockedUpdateOutline).toHaveBeenCalledTimes(1));
    const [projectIdArg, outlineArg] = mockedUpdateOutline.mock.calls[0];
    expect(projectIdArg).toBe("p1");
    expect(outlineArg.chapters[0].title).toBe("新标题");
    // Scene data round-trips intact even though the sidebar doesn't edit it.
    expect(outlineArg.chapters[0].scene_plan[0].goal).toBe("原goal");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("save error shows banner and preserves local state", async () => {
    mockedUpdateOutline.mockRejectedValueOnce(new Error("网络超时"));
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => screen.getByTestId("chapter-outline-editor-error"));
    expect(screen.getByTestId("chapter-outline-editor-error")).toHaveTextContent("网络超时");
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe("新标题");
  });

  it("cancel reverts local state to the data prop", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const titleInput = screen.getByTestId("chapter-1-title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "临时修改" } });
    expect(titleInput.value).toBe("临时修改");
    fireEvent.click(screen.getByTestId("chapter-outline-editor-cancel"));
    expect(titleInput.value).toBe("原标题");
  });

  it("readOnly disables every input and the save button", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
        readOnly
      />,
    );
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("chapter-1-theme") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId("chapter-outline-editor-save")).toBeDisabled();
  });

  it("'未保存修改' indicator appears after editing", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByTestId("chapter-outline-editor-dirty")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    expect(screen.getByTestId("chapter-outline-editor-dirty")).toHaveTextContent("未保存修改");
  });

  it("renders a '未分组' volume section when novelOutline is not provided", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
            { chapter_number: 2, title: "第二章", theme: "磨炼",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("volume-group-0")).toBeInTheDocument();
    expect(screen.getByTestId("volume-name-0")).toHaveTextContent("未分组");
    // No chapter_range subtitle when novelOutline is absent.
    expect(screen.queryByTestId("volume-range-0")).not.toBeInTheDocument();
    // Both chapters still render under the ungrouped section.
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-2")).toBeInTheDocument();
  });

  it("groups chapters under their owning volume when novelOutline.volumes match chapter numbers", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
            { chapter_number: 2, title: "第二章", theme: "磨炼",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
            { chapter_number: 51, title: "第五十一章", theme: "宗门之争",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        novelOutline={{
          core_conflict_theme: "",
          volumes: [
            { name: "第一卷 崛起", chapter_range: "1-50", summary: "觉醒", key_events: [] },
            { name: "第二卷 试炼", chapter_range: "51-120", summary: "宗门之争", key_events: [] },
          ],
          mc_growth_arc: [],
          key_plot_points: [],
          generated_at: "",
          updated_at: "",
        }}
        onSaved={() => {}}
      />,
    );
    // Two volume sections, no ungrouped fallback.
    expect(screen.getByTestId("volume-name-0")).toHaveTextContent("第一卷 崛起");
    expect(screen.getByTestId("volume-range-0")).toHaveTextContent("第 1-50 章");
    expect(screen.getByTestId("volume-name-1")).toHaveTextContent("第二卷 试炼");
    expect(screen.getByTestId("volume-range-1")).toHaveTextContent("第 51-120 章");
    expect(screen.queryByTestId("volume-group-2")).not.toBeInTheDocument();

    // Chapters sit beneath their owning volume group (in document order).
    const group1 = screen.getByTestId("volume-group-0");
    const group2 = screen.getByTestId("volume-group-1");
    expect(group1.contains(screen.getByTestId("chapter-row-1"))).toBe(true);
    expect(group1.contains(screen.getByTestId("chapter-row-2"))).toBe(true);
    expect(group2.contains(screen.getByTestId("chapter-row-51"))).toBe(true);
  });

  it("puts chapters outside any volume range into a '未分组' section", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
            { chapter_number: 999, title: "超写章", theme: "末卷之外",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        novelOutline={{
          core_conflict_theme: "",
          volumes: [
            { name: "第一卷 崛起", chapter_range: "1-50", summary: "", key_events: [] },
          ],
          mc_growth_arc: [],
          key_plot_points: [],
          generated_at: "",
          updated_at: "",
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("volume-name-0")).toHaveTextContent("第一卷 崛起");
    expect(screen.getByTestId("volume-name-1")).toHaveTextContent("未分组");
    const group1 = screen.getByTestId("volume-group-0");
    const groupUngrouped = screen.getByTestId("volume-group-1");
    expect(group1.contains(screen.getByTestId("chapter-row-1"))).toBe(true);
    expect(groupUngrouped.contains(screen.getByTestId("chapter-row-999"))).toBe(true);
  });
});

describe("ChapterOutlineEditor range regenerate", () => {
  const SEED_DATA = {
    chapters: [
      { chapter_number: 1, title: "第一章", theme: "觉醒",
        scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      { chapter_number: 2, title: "第二章", theme: "磨炼",
        scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
    ],
  };

  const SEED_NOVEL_OUTLINE = {
    core_conflict_theme: "",
    volumes: [
      { name: "第一卷 崛起", chapter_range: "1-3", summary: "", key_events: [] },
    ],
    mc_growth_arc: [],
    key_plot_points: [],
    generated_at: "",
    updated_at: "",
  };

  it("renders the range regenerate button when not readOnly", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={SEED_DATA}
        novelOutline={SEED_NOVEL_OUTLINE}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-range-regenerate")).toHaveTextContent(
      "重新生成章节大纲",
    );
  });

  it("clicking the button opens ChapterRangeRegenerateModal", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={SEED_DATA}
        novelOutline={SEED_NOVEL_OUTLINE}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByTestId("chapter-range-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chapter-outline-range-regenerate"));
    expect(screen.getByTestId("chapter-range-modal")).toBeInTheDocument();
    // chapterCount comes from novelOutline volumes (1-3 → 3).
    expect((screen.getByTestId("chapter-range-end") as HTMLInputElement).value).toBe("3");
  });

  it("submitting calls regenerateChapterOutlineRange and refreshes local chapters", async () => {
    mockedRegenerateRange.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "重生后的第一章", theme: "新觉醒",
          scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
        { chapter_number: 2, title: "第二章", theme: "磨炼",
          scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      ],
    });
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={SEED_DATA}
        novelOutline={SEED_NOVEL_OUTLINE}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("chapter-outline-range-regenerate"));
    fireEvent.change(screen.getByTestId("chapter-range-start"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("chapter-range-end"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("chapter-range-mods"), { target: { value: "节奏更紧凑" } });
    fireEvent.click(screen.getByTestId("chapter-range-confirm"));

    await waitFor(() => expect(mockedRegenerateRange).toHaveBeenCalledTimes(1));
    expect(mockedRegenerateRange).toHaveBeenCalledWith("p1", 1, 2, "节奏更紧凑");
    // Modal closes and local state reflects the regenerated chapters.
    await waitFor(() =>
      expect(screen.queryByTestId("chapter-range-modal")).not.toBeInTheDocument(),
    );
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe(
      "重生后的第一章",
    );
  });

  it("readOnly hides the range regenerate button", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={SEED_DATA}
        novelOutline={SEED_NOVEL_OUTLINE}
        onSaved={() => {}}
        readOnly
      />,
    );
    expect(screen.queryByTestId("chapter-outline-range-regenerate")).not.toBeInTheDocument();
  });
});