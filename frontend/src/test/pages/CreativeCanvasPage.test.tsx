import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CreativeCanvasPage from "@/pages/CreativeCanvasPage";
import type { CanvasV4State } from "@/api/client";

// Mock the hook at module-scope so each test can override its return value.
// We import the mocked function after vi.mock so `vi.mocked()` can type-cast.
vi.mock("@/hooks/useCreativeCanvasV2", () => ({
  useCreativeCanvasV2: vi.fn(),
}));

import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
const mockUseCreativeCanvasV2 = vi.mocked(useCreativeCanvasV2);

// Full CanvasV4State fixture: step 1+2 completed, step 3 active, so the page
// renders StepIndicator + TreeCanvas + the active-step OptionCard row. Mirrors
// TreeCanvas.test.tsx's baseState so the page-level assertions match the same
// contract the canvas-level test already validates.
const baseCanvas: CanvasV4State = {
  schema_version: 4,
  session_id: "s",
  _etag: "e",
  root_idea: {
    prompt: "修仙对抗外星",
    genre: "xianxia",
    premise: "x",
    extracted: { genre: "xianxia", core_elements: [], potential_conflict: "" },
  },
  raw_intent: { prompt: "修仙对抗外星", genre_primary: "xianxia" },
  creative_session: { current_step: 3, max_steps: 5, status: "active" },
  creative_path: [
    {
      step: 1,
      operation: "twist",
      operation_reason: "step 1 reason",
      options: [
        { id: "opt_1_a", title: "A1", premise: "p", logic: "", scores: {} },
        { id: "opt_1_b", title: "B1", premise: "p", logic: "", scores: {} },
        { id: "opt_1_c", title: "C1", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: "opt_1_b",
      created_at: "2026-09-03T00:00:00",
      selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0,
      state: "completed",
    },
    {
      step: 2,
      operation: "invert",
      operation_reason: "step 2 reason",
      options: [
        { id: "opt_2_a", title: "A2", premise: "p", logic: "", scores: {} },
        { id: "opt_2_b", title: "B2", premise: "p", logic: "", scores: {} },
        { id: "opt_2_c", title: "C2", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: "opt_2_b",
      created_at: "2026-09-03T00:00:00",
      selected_at: "2026-09-03T00:00:01",
      regenerated_count: 0,
      state: "completed",
    },
    {
      step: 3,
      operation: "fuse",
      operation_reason: "step 3 reason",
      options: [
        { id: "opt_3_a", title: "A3", premise: "p", logic: "", scores: {} },
        { id: "opt_3_b", title: "B3", premise: "p", logic: "", scores: {} },
        { id: "opt_3_c", title: "C3", premise: "p", logic: "", scores: {} },
      ],
      selected_option_id: null,
      created_at: "2026-09-03T00:00:00",
      selected_at: null,
      regenerated_count: 0,
      state: "active",
    },
  ],
  current_concept: {
    premise: "x",
    core_conflict: "",
    characters: [],
    world_rules: [],
    tropes: [],
    themes: [],
    novelty: 0,
  },
  final_concept: null,
  committed: false,
  committed_at: null,
  committed_concept_ref: "concept_and_dna.json",
  scores: {
    novelty: 0.7,
    conflict: 0.6,
    story_potential: 0,
    uniqueness: 0,
    computed_at: "2026-09-03T00:00:00",
  },
  session_metadata: {
    created_at: "2026-09-03T00:00:00",
    last_modified_at: "2026-09-03T00:00:00",
    elapsed_seconds: 0,
    operation_count: 0,
  },
};

function defaultHookReturn(canvas: CanvasV4State | null = baseCanvas) {
  return {
    status: canvas ? ("active" as const) : ("empty" as const),
    canvas,
    error: null,
    loadingStep: false,
    committedAt: null,
    canCommit: false,
    loadCanvas: vi.fn(),
    initSession: vi.fn().mockResolvedValue(undefined),
    nextStep: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    commitCanvas: vi.fn().mockResolvedValue(undefined),
    showResetDialog: false,
    onReset: vi.fn(),
    closeResetDialog: vi.fn(),
    confirmReset: vi.fn().mockResolvedValue(undefined),
    showPreCommit: false,
    onCommitClick: vi.fn(),
    closePreCommit: vi.fn(),
    confirmCommit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CreativeCanvasPage", () => {
  it("renders EmptyState when canvas is null", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(null));
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders StepIndicator + TreeCanvas when canvas is active", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("step-indicator")).toBeInTheDocument();
    // TreeCanvas renders one step-column per creative_path entry
    expect(screen.getAllByTestId(/^step-column-/)).toHaveLength(3);
    // Active step panel renders 3 OptionCards (A/B/C) for the active step
    expect(screen.getByTestId("active-step-panel")).toBeInTheDocument();
  });

  it("opens ResetConfirmDialog when 重新开始 is clicked", () => {
    const onReset = vi.fn();
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      onReset,
    });
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /重新开始/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("shows ResetConfirmDialog when showResetDialog is true", () => {
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      showResetDialog: true,
    });
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("reset-confirm-dialog")).toBeInTheDocument();
  });

  it("opens PreCommitSummary when 提交 is clicked", () => {
    const onCommitClick = vi.fn();
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      canCommit: true,
      onCommitClick,
    });
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /提交/ }));
    expect(onCommitClick).toHaveBeenCalledTimes(1);
  });

  it("shows PreCommitSummary when showPreCommit is true", () => {
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      canCommit: true,
      showPreCommit: true,
    });
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("pre-commit-summary")).toBeInTheDocument();
  });

  it("hides 提交 button when canCommit is false", () => {
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      canCommit: false,
    });
    render(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /^提交$/ })).toBeNull();
  });
});