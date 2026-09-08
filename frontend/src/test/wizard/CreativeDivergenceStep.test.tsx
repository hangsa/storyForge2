import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";
import { WizardContext } from "@/components/wizard/WizardContext";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    postThreeBDecompose: vi.fn(),
    postThreeBFollowUp: vi.fn(),
    postThreeBDiverge: vi.fn(),
    postThreeBRegenerateUnit: vi.fn(),
    postThreeBSelectUnit: vi.fn(),
    postThreeBCommit: vi.fn(),
    postThreeBEditConcept: vi.fn(),
    postThreeBAdvance: vi.fn(),
    getThreeBState: vi.fn().mockResolvedValue(null),
    deleteThreeBState: vi.fn(),
    listGenres: vi.fn().mockResolvedValue([]),
  },
}));

// `useGenres` (default import of api) and `useThreeBDivergence`
// (namespace import) both consume the same module — expose both the default
// export and the named properties so vitest resolves either access pattern.
vi.mock("@/api/client", () => ({
  __esModule: true,
  api: mockApi,
  default: mockApi,
  ...mockApi,
}));

/**
 * Test helper: render CreativeDivergenceStep with a wizard context that
 * captures every setNextHandler call. Returns the spy so tests can inspect
 * the latest handler / disabled flag and invoke the handler to simulate
 * the page-level "下一步:拆解 →" button click.
 */
function renderWithWizardContext() {
  const setNextHandler = vi.fn();
  const setPrevHandler = vi.fn();
  const ctx = {
    // CreativeDivergenceStep only reads setNextHandler/setPrevHandler
    // from the wizard context — pad the rest with no-op stubs so the
    // type is satisfied.
    setNextHandler,
    setPrevHandler,
    setRegenerateHandler: vi.fn(),
    setSaveHandler: vi.fn(),
    setRegenerateBusy: vi.fn(),
    setRegenerateSuccess: vi.fn(),
    setRegenerateFailure: vi.fn(),
    data: {},
    status: "idle",
    currentStep: 1,
    completedSteps: [],
    regenerateState: { kind: "idle" as const },
    regenerateHandler: null,
    regenerateDisabled: false,
    saveHandler: null,
    saveDisabled: false,
    nextHandler: null,
    nextDisabled: false,
    nextLabel: null,
    nextLoadingLabel: null,
    prevHandler: null,
    jumpToStep: vi.fn(),
    markStepGenerated: vi.fn(),
    reset: vi.fn(),
  };
  const utils = render(
    <WizardContext.Provider value={ctx as any}>
      <CreativeDivergenceStep projectId="p1" />
    </WizardContext.Provider>,
  );
  return { ...utils, setNextHandler, setPrevHandler };
}

describe("CreativeDivergenceStep (4 stages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getThreeBState.mockResolvedValue(null);
    mockApi.postThreeBDecompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
  });

  it("renders StepIndicator with 4 stages", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-2")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-indicator-4")).toBeInTheDocument();
  });

  it("shows S1 by default", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.getByText(/灵感点子/)).toBeInTheDocument();
  });

  it("renders without crashing and mounts all 4 stage testids", async () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId("step-indicator-1")).toBeInTheDocument();
    });
  });

  it("in S1 the inner S1InputStep does NOT render a submit button (button moved to wizard footer)", () => {
    render(<CreativeDivergenceStep projectId="p1" />);
    expect(screen.queryByRole("button", { name: /进入拆解/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /下一步:拆解/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /3B 发散/ })).toBeNull();
  });

  it("registers a DISABLED-but-clickable S1 handler on the wizard footer when form is empty", () => {
    const { setNextHandler } = renderWithWizardContext();
    // S1 has no internal save button — the wizard footer button is the
    // only path forward. The footer renders the button ONLY when
    // nextHandler is truthy (`{wizard.nextHandler && <button>}`), so we
    // must pass a function (no-op fallback) instead of null. Otherwise an
    // empty form hides the button entirely and the user is stranded.
    const disabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === true,
    );
    expect(disabled).toBeTruthy();
  });

  it("registers an enabled S1 handler with the wizard footer when form becomes valid", async () => {
    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
  });

  it("S2 survives DECOMPOSE_SUCCESS with malformed payload (missing dimensions)", async () => {
    // The S1 submit now lives in the wizard footer, so this test wires the
    // wizard context and invokes the registered handler to simulate the
    // button click.
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      // Missing `dimensions` — defensive code should treat as [].
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    // Simulate the wizard footer's "下一步:拆解 →" click.
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      expect(screen.getByText(/Stage 2 · 第一性拆解/)).toBeInTheDocument();
    });
    // 0 维度 · 0 单元 (empty array, not crash)
    expect(screen.getByText(/0 维度 · 0 单元/)).toBeInTheDocument();
  });

  it("registers prevHandler=null on S1 (no previous sub-stage)", () => {
    const { setPrevHandler } = renderWithWizardContext();
    const lastCall = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBeNull();
  });

  it("registers S2's nextHandler with sub-stage label and prevHandler to S1", async () => {
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setPrevHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    // Trigger S1 next → advances to S2
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    // S2 should register nextHandler with "下一步:发散 →" label + "拆解中…"
    // loading label, AND a prevHandler function.
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls[setNextHandler.mock.calls.length - 1];
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      expect(typeof lastNext[0]).toBe("function");
      expect(lastNext[1]).toBe(false);
      expect(lastNext[2]).toBe("下一步:发散 →");
      expect(lastNext[3]).toBe("拆解中…");
      expect(typeof lastPrev[0]).toBe("function");
    });
  });

  it("S2's registered nextHandler triggers DIVERGE when clicked with no downstream data", async () => {
    // Mock decompose to return a non-empty dimensions list so the divergence
    // hook transitions to S2 with a successful payload.
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });
    mockApi.postThreeBDiverge.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    fireEvent.change(screen.getByLabelText(/主类型/i), { target: { value: "玄幻" } });

    // S1 → S2
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const s1Next = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;
    await act(async () => {
      (s1Next[0] as () => void)();
    });

    // S2 → S3 via the registered nextHandler. With no candidates, the
    // requestNext check hasDownstreamData(state, "3") is false (dimensions
    // have no candidates), so it jumps and calls diverge().
    await waitFor(() => {
      const s2Next = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(s2Next?.[2]).toBe("下一步:发散 →");
    });
    const s2Next = setNextHandler.mock.calls
      .filter(([handler]) => typeof handler === "function")
      .pop()!;
    await act(async () => {
      (s2Next[0] as () => void)();
    });

    await waitFor(() => {
      expect(mockApi.postThreeBDiverge).toHaveBeenCalledWith("p1");
    });
  });
});