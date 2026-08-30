import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../hooks/useToast";
import WorkspacePage from "./WorkspacePage";

// Mock the autopilot SSE hook so WorkspaceTopBar (rendered by the page)
// doesn't try to open real EventSource connections during unit tests.
vi.mock("../hooks/useAutopilotSession", () => ({
  useAutopilotSession: vi.fn(() => ({
    session: null,
    status: "idle",
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    refresh: vi.fn(),
    events: [],
  })),
}));

vi.mock("../api/client", () => ({
  default: {
    getProjectStatus: vi.fn().mockResolvedValue({ title: "测试项目" }),
    getCreativeDivergencePrefill: vi.fn().mockResolvedValue({ exists: true, has_selection: true }),
    getConcept: vi.fn().mockResolvedValue({ concept: { title: "X", source: "creative_divergence" }, story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] } }),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockResolvedValue({ volumes: [{ chapter_range: [1, 10] }] }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
    // Required by WorkspaceTopBar (which is mounted by the page)
    getStage4Progress: vi.fn().mockResolvedValue({
      project_id: "p",
      current_stage: "stage4",
      current_chapter: 0,
      total_chapters: 0,
      chapters: [],
      circuit_breaker_events: [],
    }),
    // Required by WorkspaceWizardPanel (creative divergence step)
    listCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [] }),
    generateCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [] }),
    selectCreativeDivergenceVariant: vi.fn().mockResolvedValue({ ok: true }),
    // Required by WorkspaceWritingPanel when URL ?tab=manuscript forces
    // synchronous mount (initial allStepsDone=true from URL override).
    // The preflight will later flip the tab to "settings", but the
    // panel's first-paint effects still run with these endpoints missing.
    getSceneDrafts: vi.fn().mockResolvedValue({ chapter_number: 0, scenes: [] }),
    getSceneDraft: vi.fn().mockResolvedValue({ draft_text: "" }),
  },
}));

function renderAt(url: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/project/:projectId/workspace" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("WorkspacePage tab routing", () => {
  it("defaults to settings tab when no URL param and not all steps done", async () => {
    renderAt("/project/proj_x/workspace");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });

  it("forces settings when URL asks for manuscript but locked", async () => {
    renderAt("/project/proj_x/workspace?tab=manuscript");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });

  it("respects ?tab=settings in URL", async () => {
    renderAt("/project/proj_x/workspace?tab=settings");
    await waitFor(() => expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument());
  });
});
