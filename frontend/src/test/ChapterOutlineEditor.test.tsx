import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ChapterOutlineEditor from "../components/workspace/editors/ChapterOutlineEditor";

vi.mock("../api/client", () => ({
  default: {
    getOutline: vi.fn(),
    updateOutline: vi.fn(),
  },
}));

import api from "../api/client";
const mockedUpdateOutline = api.updateOutline as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
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
});