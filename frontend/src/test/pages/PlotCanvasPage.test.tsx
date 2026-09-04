import { describe, it, expect, vi } from "vitest";
import { render as _rawRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlotCanvasPage from "@/pages/PlotCanvasPage";
import type { CanvasV4State } from "@/api/client";
import { ToastProvider } from "@/hooks/useToast";
import ToastContainer from "@/components/shared/ToastContainer";

// Mock the hook at module-scope so each test can override its return value.
// We import the mocked function after vi.mock so `vi.mocked()` can type-cast.
vi.mock("@/hooks/useCreativeCanvasV2", () => ({
  useCreativeCanvasV2: vi.fn(),
}));

import { useCreativeCanvasV2 } from "@/hooks/useCreativeCanvasV2";
const mockUseCreativeCanvasV2 = vi.mocked(useCreativeCanvasV2);

// ToastProvider wrapper — PlotCanvasPage calls useToast() to surface
// hook errors (init / select / nextStep failures). Without this wrapper
// useToast throws. ToastContainer renders the actual DOM so we can assert
// on toast text. In production both live in App.tsx (provider wraps the
// router tree, container sits as a sibling); for tests we colocate them
// inside the render boundary.
function renderWithProviders(ui: React.ReactNode) {
  return _rawRender(
    <ToastProvider>
      {ui}
      <ToastContainer />
    </ToastProvider>,
  );
}

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

describe("PlotCanvasPage", () => {
  it("renders EmptyState when canvas is null", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(null));
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders StepIndicator + TreeCanvas when canvas is active", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /^提交$/ })).toBeNull();
  });
});

describe("PlotCanvasPage embedded mode", () => {
  it("does not render page-shell header when embedded=true", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    // Page-shell header is the h2 "Creative Canvas" + subtitle + StepIndicator
    // block. When embedded=true, the wizard provides chrome so we omit it.
    expect(screen.queryByRole("heading", { name: /Creative Canvas/ })).toBeNull();
    // Also confirm the wrapper data-testid is absent in embedded mode.
    expect(screen.queryByTestId("creative-canvas-page")).toBeNull();
  });

  it("renders page-shell header in standalone (non-embedded) mode", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(baseCanvas));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" />);
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
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    const panel = screen.getByTestId("empty-state");
    expect(panel.className).not.toContain("max-w-2xl");
    expect(panel.className).not.toContain("mx-auto");
  });

  it("forwards embedded=false to EmptyState (keeps max-w-2xl) when canvas is null (standalone)", () => {
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(null));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" />);
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
    renderWithProviders(
      <PlotCanvasPage projectId="proj_test" embedded onCommitSuccess={onCommitSuccess} />
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
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
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
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
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
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    const callout = screen.getByTestId("operation-reason-callout");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent(/为什么是「fuse」/);
    expect(callout).toHaveTextContent(/step 3 reason/);
    // Class tokens that distinguish a styled callout from plain text.
    expect(callout.className).toMatch(/rounded|border|bg-/);
  });

  it("surfaces hook errors as a toast instead of swallowing them silently", () => {
    // Bug fix 2026-09-03: previously the onInit callback was
    // `initSession(...).catch(() => {})` — the failure was invisible to
    // the user. With the v2 router NOT mounted in dev (enable_canvas_v2
    // flag), init silently 404'd and the page stayed on EmptyState. The
    // user thought 开始创意推演 did nothing. Now the hook's `error`
    // surfaces via a toast so the user sees the failure.
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(baseCanvas),
      error: "init failed: API 返回 404",
    });
    renderWithProviders(<PlotCanvasPage projectId="proj_test" />);
    // The toast is rendered via ToastContainer — find it by the message text.
    expect(screen.getByText(/画布操作失败.*init failed/)).toBeInTheDocument();
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
describe("PlotCanvasPage malformed-canvas regression", () => {
  it("does not crash when canvas.creative_path is undefined", () => {
    const malformed = {
      ...baseCanvas,
      creative_path: undefined as never,
    };
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(malformed));
    expect(() =>
      renderWithProviders(
        <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
          <Routes>
            <Route path="/project/:projectId/stage1/canvas" element={<PlotCanvasPage />} />
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
      renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />),
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
    //
    // Spec §3.3 invariant change (2026-09-04 canvas-init-next-step):
    // when no active step exists but Step 1 is available, the page now
    // renders <CanvasPreStepHint> INSIDE the `active-step-panel`
    // wrapper. Previously the wrapper was hidden — that left the user
    // staring at 3 empty circles + a central 继续 button with no
    // guidance. Now the panel testid survives; the assertion flips
    // from `.toBeNull()` to `.toBeInTheDocument()` to match the new
    // contract. See new describe block "Step 1 continue wiring" for
    // the click-through behavior.
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
      renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />),
    ).not.toThrow();
    expect(screen.getByTestId("tree-canvas")).toBeInTheDocument();
    // Spec §3.3: active-step-panel now wraps CanvasPreStepHint so users
    // get an explicit "点击上方继续，让 AI 决定这一步用什么创意操作"
    // pointer at the central advance button.
    expect(screen.getByTestId("active-step-panel")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-pre-step-hint")).toBeInTheDocument();
  });
});

