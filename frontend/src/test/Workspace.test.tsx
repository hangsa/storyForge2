import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockedGetProjectStatus = vi.fn().mockResolvedValue({ title: "T" });

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: mockedGetProjectStatus,
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    getConcept: vi.fn().mockResolvedValue({ concept: null, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({ characters: [] }),
    getNovelOutline: vi.fn().mockResolvedValue({}),
    updateOutline: vi.fn().mockResolvedValue(undefined),
  },
}));

import WorkspacePage from "../pages/WorkspacePage";

function setup(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<WorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mockedGetProjectStatus.mockClear();
});

describe("Workspace integration", () => {
  it("default mode renders ManagedDashboard + ManagedAIControlPanel", () => {
    setup("/project/p1/workspace");
    expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("managed");
    expect(screen.getByTestId("managed-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("ai-control-panel")).toBeInTheDocument();
  });

  it("?mode=manual renders ChapterTreePanel + WritingArea + ContextPanel", () => {
    setup("/project/p1/workspace?mode=manual&chapter=1&scene=1-1");
    expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("manual");
    expect(screen.getByTestId("chapter-tree")).toBeInTheDocument();
    expect(screen.getByTestId("writing-area")).toBeInTheDocument();
    expect(screen.getByTestId("context-panel")).toBeInTheDocument();
  });

  it("clicking mode-manual in the top-bar opens the confirm modal", () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("mode-manual"));
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
  });

  it("clicking mode-managed in the top-bar opens the start modal", () => {
    setup("/project/p1/workspace?mode=manual");
    fireEvent.click(screen.getByTestId("mode-managed"));
    expect(screen.getByTestId("managed-start-modal")).toBeInTheDocument();
  });

  it("clicking a 'writing' chapter cell opens the take-over confirm modal (not direct switch)", () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("chapter-cell-4")); // chapter 4 is "writing" in mock state
    expect(screen.getByTestId("mode-switch-confirm")).toBeInTheDocument();
    expect(localStorage.getItem("storyforge.workspace.mode")).toBeNull(); // still on managed
  });

  it("'立即接管' on take-over modal switches to manual + loads that chapter's first scene", async () => {
    setup("/project/p1/workspace");
    fireEvent.click(screen.getByTestId("chapter-cell-4"));
    // uncheck "等待完成" so we take over immediately
    const waitCheckbox = screen.getByTestId("confirm-wait-finish") as HTMLInputElement;
    fireEvent.change(waitCheckbox, { target: { checked: false } });
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("workspace-layout").getAttribute("data-mode")).toBe("manual"),
    );
    expect(screen.getByTestId("writing-area")).toBeInTheDocument();
  });
});
