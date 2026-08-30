import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import WorkspaceWritingPanel from "./WorkspaceWritingPanel";
import { ToastProvider } from "../../hooks/useToast";

vi.mock("../../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "测试项目" }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    getStage4Progress: vi.fn().mockResolvedValue({ chapters: [], total_chapters: 0 }),
    getNovelOutline: vi.fn().mockResolvedValue({ volumes: [] }),
    getSceneDraft: vi.fn().mockResolvedValue({ draft_text: "" }),
    getSceneDrafts: vi.fn().mockResolvedValue({ chapter_number: 0, scenes: [] }),
    repairProgress: vi.fn().mockResolvedValue({ repaired_chapters: [], current_chapter: 1 }),
    resetPreview: vi.fn().mockResolvedValue({
      draft_count: 0,
      has_progress: false,
      has_checkpoint: false,
      has_chunks: false,
    }),
    resetToInit: vi.fn().mockResolvedValue(undefined),
    // ContextPanel fetches concept/world/character on mount.
    getConcept: vi.fn().mockResolvedValue({ concept: null, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({ characters: [] }),
  },
}));

vi.mock("../../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(() => ({
    session: null,
    status: "idle",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    events: [],
  })),
}));

describe("WorkspaceWritingPanel", () => {
  it("renders the 3-column layout with empty defaults", async () => {
    render(
      <ToastProvider>
        <MemoryRouter>
          <WorkspaceWritingPanel
            projectId="proj_x"
            projectName="测试"
            mode="manual"
            setMode={vi.fn()}
            reloadKey={0}
            setReloadKey={vi.fn()}
          />
        </MemoryRouter>
      </ToastProvider>,
    );
    // data-testid="workspace-page" now lives on the panel (preserved from
    // WorkspacePage so existing routing tests keep passing).
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    // WorkspaceLayout renders data-testid="workspace-layout".
    expect(await screen.findByTestId("workspace-layout")).toBeInTheDocument();
  });
});
