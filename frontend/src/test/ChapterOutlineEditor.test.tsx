import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("renders scene rows inside an expanded chapter", () => {
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
    expect(screen.getByTestId("scene-row-1-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("scene-row-2-toggle")).toBeInTheDocument();
  });

  it("expanding a scene reveals goal/conflict/emotional_arc/narrative_role/beat_type inputs", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    expect(screen.getByTestId("scene-1-goal")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-emotional-arc")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-narrative-role")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-beat-type")).toBeInTheDocument();
  });

  it("narrative_role select offers exactly the 4 enum values", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const select = screen.getByTestId("scene-1-narrative-role") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(["setup", "mini_payoff", "cliffhanger", "major_reveal"]);
  });

  it("editing scene.goal updates the textarea value", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "原goal", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const goal = screen.getByTestId("scene-1-goal") as HTMLTextAreaElement;
    fireEvent.change(goal, { target: { value: "新goal" } });
    expect(goal.value).toBe("新goal");
  });

  it("changing narrative_role updates the select value", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const select = screen.getByTestId("scene-1-narrative-role") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "cliffhanger" } });
    expect(select.value).toBe("cliffhanger");
  });

  it("editing one scene's goal does not affect sibling scenes in the same chapter", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "原goal1", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] },
                { scene_number: 2, goal: "原goal2", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    fireEvent.click(screen.getByTestId("scene-row-2-toggle"));
    const goal1 = screen.getByTestId("scene-1-goal") as HTMLTextAreaElement;
    const goal2 = screen.getByTestId("scene-2-goal") as HTMLTextAreaElement;
    fireEvent.change(goal1, { target: { value: "新goal1" } });
    expect(goal1.value).toBe("新goal1");
    expect(goal2.value).toBe("原goal2");
  });
});
