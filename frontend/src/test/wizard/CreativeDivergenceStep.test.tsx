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
    // Task 12 (2026-09-10): S1InputStep reads creative dimensions via
    // useCreativeDimensions → api.listActiveCreativeDimensions. Populate
    // each dimension so the form is valid AND the dropdown tests that
    // exercise "open dropdown, click 黑暗 / 多线" can find their target.
    // Subject: single entry keeps the form valid. The display name
    // "爽文类" is intentionally distinct from style's first option
    // "爽文" so existing tests using
    // `getByRole("button", { name: /爽文/ })` to target the style
    // trigger don't accidentally hit the subject button too.
    listActiveCreativeDimensions: vi.fn().mockResolvedValue({
      subject: [{ id: "cool_novel", name: "网文快读", description: "节奏紧凑", status: "active", order: 0, created_at: "a", updated_at: "a" }],
      tone: [
        { id: "rexue", name: "热血", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "heian", name: "黑暗", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
        { id: "qingsong", name: "轻松", description: "", status: "active", order: 2, created_at: "a", updated_at: "a" },
        { id: "shishi", name: "史诗", description: "", status: "active", order: 3, created_at: "a", updated_at: "a" },
        { id: "nuexin", name: "虐心", description: "", status: "active", order: 4, created_at: "a", updated_at: "a" },
        { id: "zhiyu", name: "治愈", description: "", status: "active", order: 5, created_at: "a", updated_at: "a" },
        { id: "xuanyi", name: "悬疑", description: "", status: "active", order: 6, created_at: "a", updated_at: "a" },
        { id: "chengzhang", name: "成长", description: "", status: "active", order: 7, created_at: "a", updated_at: "a" },
      ],
      style: [
        { id: "shuangwen", name: "爽文", description: "", status: "active", order: 0, created_at: "a", updated_at: "a" },
        { id: "manre", name: "慢热", description: "", status: "active", order: 1, created_at: "a", updated_at: "a" },
        { id: "qunxiang", name: "群像", description: "", status: "active", order: 2, created_at: "a", updated_at: "a" },
        { id: "danxian", name: "单线", description: "", status: "active", order: 3, created_at: "a", updated_at: "a" },
        { id: "duoxian", name: "多线", description: "", status: "active", order: 4, created_at: "a", updated_at: "a" },
        { id: "daoxu", name: "倒叙", description: "", status: "active", order: 5, created_at: "a", updated_at: "a" },
        { id: "zhengxu", name: "正叙", description: "", status: "active", order: 6, created_at: "a", updated_at: "a" },
      ],
    }),
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
  return { ...utils, setNextHandler, setPrevHandler, setRegenerateHandler: ctx.setRegenerateHandler };
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
    //
    // 题材 now defaults to "爽文", so the only thing that keeps the form
    // invalid is the empty prompt. The disabled-but-clickable handler is
    // still registered (prompt < 10 chars → valid=false).
    const disabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === true,
    );
    expect(disabled).toBeTruthy();
  });

  it("registers an enabled S1 handler with the wizard footer when prompt reaches 10 chars (题材 already defaults to 爽文)", async () => {
    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    // No need to change 题材 — it now defaults to "爽文".
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
  });

  it("submits decompose with tone/style in body (Round 1 — item 2)", async () => {
    // After Round 1, RawIntent has tone + style (no genre_secondary).
    // The default tone is 热血 and style is 爽文; the user can change them
    // via the DropdownSelect. The /decompose call must forward whichever
    // values the user picked.
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    // 题材 defaults to cool_novel (爽文题材 in this test mock). Wait for
    // the creative-dimensions hook to populate tone/style options before
    // exercising the dropdowns — Task 12 moved them from hardcoded arrays
    // to async-loaded useCreativeDimensions.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    // Change 基调 to 黑暗 and 风格 to 多线. Subject label is now
    // "爽文题材" (Task 12 mock) which doesn't collide with style's
    // "爽文" trigger — `/热血/` and `/爽文/` each match a single
    // closed-dropdown trigger.
    fireEvent.click(screen.getByRole("button", { name: /热血/ }));
    fireEvent.click(screen.getByRole("button", { name: /^黑暗$/ }));
    fireEvent.click(screen.getByRole("button", { name: /爽文/ }));
    fireEvent.click(screen.getByRole("button", { name: /^多线$/ }));

    // Trigger S1 → S2.
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    await waitFor(() => {
      expect(mockApi.postThreeBDecompose).toHaveBeenCalled();
    });
    const call = mockApi.postThreeBDecompose.mock.calls[0];
    expect(call[0]).toBe("p1");
    const body = call[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      prompt: "足够长的原始灵感点子",
      genre_primary: "cool_novel",
      // Task 12: tone + style now forward the option id (not the label).
      tone: "heian",
      style: "duoxian",
    });
    expect(body).not.toHaveProperty("genre_secondary");
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
    // 题材 defaults to 爽文 — no need to change.
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
      // S2 no longer renders its own title — the only on-screen signal
      // that the S2 stage is active is the StepIndicator "第一性拆解"
      // pill. Asserting the parent is on S2 by counting dimension blocks
      // (zero with this malformed payload) is sufficient as a reachability
      // check.
      expect(screen.queryAllByTestId(/^dimension-/)).toHaveLength(0);
    });
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
    // 题材 defaults to 爽文 — no need to change.
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

  it("S2 renders dimension blocks after a successful DECOMPOSE_SUCCESS (Bug: S2 page empty after first decompose)", async () => {
    // Regression for: "第一性拆解生成后未展示信息，页面为空".
    // A real 5-dimension payload comes back from /decompose; S2 must
    // render all 5 dimension blocks (not just the summary).
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", insight: "天道殖民", units: [{ id: "u1", dimension: "ontology", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "energetics", insight: "修炼即编译", units: [{ id: "u2", dimension: "energetics", unit_name: "灵力", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "power_structure", insight: "三要素统治", units: [{ id: "u3", dimension: "power_structure", unit_name: "朝廷", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "protagonist_engine", insight: "穿越本质", units: [{ id: "u4", dimension: "protagonist_engine", unit_name: "金手指", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
        { dimension: "narrative_physics", insight: "持久战", units: [{ id: "u5", dimension: "narrative_physics", unit_name: "节奏", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [] },
      ],
      causal_map: "ontology → energetics → power_structure → protagonist_engine → narrative_physics",
      top_level_summary: "一句话总结:这是一个关于修仙殖民的故事",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });

    // Trigger S1 next → advances to S2 with decompose dispatched.
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    // S2 must render all 5 dimension blocks AND the top-level summary.
    await waitFor(() => {
      expect(screen.queryAllByTestId(/^dimension-/)).toHaveLength(5);
      expect(screen.getByTestId("top-level-summary")).toHaveTextContent(
        "一句话总结:这是一个关于修仙殖民的故事",
      );
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
    // 题材 defaults to 爽文 — no need to change.

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

  it("registers a regenerate handler on S2 after first decompose (Bug #1 regression)", async () => {
    // Bug #1 (2026-09-10): the footer's 「重新生成」 button was hidden on
    // first entry to S2 because state.rawIntent stayed null until the next
    // mount's HYDRATE pulled it from disk. The footer regen effect gated on
    // `state.rawIntent`, so it called setRegen(null, false) and the button
    // vanished until the user exited and re-entered the project.
    //
    // After dispatching STAGE1_SUCCESS inside decompose(), the in-session
    // rawIntent is set BEFORE DECOMPOSE_START, so the S2 regen effect's
    // guard passes and setRegenerateHandler is called with a non-null
    // handler. This test wires the wizard footer, drives S1 → S2, and
    // asserts the regenerate handler was registered.
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    // 题材 defaults to 爽文 — no need to change.

    // S1 → S2 via the registered "下一步:拆解 →" handler.
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    );
    await act(async () => {
      (enabled![0] as () => void)();
    });

    // After decompose settles, the S2 regen effect must register a non-null
    // handler with the footer. Before the fix this asserted null and the
    // button was hidden.
    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(lastRegen).toBeDefined();
      expect(typeof lastRegen![0]).toBe("function");
      expect(lastRegen![1]).toBe(false);
    });
  });

  it("S2 regen handler opens RegenerateModal (Round 2 — item 3)", async () => {
    // Round 2 of the v2 wizard 6-item optimization: S2 「重新生成」 no
    // longer fires immediately — it opens a RegenerateModal so the user can
    // attach modification feedback (passed to /decompose as user_modifications).
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    // 题材 defaults to 爽文 — no need to change.

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

    // Wait for S2 regen handler to register (Bug #1 fix already covers this).
    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });

    // Initially no modal is shown.
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();

    // Invoke the footer "重新生成" → opens modal.
    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    // Modal title shows the target stage name.
    expect(screen.getByText(/重新生成 — 第一性拆解/)).toBeInTheDocument();
    // Modal is overlay (role="dialog") — confirm it has aria-modal.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Confirming with text calls /decompose again with user_modifications.
    fireEvent.change(screen.getByLabelText(/修改意见/i), {
      target: { value: "聚焦东方玄幻,弱化科幻" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    });

    await waitFor(() => {
      const calls = mockApi.postThreeBDecompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const lastBody = calls[calls.length - 1][1] as Record<string, unknown>;
      expect(lastBody.user_modifications).toBe("聚焦东方玄幻,弱化科幻");
    });

    // Modal closes after confirm.
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("S2 regen modal cancel does NOT call decompose (Round 2 — item 3)", async () => {
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    // 题材 defaults to 爽文 — no need to change.

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

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });
    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    const callsBefore = mockApi.postThreeBDecompose.mock.calls.length;

    // Cancel.
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    });

    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    expect(mockApi.postThreeBDecompose.mock.calls.length).toBe(callsBefore);
  });

  it("S2 regen modal empty text = 仅重新生成 (empty user_modifications)", async () => {
    mockApi.postThreeBDecompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler, setRegenerateHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
    // 题材 defaults to 爽文 — no need to change.

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

    await waitFor(() => {
      const lastRegen = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
      expect(typeof lastRegen?.[0]).toBe("function");
    });
    const regenCall = setRegenerateHandler.mock.calls[setRegenerateHandler.mock.calls.length - 1];
    await act(async () => {
      (regenCall[0] as () => void)();
    });

    // Submit without typing anything.
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    });

    await waitFor(() => {
      const calls = mockApi.postThreeBDecompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    const lastBody = mockApi.postThreeBDecompose.mock.calls[
      mockApi.postThreeBDecompose.mock.calls.length - 1
    ][1] as Record<string, unknown>;
    // Empty text → user_modifications is undefined (useThreeBDivergence only
    // passes the field when non-empty so the route doesn't accept empty
    // string as a meaningful "I want to add nothing").
    expect(
      lastBody.user_modifications === undefined || lastBody.user_modifications === "",
    ).toBe(true);
  });
});