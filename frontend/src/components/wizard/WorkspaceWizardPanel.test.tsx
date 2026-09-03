import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceWizardPanel from "./WorkspaceWizardPanel";
import api from "../../api/client";

vi.mock("../../api/client", () => ({
  default: {
    // The wizard's prefill effect (Plan Task 25, 2026-08-30) no longer calls
    // any creative-divergence endpoint — CreativeDivergenceStep infers its
    // own SubStage from /state on mount.
    getDivergeState: vi.fn().mockResolvedValue({
      raw_intent: null,
      idea_variants: [],
      core_contradiction: null,
      selected_path: [],
    }),
    getCreativeDivergence: vi.fn().mockResolvedValue({
      variants: [],
      selected_id: null,
      has_selection: false,
      selected_at: null,
    }),
    getCanvasV2State: vi.fn().mockResolvedValue({
      schema_version: 4,
      session_id: "default",
      _etag: "default",
      root_idea: {
        prompt: "",
        genre: "",
        premise: "",
        extracted: { genre: "", core_elements: [], potential_conflict: "" },
      },
      raw_intent: { prompt: "", genre_primary: "" },
      creative_session: { current_step: 1, max_steps: 5, status: "active" },
      creative_path: [],
      current_concept: {},
      final_concept: null,
      committed: false,
      committed_at: null,
      scores: { novelty: 0, conflict: 0, story_potential: 0, uniqueness: 0, computed_at: "" },
      session_metadata: {},
    }),
    getConcept: vi.fn().mockRejectedValue(new Error("404")),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockRejectedValue(new Error("404")),
    getOutline: vi.fn().mockRejectedValue(new Error("404")),
  },
}));

beforeEach(() => {
  // WizardProvider hydrates from sessionStorage by projectId. Tests
  // share the jsdom sessionStorage, so without this the post-integration
  // tests inherit stale completedStep1Surfaces / activeStep1Surface
  // from earlier tests in this file (e.g. the canvas prefill test
  // leaves ["canvas","divergence"] behind, which makes the
  // CreativeCanvasMountPoint test see canvas as completed before
  // any click).
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("WorkspaceWizardPanel", () => {
  it("renders WizardSidebar + step 1 divergence step", async () => {
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument();
    // "创意发散" appears in the sidebar item, header subtitle, and step 1 h2.
    // Asserting ≥1 match confirms step 1's divergence step mounted.
    await waitFor(() => expect(screen.getAllByText("创意发散").length).toBeGreaterThanOrEqual(1));
  });

  it("renders 创意画布 between 创意发散 and 概念 DNA as a peer step-1 surface", async () => {
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByTestId("wizard-sidebar-item-canvas")).toBeInTheDocument()
    );
    const canvas = screen.getByTestId("wizard-sidebar-item-canvas");
    expect(canvas).toHaveTextContent("创意画布");
  });

  it("calls the remaining prefill endpoints on mount", async () => {
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() => {
      expect(api.getConcept).toHaveBeenCalled();
      expect(api.getWorld).toHaveBeenCalled();
      expect(api.getCharacter).toHaveBeenCalled();
      expect(api.getNovelOutline).toHaveBeenCalled();
      expect(api.getOutline).toHaveBeenCalled();
      expect(api.getCanvasV2State).toHaveBeenCalled();
    });
  });

  it("prefills completedSteps=[1] when creative_divergence.json has selected_at (Path B variant select)", async () => {
    (api.getCreativeDivergence as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [{ id: "v1", label: "ALPHA", title: "T", description: "D", tags: [], created_at: "2026-08-31T14:00:00Z" }],
      selected_id: "v1",
      has_selection: true,
      selected_at: "2026-08-31T14:00:05.164787",
    });
    (api.getConcept as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { title: "建木之囚", genre: "爽文", premise: "P", tone: "T", theme: "T", target_audience: "A", style_template: "" },
      story_dna: { core_contradiction: { statement: "S", side_a: "A", side_b: "B" }, value_stack: [] },
    });
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() => {
      // Concept (position 2) should NOT be disabled once step 1 surfaces
      // are completed via prefill (OR-semantic — divergence done here).
      expect(screen.getByTestId("wizard-sidebar-item-concept")).not.toHaveAttribute("disabled");
      // World (position 3) is still disabled because we didn't mock a
      // world.json here.
      expect(screen.getByTestId("wizard-sidebar-item-world")).toHaveAttribute("disabled");
    });
  });

  it("prefills completedSteps=[1] when selected_id is null but selected_at is set (Path A canvas source — proj_f0721bdc)", async () => {
    // Regression for the proj_f0721bdc 2026-08-31 case where source="canvas"
    // dual-write at /commit_canvas sets selected_at=now but selected_id=None
    // (no Path B variant was chosen). The earlier `has_selection &&
    // selected_at` guard missed step 1 for canvas-source projects. The
    // current guard is `selected_at` alone, which both paths satisfy.
    (api.getCreativeDivergence as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [],
      selected_id: null,
      has_selection: false,
      selected_at: "2026-08-31T14:00:05.164787",
    });
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_f0721bdc" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId("wizard-sidebar-item-concept")).not.toHaveAttribute("disabled");
    });
  });
});

describe("WorkspaceWizardPanel (post-integration)", () => {
  it("prefill with canvas.committed=true populates completedStep1Surfaces with 'canvas'", async () => {
    (api.getCanvasV2State as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      schema_version: 4,
      session_id: "s",
      _etag: "e",
      root_idea: {
        prompt: "x",
        genre: "x",
        premise: "x",
        extracted: { genre: "x", core_elements: [], potential_conflict: "" },
      },
      raw_intent: { prompt: "x", genre_primary: "x" },
      creative_session: { current_step: 5, max_steps: 5, status: "committed" },
      creative_path: [],
      current_concept: {},
      final_concept: null,
      committed: true,
      committed_at: "2026-09-03T00:00:00Z",
      scores: { novelty: 0, conflict: 0, story_potential: 0, uniqueness: 0, computed_at: "" },
      session_metadata: {},
    });
    (api.getCreativeDivergence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      has_selection: false,
      selected_at: null,
      selected_id: null,
      variants: [],
    });
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId("wizard-sidebar-item-canvas").getAttribute("data-state")).toBe("completed");
    });
  });

  it("renders CreativeCanvasMountPoint when currentStep=1 + activeStep1Surface='canvas'", async () => {
    (api.getCanvasV2State as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      schema_version: 4,
      session_id: "s",
      _etag: "e",
      root_idea: {
        prompt: "x",
        genre: "x",
        premise: "x",
        extracted: { genre: "x", core_elements: [], potential_conflict: "" },
      },
      raw_intent: { prompt: "x", genre_primary: "x" },
      creative_session: { current_step: 1, max_steps: 5, status: "active" },
      creative_path: [],
      current_concept: {},
      final_concept: null,
      committed: false,
      committed_at: null,
      scores: { novelty: 0, conflict: 0, story_potential: 0, uniqueness: 0, computed_at: "" },
      session_metadata: {},
    });
    (api.getCreativeDivergence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      has_selection: false,
      selected_at: null,
      selected_id: null,
      variants: [],
    });
    // First render lands on step 1 + divergence (default). Click canvas.
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId("wizard-sidebar-item-canvas"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("wizard-sidebar-item-canvas").getAttribute("data-state")).toBe("current");
      expect(screen.getByTestId("creative-canvas-mount-point")).toBeInTheDocument();
    });
  });
});
