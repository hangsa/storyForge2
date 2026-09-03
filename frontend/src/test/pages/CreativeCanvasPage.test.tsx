import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("CreativeCanvasPage embedded mode", () => {
  it("does not render page-shell header when embedded=true", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    render(<CreativeCanvasPage projectId="proj_test" embedded />);
    // Page-shell header is the h2 "Creative Canvas" + subtitle + StepIndicator
    // block. When embedded=true, the wizard provides chrome so we omit it.
    expect(screen.queryByRole("heading", { name: /Creative Canvas/ })).toBeNull();
    // Also confirm the wrapper data-testid is absent in embedded mode.
    expect(screen.queryByTestId("creative-canvas-page")).toBeNull();
  });

  it("renders page-shell header in standalone (non-embedded) mode", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    render(<CreativeCanvasPage projectId="proj_test" />);
    // Sanity check the inverse — standalone mode keeps the wrapper + header.
    expect(screen.getByTestId("creative-canvas-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Creative Canvas/ })).toBeInTheDocument();
  });

  it("forwards embedded=true to EmptyState (no max-w-2xl) when canvas is null", () => {
    // When canvas is null the page renders <EmptyState>. In embedded mode
    // the EmptyState drops its max-w-2xl/mx-auto constraint so it fills
    // the wizard main area (no left/right whitespace). Standalone keeps
    // the centered narrow look.
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(null));
    render(<CreativeCanvasPage projectId="proj_test" embedded />);
    const panel = screen.getByTestId("empty-state");
    expect(panel.className).not.toContain("max-w-2xl");
    expect(panel.className).not.toContain("mx-auto");
  });

  it("forwards embedded=false to EmptyState (keeps max-w-2xl) when canvas is null (standalone)", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(null));
    render(<CreativeCanvasPage projectId="proj_test" />);
    const panel = screen.getByTestId("empty-state");
    expect(panel.className).toContain("max-w-2xl");
    expect(panel.className).toContain("mx-auto");
  });

  it("invokes onCommitSuccess after confirmCommit resolves", async () => {
    const onCommitSuccess = vi.fn();
    const confirmCommit = vi.fn().mockResolvedValue(undefined);
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      canCommit: true,
      showPreCommit: true,
      confirmCommit,
    });
    render(
      <CreativeCanvasPage projectId="proj_test" embedded onCommitSuccess={onCommitSuccess} />
    );
    // PreCommitSummary is shown (showPreCommit=true); click the confirm button.
    fireEvent.click(screen.getByRole("button", { name: /形成概念/ }));
    await waitFor(() => expect(onCommitSuccess).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(confirmCommit).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onCommitSuccess when not provided (back-compat)", async () => {
    const confirmCommit = vi.fn().mockResolvedValue(undefined);
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      canCommit: true,
      showPreCommit: true,
      confirmCommit,
    });
    // No onCommitSuccess prop — should not throw.
    render(<CreativeCanvasPage projectId="proj_test" embedded />);
    fireEvent.click(screen.getByRole("button", { name: /形成概念/ }));
    await waitFor(() => expect(confirmCommit).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("wires the available-step 继续 button to nextStep on the hook", async () => {
    // PRD §5.2: AVAILABLE → ACTIVE is user-triggered via the 继续 button
    // TreeCanvas renders inside an available step column. Page wires
    // nextStep as onAdvance; clicking must call it with the step number.
    // Regression guard: if the page forgets to forward nextStep, the
    // button becomes dead and the user gets stuck on step 1 forever
    // (root cause of the "只有一个原始想法的点" user report).
    const nextStep = vi.fn().mockResolvedValue(undefined);
    const freshInit: CanvasV4State = {
      ...baseCanvas,
      creative_session: { current_step: 1, max_steps: 5, status: "active" },
      creative_path: [
        {
          step: 1,
          operation: null,
          operation_reason: null,
          options: [],
          selected_option_id: null,
          created_at: "2026-09-03T00:00:00",
          selected_at: null,
          regenerated_count: 0,
          state: "available",
        },
      ],
    };
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(freshInit),
      nextStep,
    });
    render(<CreativeCanvasPage projectId="proj_test" embedded />);
    fireEvent.click(screen.getByTestId("advance-step-1"));
    await waitFor(() => expect(nextStep).toHaveBeenCalledTimes(1));
    expect(nextStep).toHaveBeenCalledWith(1);
  });

  it("renders the AI-recommended-operation reasoning inside a callout-style block", async () => {
    // PRD §15.1: "为什么是这个操作" 建立用户对 AI 的信任. Was a tiny
    // muted line at the bottom of the active-step panel — easy to
    // miss. Upgraded to a callout block with an icon so users
    // actually read the rationale before picking A/B/C.
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    render(<CreativeCanvasPage projectId="proj_test" embedded />);
    const callout = screen.getByTestId("operation-reason-callout");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent(/为什么是「fuse」/);
    expect(callout).toHaveTextContent(/step 3 reason/);
    // Class tokens that distinguish a styled callout from plain text.
    expect(callout.className).toMatch(/rounded|border|bg-/);
  });
});

