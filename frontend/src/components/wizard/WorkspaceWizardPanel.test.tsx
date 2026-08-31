import { render, screen, waitFor } from "@testing-library/react";
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
    getConcept: vi.fn().mockRejectedValue(new Error("404")),
    getWorld: vi.fn().mockRejectedValue(new Error("404")),
    getCharacter: vi.fn().mockRejectedValue(new Error("404")),
    getNovelOutline: vi.fn().mockRejectedValue(new Error("404")),
    getOutline: vi.fn().mockRejectedValue(new Error("404")),
  },
}));

describe("WorkspaceWizardPanel", () => {
  it("renders WizardSidebar + step 1 canvas", async () => {
    render(<WorkspaceWizardPanel projectId="proj_test" />);
    expect(screen.getByTestId("wizard-sidebar")).toBeInTheDocument();
    // "创意发散" appears in the sidebar item, header subtitle, and step 1 h2.
    // Asserting ≥1 match confirms step 1's canvas mounted.
    await waitFor(() => expect(screen.getAllByText("创意发散").length).toBeGreaterThanOrEqual(1));
  });

  it("calls the remaining prefill endpoints on mount", async () => {
    render(<WorkspaceWizardPanel projectId="proj_test" />);
    await waitFor(() => {
      expect(api.getConcept).toHaveBeenCalled();
      expect(api.getWorld).toHaveBeenCalled();
      expect(api.getCharacter).toHaveBeenCalled();
      expect(api.getNovelOutline).toHaveBeenCalled();
      expect(api.getOutline).toHaveBeenCalled();
    });
  });
});