// Step 1 continue wiring — spec §3.2/§3.3 of
// 2026-09-04-canvas-init-next-step-design.md. After /init, Step 1 lands
// in state="available" with empty options. The user needs two paths to
// trigger /next-step(1):
//   1. A 继续 button on the IdeaRootNode card (right side) — primary.
//   2. The central advance button already rendered by TreeCanvas —
//      kept for back-compat.
// Plus the active-step area renders a CanvasPreStepHint pointing at
// affordance (1). Step 2-5 cascade from /select and never hit
// "available" in real flow, so the IdeaRootNode button is Step-1-only.
describe("PlotCanvasPage Step 1 continue wiring", () => {
  const buildFreshInit = (): CanvasV4State => ({
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
  });

  it("renders the IdeaRootNode 继续 button after init", () => {
    // Spec §3.2: Step 1 in 'available' state → IdeaRootNode receives
    // onContinue so the right-side button is rendered. Pure-display
    // fixtures (no canvas yet) MUST NOT show the button — gate it on
    // step 1 availability.
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(buildFreshInit()));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    expect(screen.getByTestId("idea-root-continue")).toBeInTheDocument();
  });

  it("renders CanvasPreStepHint in the active-step area after init", () => {
    // Spec §3.3: when no active step exists but Step 1 is available,
    // the active-step area must contain the PreStepHint placeholder.
    // Without this, users saw 3 empty circles + a central button with
    // no explanation of what would happen on click.
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(buildFreshInit()));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    expect(screen.getByTestId("active-step-panel")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-pre-step-hint")).toBeInTheDocument();
  });

  it("clicking the IdeaRootNode 继续 button invokes nextStep(1)", async () => {
    // Spec §3.2: page computes isStep1Available from creative_path[0]
    // and forwards nextStep(1) via onContinue. Without this wiring the
    // button is dead and the canvas never leaves the available state.
    const nextStep = vi.fn().mockResolvedValue(undefined);
    mockUseCreativeCanvasV2.mockReturnValue({
      ...defaultHookReturn(buildFreshInit()),
      nextStep,
    });
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    await waitFor(() => expect(nextStep).toHaveBeenCalledTimes(1));
    expect(nextStep).toHaveBeenCalledWith(1);
  });

  it("does not render the IdeaRootNode 继续 button when Step 2 is available", () => {
    // Spec §3.3: the IdeaRootNode button is Step-1-only. Step 2-5
    // cascade from /select so they never land in 'available' in real
    // flow — but defensively, if a step is missing the gate must not
    // misfire for step >= 2 (that would advance the wrong step).
    const step2Available: CanvasV4State = {
      ...baseCanvas,
      creative_session: { current_step: 2, max_steps: 5, status: "active" },
      creative_path: [
        {
          step: 1,
          operation: "twist",
          operation_reason: "r",
          options: [
            { id: "opt_1_a", title: "A", premise: "p", logic: "", scores: {} },
            { id: "opt_1_b", title: "B", premise: "p", logic: "", scores: {} },
            { id: "opt_1_c", title: "C", premise: "p", logic: "", scores: {} },
          ],
          selected_option_id: "opt_1_b",
          created_at: "2026-09-03T00:00:00",
          selected_at: "2026-09-03T00:00:01",
          regenerated_count: 0,
          state: "completed",
        },
        {
          step: 2,
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
    mockUseCreativeCanvasV2.mockReturnValue(defaultHookReturn(step2Available));
    renderWithProviders(<PlotCanvasPage projectId="proj_test" embedded />);
    // Gate is Step 1 only — Step 2 available must NOT light up the
    // IdeaRootNode button (which would call nextStep(1) and re-generate
    // already-completed step 1).
    expect(screen.queryByTestId("idea-root-continue")).toBeNull();
  });
});