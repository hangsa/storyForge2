import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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
    getConcept: vi.fn().mockRejectedValue(new Error("404")),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockRejectedValue(new Error("404")),
    getOutline: vi.fn().mockRejectedValue(new Error("404")),
  },
}));

describe("WorkspaceWizardPanel", () => {
  it("renders WizardSidebar + step 1 divergence step", async () => {
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument();
    // "创意发散" appears in the sidebar item, header subtitle, and step 1 h2.
    // Asserting ≥1 match confirms step 1's divergence step mounted.
    await waitFor(() => expect(screen.getAllByText("创意发散").length).toBeGreaterThanOrEqual(1));
  });

  it("does NOT render the 创意画布 sidebar module (canvas refactor pending)", async () => {
    // The 创意画布 sidebar module was removed on 2026-09-02 while the
    // feature is being refactored (see docs/design/creative-canvas-module.md).
    // The modules slot should be omitted (not rendered with a canvas entry).
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    expect(screen.queryByTestId("wizard-sidebar-modules")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wizard-sidebar-module-canvas")).not.toBeInTheDocument();
  });

  it("calls the remaining prefill endpoints on mount", async () => {
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);
    await waitFor(() => {
      expect(api.getConcept).toHaveBeenCalled();
      expect(api.getWorld).toHaveBeenCalled();
      expect(api.getCharacter).toHaveBeenCalled();
      expect(api.getNovelOutline).toHaveBeenCalled();
      expect(api.getOutline).toHaveBeenCalled();
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
      // Sidebar item 1 should NOT be disabled once prefill completes.
      expect(screen.getByTestId("wizard-sidebar-item-1")).not.toHaveAttribute("disabled");
      // Sidebar item 3 (world), 4 (character), etc., are still disabled
      // because we didn't mock a world.json here.
      expect(screen.getByTestId("wizard-sidebar-item-3")).toHaveAttribute("disabled");
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
      expect(screen.getByTestId("wizard-sidebar-item-1")).not.toHaveAttribute("disabled");
    });
  });
});