// Workspace render crash regression: user reported
// "Cannot read properties of undefined (reading 'find')" after clicking
// 开始创意推演 on the canvas surface. The crash was a render-time
// throw from `canvas.creative_path.find(...)` (page:100), `activeStep
// .options.find(...)` (page:146), or `s.options.find(...)` (TreeCanvas
// :110) when the backend response shape drifted from the TS contract.
// Page now treats a missing/non-array creative_path or options as [] so
// the user sees an empty tree + no active step instead of a hard crash.
describe("CreativeCanvasPage malformed-canvas regression", () => {
  it("does not crash when canvas.creative_path is undefined", () => {
    const malformed = {
      ...baseCanvas,
      creative_path: undefined as never,
    };
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(malformed));
    expect(() =>
      render(
        <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
          <Routes>
            <Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
          </Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();
    // Tree still renders the root idea — empty step list rather than crash.
    expect(screen.getByTestId("tree-canvas")).toBeInTheDocument();
    // No active-step panel since no active step exists in cpath.
    expect(screen.queryByTestId("active-step-panel")).toBeNull();
  });

  it("does not crash when activeStep.options is undefined", () => {
    const malformed = {
      ...baseCanvas,
      creative_path: [
        // Active step but options is undefined — page:146 previously threw
        {
          ...baseCanvas.creative_path[2],
          options: undefined as never,
          state: "active" as const,
        },
      ],
    };
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(malformed));
    expect(() =>
      render(<CreativeCanvasPage projectId="proj_test" embedded />),
    ).not.toThrow();
    // Active step panel still renders (3 slots), each OptionCard falls back
    // to undefined option and is skipped via the `if (!option) return null`
    // guard. With options=[undefined x3], no option-card-* testid appears
    // but the panel container does — sanity check it didn't throw.
    expect(screen.getByTestId("active-step-panel")).toBeInTheDocument();
  });

  it("does not crash on freshly-init canvas (state='available', options=[])", () => {
    // Mirror what backend/api/v2_canvas.py:271 emits after init — the
    // step exists with state="available" and empty options, not the
    // "completed" or "active" states the existing fixtures assume.
    const freshInit: CanvasV4State = {
      ...baseCanvas,
      creative_session: { current_step: 1, max_steps: 5, status: "active" },
      creative_path: [
        {
          step: 1,
          operation: null,
          operation_reason: null,
          options: [],
          selected_option_id: null,
          created_at: "2026-09-03T00:00:00",
          selected_at: null,
          regenerated_count: 0,
          state: "available",
        },
      ],
    };
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(freshInit));
    expect(() =>
      render(<CreativeCanvasPage projectId="proj_test" embedded />),
    ).not.toThrow();
    expect(screen.getByTestId("tree-canvas")).toBeInTheDocument();
    // No active step → no panel
    expect(screen.queryByTestId("active-step-panel")).toBeNull();
  });
});