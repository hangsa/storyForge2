import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import WorkspaceWizardPanel from "./WorkspaceWizardPanel";

// Use console-aware spy pattern: capture React error-overlay error output.
function captureReactErrors() {
  const errors: Array<{ messages: string[] }> = [];
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    // React emits error overlay with: console.error("...", componentStack)
    // Capture only React-shaped messages.
    const messages = args.map((a) =>
      typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : String(a),
    );
    if (messages.some((m) => m.includes("Cannot read") || m.includes("TypeError"))) {
      errors.push({ messages });
    }
  });
  return { errors, errSpy };
}

// Scenario from the bug report:
//   - Step 1 default → CreativeDivergenceStep mounts → calls
//     getDivergeState. When /state returns a 404-shaped or null body the
//     component must NOT crash the panel.
//
// After the Plan-Task-25 cleanup WorkspaceWizardPanel's prefill effect
// no longer calls any creative-divergence endpoint itself; the inner
// CreativeDivergenceStep fetches /state on its own and tolerates the
// failure path (fall through to SubStage A).

vi.mock("../../api/client", () => ({
  default: {
    getDivergeState: vi.fn().mockResolvedValue("Not Found"),
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
    getConcept: vi.fn().mockResolvedValue({}),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({}),
    getNovelOutline: vi.fn().mockResolvedValue({}),
    getOutline: vi.fn().mockResolvedValue({}),
    // 3B divergence (Plan 2026-09-05): useThreeBDivergence fires
    // getThreeBState on mount. Mock empty-state so the hook's HYDRATE
    // runs without throwing.
    getThreeBState: vi.fn().mockResolvedValue({
      schema_version: 1,
      project_id: "proj_test",
      raw_intent: null,
      stage2_candidates: [],
      stage3_deepened: [],
      committed: false,
    }),
    deleteThreeBState: vi.fn().mockResolvedValue({ ok: true }),
    // Theme migration (2026-09-05): S1InputStep calls useGenres → api.listGenres
    listGenres: vi.fn().mockResolvedValue([]),
    // Task 12 (2026-09-10): S1InputStep now reads creative dimensions via
    // useCreativeDimensions → api.listActiveCreativeDimensions. Empty
    // arrays keep these crash tests focused on the prefill paths.
    listActiveCreativeDimensions: vi.fn().mockResolvedValue({ subject: [], tone: [], style: [] }),
    // Genre-inheritance fix (2026-09-11): useThreeBDivergence fires
    // getProjectStatus on mount. Empty genre is safe because the S1 form
    // is not exercised in these crash tests.
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T", genre: "" }),
  },
}));

describe("WorkspaceWizardPanel crash repro", () => {
  it("renders without crashing with 404-shaped prefill envelope", async () => {
    const { errors, errSpy } = captureReactErrors();
    render(<MemoryRouter><WorkspaceWizardPanel projectId="proj_test" /></MemoryRouter>);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="wizard-sidebar"]')).toBeInTheDocument();
    });

    if (errors.length > 0) {
      console.log("=== Captured React errors ===");
      errors.forEach((e, idx) => {
        console.log(`[${idx}]`);
        e.messages.forEach((m) => console.log(" ", m));
      });
    } else {
      console.log("=== No React errors captured ===");
    }
    errSpy.mockRestore();
    expect(errors.length).toBe(0);
  });

  it("renders without crashing when state API returns null body", async () => {
    vi.resetModules();
    // Reset mock for fresh scenario
    const { errors, errSpy } = captureReactErrors();

    // Re-mock with null body
    vi.doMock("../../api/client", () => ({
      default: {
        getDivergeState: vi.fn().mockResolvedValue(null),
        getCreativeDivergence: vi.fn().mockResolvedValue({
          variants: [],
          selected_id: null,
          has_selection: false,
          selected_at: null,
        }),
        getCanvasV2State: vi.fn().mockResolvedValue(null),
        getConcept: vi.fn().mockResolvedValue(null),
        getWorld: vi.fn().mockResolvedValue(null),
        getCharacter: vi.fn().mockResolvedValue(null),
        getNovelOutline: vi.fn().mockResolvedValue(null),
        getOutline: vi.fn().mockResolvedValue(null),
        // 3B divergence (Plan 2026-09-05): mirror first-block mock.
        getThreeBState: vi.fn().mockResolvedValue({
          schema_version: 1,
          project_id: "proj_test",
          raw_intent: null,
          stage2_candidates: [],
          stage3_deepened: [],
          committed: false,
        }),
        deleteThreeBState: vi.fn().mockResolvedValue({ ok: true }),
        // Theme migration (2026-09-05): mirror first-block mock
        listGenres: vi.fn().mockResolvedValue([]),
        // Task 12 (2026-09-10): mirror first-block mock.
        listActiveCreativeDimensions: vi.fn().mockResolvedValue({ subject: [], tone: [], style: [] }),
        // Genre-inheritance fix (2026-09-11): mirror first-block mock.
        getProjectStatus: vi.fn().mockResolvedValue({ title: "T", genre: "" }),
      },
    }));

    const { default: FreshPanel } = await import("./WorkspaceWizardPanel");
    render(<MemoryRouter><FreshPanel projectId="proj_test" /></MemoryRouter>);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="wizard-sidebar"]')).toBeInTheDocument();
    });

    if (errors.length > 0) {
      console.log("=== Captured React errors (state=null) ===");
      errors.forEach((e, idx) => {
        console.log(`[${idx}]`);
        e.messages.forEach((m) => console.log(" ", m));
      });
    }
    errSpy.mockRestore();
    expect(errors.length).toBe(0);
  });
});
