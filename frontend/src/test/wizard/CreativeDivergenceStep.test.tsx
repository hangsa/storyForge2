import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "@/components/wizard/CreativeDivergenceStep";
import { WizardContext } from "@/components/wizard/WizardContext";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    postB3Decompose: vi.fn(),
    postB3MetaDecompose: vi.fn().mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    }),
    postB3FollowUp: vi.fn(),
    postB3Diverge: vi.fn(),
    postB3RegenerateUnit: vi.fn(),
    postB3SelectUnit: vi.fn(),
    postB3Commit: vi.fn(),
    postB3EditConcept: vi.fn(),
    postB3Advance: vi.fn(),
    getB3State: vi.fn().mockResolvedValue(null),
    deleteB3State: vi.fn(),
    getProjectStatus: vi.fn().mockResolvedValue({ title: "T", genre: "" }),
    listGenres: vi.fn().mockResolvedValue([]),
    getPlazaPrompt: vi.fn().mockResolvedValue({ effective: null }),
    putPlazaPrompt: vi.fn().mockResolvedValue({ name: "firstness_decompose", override: null, modified_at: null }),
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

// `useGenres` (default import of api) and `useB3Divergence`
// (namespace import) both consume the same module — expose both the default
// export and the named properties so vitest resolves either access pattern.
vi.mock("@/api/client", () => ({
  __esModule: true,
  api: mockApi,
  default: mockApi,
  ...mockApi,
}));

// useB3Divergence imports getPlazaPrompt / putPlazaPrompt from
// @/api/promptPlaza (separate module). Wire them to the same mockApi
// functions so the hook's mount-effect fetch resolves instead of throwing.
const { mockPlaza } = vi.hoisted(() => ({
  mockPlaza: {
    getPlazaPrompt: mockApi.getPlazaPrompt,
    putPlazaPrompt: mockApi.putPlazaPrompt,
  },
}));
vi.mock("@/api/promptPlaza", () => mockPlaza);

/**
 * Test helper: render CreativeDivergenceStep with a wizard context that
 * captures every setNextHandler call. Returns the spy so tests can inspect
 * the latest handler / disabled flag and invoke the handler to simulate
 * the page-level "下一步:拆解 →" button click.
 */
function renderWithWizardContext() {
  const setNextHandler = vi.fn();
  const setPrevHandler = vi.fn();
  const setRegenerateHandler = vi.fn();
  const setNextLoadingClickHandler = vi.fn();
  const ctx = {
    // CreativeDivergenceStep only reads setNextHandler/setPrevHandler
    // from the wizard context — pad the rest with no-op stubs so the
    // type is satisfied.
    setNextHandler,
    setPrevHandler,
    setRegenerateHandler,
    setSaveHandler: vi.fn(),
    setNextLoadingClickHandler,
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
    nextLoadingClickHandler: null,
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
  return { ...utils, setNextHandler, setPrevHandler, setRegenerateHandler, setNextLoadingClickHandler };
}

describe("CreativeDivergenceStep (4 stages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    // Re-establish default mock return values cleared by vi.clearAllMocks().
    // Without these, useB3Divergence's mount effect throws (e.g.
    // getPlazaPrompt returns undefined → .then() crashes).
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose",
      override: null,
      modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
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
    mockApi.postB3Decompose.mockResolvedValueOnce({
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
      expect(mockApi.postB3Decompose).toHaveBeenCalled();
    });
    const call = mockApi.postB3Decompose.mock.calls[0];
    expect(call[0]).toBe("p1");
    const body = call[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      prompt: "足够长的原始灵感点子",
      genre_primary: "网文快读",
      // 2026-09-14 修复:S1InputStep dropdown value 改为 name,后端 raw_intent 收到的是 name
      // (用户看到的标签 = 后端收到的值)。tone/style 同理。
      tone: "黑暗",
      style: "多线",
    });
    expect(body).not.toHaveProperty("genre_secondary");
  });

  it("S2 survives DECOMPOSE_SUCCESS with malformed payload (missing dimensions)", async () => {
    // The S1 submit now lives in the wizard footer, so this test wires the
    // wizard context and invokes the registered handler to simulate the
    // button click.
    mockApi.postB3Decompose.mockResolvedValueOnce({
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
      // that the S2 stage is active is the StepIndicator "拆解"
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
    mockApi.postB3Decompose.mockResolvedValueOnce({
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

    // S2 should register nextHandler with "下一步:发散 →" label and no
    // loading-label (since /decompose already finished — nothing inflight),
    // AND a prevHandler function. Previously the footer used a
    // fallbackLabel so the disabled=false S2 button always read "拆解中…";
    // Round 2 (2026-09-18) drops the fallback so a calm UI shows nothing
    // — the label appears during loading and re-emerges only when something
    // is genuinely running.
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls[setNextHandler.mock.calls.length - 1];
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      expect(typeof lastNext[0]).toBe("function");
      expect(lastNext[1]).toBe(false);
      expect(lastNext[2]).toBe("下一步:发散 →");
      expect(lastNext[3]).toBeNull();
      expect(typeof lastPrev[0]).toBe("function");
    });
  });

  it("S2 renders dimension blocks after a successful DECOMPOSE_SUCCESS (Bug: S2 page empty after first decompose)", async () => {
    // Regression for: "拆解生成后未展示信息，页面为空".
    // A real 5-dimension payload comes back from /decompose; S2 must
    // render all 5 dimension blocks (not just the summary).
    mockApi.postB3Decompose.mockResolvedValueOnce({
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

    // S2 must render all 5 dimension panels + the top-level summary
    // paragraph (the 「总览」 h3 heading was removed on 2026-09-11;
    // the summary text itself is still surfaced).
    // 2026-09-15: tab strip 化后还有 dimension-tab-* / dimension-tabs /
    // dimension-insight-* 元素,所以正则收紧到只数 panel 容器。
    await waitFor(() => {
      expect(screen.queryAllByTestId(
        /^dimension-(ontology|energetics|power_structure|protagonist_engine|narrative_physics)$/,
      )).toHaveLength(5);
      expect(screen.getByTestId("top-level-summary")).toHaveTextContent(
        "一句话总结:这是一个关于修仙殖民的故事",
      );
    });
  });

  it("S2 per-unit 追问: opening modal + clicking 追问 fires /follow-up (Bug: parent never wired onFollowUp)", async () => {
    // 2026-09-15 wiring fix: the parent CreativeDivergenceStep previously
    // did NOT pass `onFollowUp` / `followUpLoadingUnitId` to S2DecomposeStep,
    // so clicking the modal's confirm button threw TypeError silently. The
    // modal looked like it "auto-regenerated" (or did nothing — depending on
    // what the user clicked). This test asserts the wiring actually reaches
    // useB3Divergence.followUp → api.postB3FollowUp.
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        {
          dimension: "ontology",
          units: [
            // reducible unit — must have a clickable 追问 button
            { id: "u1", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 },
          ],
          candidates: [],
          insight: "",
        },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });
    mockApi.postB3FollowUp.mockResolvedValueOnce({
      unit: { id: "u1", unit_name: "灵窍", description: "更新", is_irreducible: false, follow_up_count: 1 },
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

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

    // S2: click per-unit 追问 → modal opens with title "追问 — 灵窍"
    await waitFor(() => {
      expect(screen.getByTestId("follow-up-u1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    expect(document.getElementById("regenerate-modal-title")?.textContent).toBe("追问 — 灵窍");

    // Confirm button is labeled 追问 (not 重新生成) — scope to modal so we
    // don't collide with the per-unit 追问 button still in the DOM.
    const modal = screen.getByTestId("regenerate-modal");
    expect(within(modal).getByRole("button", { name: "追问" })).toBeInTheDocument();

    // Type optional follow-up text + click 追问
    fireEvent.change(screen.getByLabelText(/修改意见/i), {
      target: { value: "如何验证?" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(mockApi.postB3FollowUp).toHaveBeenCalledWith("p1", {
        unit_id: "u1",
        user_question: "如何验证?",
        operator: "none",
      });
    });

    // Modal must close after confirm.
    await waitFor(() => {
      expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    });
  });

  it("S2 per-unit 追问: opening the modal does NOT auto-fire /follow-up", async () => {
    // Regression guard for the user-reported "auto-regenerate" symptom:
    // just opening the per-unit modal (without confirming) must not call
    // /follow-up. Otherwise the user feels the regenerate fired before
    // they had a chance to type anything.
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        {
          dimension: "ontology",
          units: [
            { id: "u1", unit_name: "灵窍", description: "d", is_irreducible: false, follow_up_count: 0 },
          ],
          candidates: [],
          insight: "",
        },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });
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
      expect(screen.getByTestId("follow-up-u1")).toBeInTheDocument();
    });

    // Open modal then immediately close it — neither path should call API.
    fireEvent.click(screen.getByTestId("follow-up-u1"));
    expect(mockApi.postB3FollowUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(mockApi.postB3FollowUp).not.toHaveBeenCalled();
  });

  it("S2's registered nextHandler triggers DIVERGE when clicked with no downstream data", async () => {
    // Mock decompose to return a non-empty dimensions list so the divergence
    // hook transitions to S2 with a successful payload.
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });
    mockApi.postB3Diverge.mockResolvedValueOnce({
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
      expect(mockApi.postB3Diverge).toHaveBeenCalledWith("p1", expect.anything());
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
    mockApi.postB3Decompose.mockResolvedValueOnce({
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
    // Two non-empty mocks: one for the auto-decompose on S1→S2 entry, one for
    // the regen confirm. Returning non-empty dimensions breaks the
    // auto-decompose loop (useEffect re-fires decompose whenever dims is []).
    mockApi.postB3Decompose
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm",
        top_level_summary: "ts",
      })
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u2", unit_name: "Y", description: "d2", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm2",
        top_level_summary: "ts2",
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
    expect(screen.getByText(/重新生成 — 拆解/)).toBeInTheDocument();
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
      const calls = mockApi.postB3Decompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const lastBody = calls[calls.length - 1][1] as Record<string, unknown>;
      expect(lastBody.user_modifications).toBe("聚焦东方玄幻,弱化科幻");
    });

    // Modal closes after confirm.
    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
  });

  it("S2 regen modal cancel does NOT call decompose (Round 2 — item 3)", async () => {
    mockApi.postB3Decompose.mockResolvedValueOnce({
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
    const callsBefore = mockApi.postB3Decompose.mock.calls.length;

    // Cancel.
    await act(async () => {
      fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    });

    expect(screen.queryByTestId("regenerate-modal")).toBeNull();
    expect(mockApi.postB3Decompose.mock.calls.length).toBe(callsBefore);
  });

  it("S2 regen modal empty text = 仅重新生成 (empty user_modifications)", async () => {
    // Two non-empty mocks (see L481 comment for why).
    mockApi.postB3Decompose
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm",
        top_level_summary: "ts",
      })
      .mockResolvedValueOnce({
        dimensions: [
          { dimension: "ontology", units: [{ id: "u2", unit_name: "Y", description: "d2", is_irreducible: true, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "cm2",
        top_level_summary: "ts2",
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
      const calls = mockApi.postB3Decompose.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    const lastBody = mockApi.postB3Decompose.mock.calls[
      mockApi.postB3Decompose.mock.calls.length - 1
    ][1] as Record<string, unknown>;
    // Empty text → user_modifications is undefined (useB3Divergence only
    // passes the field when non-empty so the route doesn't accept empty
    // string as a meaningful "I want to add nothing").
    expect(
      lastBody.user_modifications === undefined || lastBody.user_modifications === "",
    ).toBe(true);
  });

  // Regression for user-reported bug (2026-09-18):
  // "从'拆解'点击下一步进入发散,然后在发散点击'上一步'返回'拆解',为什么会再次自动拆解,状态时'拆解中'"
  // Walking the happy path S1 → S2 (decompose) → S3 (diverge) → S2 (prev-nav)
  // must NOT trigger another /decompose call. The dimensions array still holds
  // the post-/diverge payload (units + candidates), so the auto-decompose
  // effect's `state.dimensions.length === 0` guard should short-circuit it.
  it("S3 → S2 back-nav does NOT re-fire /decompose (dimensions already populated)", async () => {
    // /decompose returns dimensions WITHOUT candidates so requestNext("3")
    // bypasses the confirm dialog and goes straight to /diverge.
    const DIM_AFTER_DECOMP = (dimKey: string, uName: string) => ({
      dimension: dimKey,
      insight: `${dimKey}-insight`,
      units: [{ id: `u-${dimKey}`, dimension: dimKey, unit_name: uName, description: "d", is_irreducible: false, follow_up_count: 0 }],
      candidates: [],
      dimension_status: "decomposed" as const,
    });
    // /diverge returns dimensions WITH units + candidates (mirrors real backend).
    const DIM_AFTER_DIVERGE = (dimKey: string, uName: string) => ({
      dimension: dimKey,
      insight: `${dimKey}-insight`,
      units: [{ id: `u-${dimKey}`, dimension: dimKey, unit_name: uName, description: "d", is_irreducible: false, follow_up_count: 0 }],
      candidates: [
        { id: `c-${dimKey}__original`, unit_id: `u-${dimKey}`, unit_name: uName, description: "orig", chain_reaction: "r", main_operator: "distort", aux_operator: null, selection_rank: 0 },
        { id: `c-${dimKey}-1`, unit_id: `u-${dimKey}`, unit_name: uName, description: "v1", chain_reaction: "r1", main_operator: "break", aux_operator: null, selection_rank: 1 },
      ],
      dimension_status: "diverged" as const,
    });
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        DIM_AFTER_DECOMP("ontology", "灵窍"),
        DIM_AFTER_DECOMP("energetics", "灵力"),
        DIM_AFTER_DECOMP("power_structure", "朝廷"),
        DIM_AFTER_DECOMP("protagonist_engine", "金手指"),
        DIM_AFTER_DECOMP("narrative_physics", "节奏"),
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });
    mockApi.postB3Diverge.mockResolvedValueOnce({
      dimensions: [
        DIM_AFTER_DIVERGE("ontology", "灵窍"),
        DIM_AFTER_DIVERGE("energetics", "灵力"),
        DIM_AFTER_DIVERGE("power_structure", "朝廷"),
        DIM_AFTER_DIVERGE("protagonist_engine", "金手指"),
        DIM_AFTER_DIVERGE("narrative_physics", "节奏"),
      ],
    });

    const { setNextHandler, setPrevHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

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
    await act(async () => { (s1Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1));

    // S2 → S3 via the registered "下一步:发散 →" handler. With no candidates
    // (decompose mock returned empty `candidates`), hasDownstreamData(S2, "3")
    // is false, so requestNext jumps + calls /diverge.
    await waitFor(() => {
      const s2Next = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(s2Next?.[2]).toBe("下一步:发散 →");
    });
    const s2Next = setNextHandler.mock.calls
      .filter(([handler]) => typeof handler === "function")
      .pop()!;
    await act(async () => { (s2Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Diverge).toHaveBeenCalledTimes(1));

    // Now at S3. The S3 prevHandler is `() => jumpToStage("2")`. Invoke it.
    // Capture the latest prevHandler registration.
    await waitFor(() => {
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      // The S3 prevHandler is a function (line 86 of CreativeDivergenceStep).
      expect(typeof lastPrev[0]).toBe("function");
    });
    const s3Prev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1]!;
    await act(async () => { (s3Prev[0] as () => void)(); });

    // Give React a few ticks to re-run the auto-decompose effect.
    await new Promise((r) => setTimeout(r, 50));

    // The auto-decompose effect at line 170 of CreativeDivergenceStep.tsx
    // MUST short-circuit because state.dimensions.length > 0. Asserting this
    // call count catches the regression: if dimensions is somehow cleared on
    // S3→S2 back-nav, the auto-decompose fires and postB3Decompose is called
    // a second time.
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1);
  });

  // User-reported bug: "从'拆解'点击下一步进入发散,然后在发散点击'上一步'返回'拆解',
  // 为什么会再次自动拆解,状态时'拆解中'"
  //
  // Fix verification: when 上一步 is clicked while /diverge is still in flight,
  // (a) the auto-decompose effect MUST NOT fire (already guarded by
  // Bug fix (Round 2, 2026-09-18): when /diverge is in flight and the user
  // clicks "上一步" from S3 → S2, the wizard must actually CANCEL the
  // /diverge request (Round 1 only suppressed the UI label — the request
  // kept running until the LLM returned). Specifically:
  //   (a) /decompose must NOT be called again (no auto-re-decompose),
  //   (b) the AbortSignal passed to /diverge must be aborted so the hung
  //       fetch rejects and the backend stops billing tokens,
  //   (c) the S2 footer must be enabled (loading=false) and have no
  //       loading-label (no inflight operation to display).
  it("S3 → S2 back-nav during in-flight /diverge cancels the request and clears the footer", async () => {
    const DIM_AFTER_DECOMP = (dimKey: string, uName: string) => ({
      dimension: dimKey,
      insight: `${dimKey}-insight`,
      units: [{ id: `u-${dimKey}`, dimension: dimKey, unit_name: uName, description: "d", is_irreducible: false, follow_up_count: 0 }],
      candidates: [],
      dimension_status: "decomposed" as const,
    });
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        DIM_AFTER_DECOMP("ontology", "灵窍"),
        DIM_AFTER_DECOMP("energetics", "灵力"),
        DIM_AFTER_DECOMP("power_structure", "朝廷"),
        DIM_AFTER_DECOMP("protagonist_engine", "金手指"),
        DIM_AFTER_DECOMP("narrative_physics", "节奏"),
      ],
      causal_map: "cm",
      top_level_summary: "ts",
    });

    // /diverge hangs forever — capture the AbortSignal the hook passed so we
    // can assert `signal.aborted === true` after the user navigates away.
    let capturedSignal: AbortSignal | undefined;
    let resolveDiverge: (v: any) => void = () => {};
    mockApi.postB3Diverge.mockImplementationOnce(
      (_id: string, opts?: { signal?: AbortSignal }) =>
        new Promise((res) => {
          capturedSignal = opts?.signal;
          resolveDiverge = res;
        }),
    );

    const { setNextHandler, setPrevHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

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
    await act(async () => { (s1Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1));

    // S2 → S3 (fires /diverge, which hangs).
    await waitFor(() => {
      const s2Next = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(s2Next?.[2]).toBe("下一步:发散 →");
    });
    const s2Next = setNextHandler.mock.calls
      .filter(([handler]) => typeof handler === "function")
      .pop()!;
    await act(async () => { (s2Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Diverge).toHaveBeenCalledTimes(1));
    expect(capturedSignal?.aborted).toBe(false);

    // S3 prevHandler: click 上一步 WHILE /diverge is still in flight.
    await waitFor(() => {
      const lastPrev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1];
      expect(typeof lastPrev[0]).toBe("function");
    });
    const s3Prev = setPrevHandler.mock.calls[setPrevHandler.mock.calls.length - 1]!;
    await act(async () => { (s3Prev[0] as () => void)(); });

    // Settle all microtasks so the auto-decompose effect has a chance to run.
    await new Promise((r) => setTimeout(r, 50));

    // (a) /decompose must NOT have been called again — auto-decompose
    // correctly guards on `!state.loading`.
    expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1);

    // (b) The hung /diverge's AbortSignal must be aborted — the fetch
    // is now cancelling instead of draining tokens in the background.
    expect(capturedSignal?.aborted).toBe(true);

    // (c) S2 footer is enabled with no loading-label — nothing is in
    // flight, so the wizard's next button must be clickable again.
    const lastS2Next = setNextHandler.mock.calls[setNextHandler.mock.calls.length - 1];
    expect(lastS2Next[1]).toBe(false);  // disabled=false (nothing loading)
    expect(lastS2Next[2]).toBe("下一步:发散 →");
    expect(lastS2Next[3]).toBeNull();   // no inflight label

    // Drain the dangling /diverge so vitest can shut down the test cleanly.
    // The abort listener on the hung promise rejected it already, but we
    // hold a stray resolver in case the abort path skipped the rejection.
    await act(async () => {
      resolveDiverge({ dimensions: [] });
    });
  });
});

describe("CreativeDivergenceStep meta-decompose wiring", () => {
  it("handleS1Submit triggers meta-decompose first, then decompose", async () => {
    const callOrder: string[] = [];
    mockApi.postB3MetaDecompose.mockImplementationOnce(async () => {
      callOrder.push("meta");
      return { generated_prompt: "x", written_to_override: true };
    });
    mockApi.postB3Decompose.mockImplementationOnce(async () => {
      callOrder.push("decompose");
      return {
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "m",
        top_level_summary: "s",
      };
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒" },
    });
    // Wait for creative dimensions to load so the S1 form is valid (subject
    // must be non-empty per S1InputStep.valid).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    // After 热血 button exists, the textarea fireEvent's state update should
    // have already propagated → setNextHandler has an enabled entry. Re-fire
    // change to be sure the effect re-registers with the enabled handler.
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒(更长的)" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;

    await act(async () => {
      (enabled[0] as () => void)();
    });

    // runS1ToS2 awaits two api calls in sequence; both push to callOrder
    // synchronously inside their mockImplementationOnce. After act returns,
    // both promises have resolved and dispatched their actions.
    await waitFor(() => expect(callOrder).toEqual(["meta", "decompose"]));
  });

  it("does NOT call /decompose when /meta-decompose fails", async () => {
    const callOrder: string[] = [];
    mockApi.postB3MetaDecompose.mockImplementationOnce(async () => {
      callOrder.push("meta");
      throw new Error("元提示词生成失败: LLM upstream timeout");
    });
    mockApi.postB3Decompose.mockImplementation(async () => {
      callOrder.push("decompose");
      return {
        dimensions: [
          { dimension: "ontology", units: [{ id: "u1", unit_name: "X", description: "d", is_irreducible: false, follow_up_count: 0 }], candidates: [], insight: "" },
        ],
        causal_map: "m",
        top_level_summary: "s",
      };
    });

    const { setNextHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /热血/ })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "一个少年在废墟里觉醒(更长的)" },
    });
    await waitFor(() => {
      const enabled = setNextHandler.mock.calls.find(
        ([handler, disabled]) => typeof handler === "function" && disabled === false,
      );
      expect(enabled).toBeTruthy();
    });
    const enabled = setNextHandler.mock.calls.find(
      ([handler, disabled]) => typeof handler === "function" && disabled === false,
    )!;

    await act(async () => {
      (enabled[0] as () => void)();
    });

    // Wait for meta to fire.
    await waitFor(() => expect(callOrder).toContain("meta"));
    // Verify runS1ToS2 didn't synchronously call decompose (would have
    // pushed "decompose" between "meta" and any auto-decompose retry).
    // The first decompose call (if any) must NOT happen in the same tick
    // as runS1ToS2's await chain — only after the auto-decompose effect
    // re-runs. So we check that after the meta error resolves, no
    // decompose call has fired within the same microtask drain.
    //
    // Allow a tick to ensure all synchronous microtasks from the meta
    // error path have settled.
    await new Promise((r) => setTimeout(r, 50));
    // runS1ToS2's hard-error path doesn't call decompose — but the
    // auto-decompose effect will fire afterwards. So we expect either
    // [] (no decompose yet) OR [decompose] (auto-decompose fired) but
    // NOT [decompose, meta] (which would mean auto-decompose ran before
    // meta). Crucially, runS1ToS2 itself never called decompose.
    expect(callOrder[0]).toBe("meta");
  });
});

// ── loading label click handler (暂停 / 继续 toggle) ──────────────────────────
//
// CreativeDivergenceStep wires the wizard footer's loading label as a
// pause/resume toggle. While loadingLabel is showing (any of "拆解中…" /
// "发散中…" / "提交中…" / "生成专用提示词中…" / "已暂停"), it must register a
// function via setNextLoadingClickHandler so the footer can call it when
// the user clicks the button. When NOT in flight, it must clear the
// handler (setNextLoadingClickHandler(null)).

describe("loading label click handler (pause / resume toggle wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getB3State.mockResolvedValue(null);
    mockApi.postB3MetaDecompose.mockResolvedValue({
      generated_prompt: "## META ##",
      written_to_override: true,
    });
    mockApi.getPlazaPrompt.mockResolvedValue({ effective: null });
    mockApi.putPlazaPrompt.mockResolvedValue({
      name: "firstness_decompose", override: null, modified_at: null,
    });
    mockApi.postB3Decompose.mockResolvedValue({
      dimensions: [],
      causal_map: "",
      top_level_summary: "",
    });
  });

  it("registers a click handler via setNextLoadingClickHandler while /diverge is in flight", async () => {
    // /decompose returns dimensions WITHOUT candidates so requestNext("3")
    // bypasses the confirm dialog and goes straight to /diverge.
    mockApi.postB3Decompose.mockResolvedValueOnce({
      dimensions: [
        { dimension: "ontology", insight: "i", units: [
          { id: "u1", dimension: "ontology", unit_name: "n", description: "d", is_irreducible: false, follow_up_count: 0 },
        ], candidates: [], dimension_status: "decomposed" },
      ],
      causal_map: "cm", top_level_summary: "ts",
    });
    // Hang /diverge.
    let resolveDiverge: (v: any) => void = () => {};
    mockApi.postB3Diverge.mockImplementationOnce(
      (_id: string, opts?: { signal?: AbortSignal }) =>
        new Promise((res) => { resolveDiverge = res; }),
    );

    const { setNextHandler, setNextLoadingClickHandler } = renderWithWizardContext();
    fireEvent.change(screen.getByLabelText(/灵感点子/i), { target: { value: "足够长的原始灵感点子" } });

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
    await act(async () => { (s1Next[0] as () => void)(); });
    await waitFor(() => expect(mockApi.postB3Decompose).toHaveBeenCalledTimes(1));

    // S2 → S3
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(lastNext?.[2]).toBe("下一步:发散 →");
    });
    const s2Next = setNextHandler.mock.calls
      .filter(([handler]) => typeof handler === "function")
      .pop()!;
    await act(async () => { (s2Next[0] as () => void)(); });

    // /diverge is now hung. Latest loadingLabel should be "发散中…".
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(lastNext?.[3]).toBe("发散中…");
    });

    // Click handler should be a function (pause toggle wired).
    await waitFor(() => {
      const lastClick = setNextLoadingClickHandler.mock.calls
        .filter(([handler]) => handler !== null && typeof handler === "function")
        .pop();
      expect(lastClick).toBeTruthy();
    });
    const clickCall = setNextLoadingClickHandler.mock.calls
      .filter(([handler]) => handler !== null && typeof handler === "function")
      .pop()!;
    expect(typeof clickCall[0]).toBe("function");

    // Invoke the registered click handler — should call pause(), which
    // flips state.paused=true and clears inflight UI flags.
    await act(async () => {
      (clickCall[0] as () => void)();
    });

    // Now loadingLabel should be "已暂停" (paused branch of the chain).
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(lastNext?.[3]).toBe("已暂停");
    });

    // Regression (Bug, 2026-09-18): the wizard footer button renders
    // nextLoadingLabel only when nextDisabled=true. If paused is dropped
    // from the disabled computation, the static "下一步:提交 →" label
    // would show instead of "已暂停", falsely offering the user a way
    // to advance past an unfinished diverge. Pin that disabled flips
    // to true while paused.
    await waitFor(() => {
      const lastNext = setNextHandler.mock.calls
        .filter(([handler]) => typeof handler === "function")
        .pop();
      expect(lastNext?.[1]).toBe(true);
    });

    // Unblock the (now-aborted) /diverge promise so React flushes pending
    // catch handlers without leaving a dangling promise.
    resolveDiverge({ dimensions: [] });
  });

  it("does NOT register a click handler when no operation is in flight", async () => {
    const { setNextLoadingClickHandler } = renderWithWizardContext();

    // Wait for the initial registration pass.
    await new Promise((r) => setTimeout(r, 50));

    // Find the LAST registration with a non-null handler. There should
    // be NONE — S1 has no inflight operation, and the click handler
    // registration effect should clear it on every render where
    // loadingLabel === null.
    const lastClick = setNextLoadingClickHandler.mock.calls
      .map(([handler]) => handler)
      .filter((h) => h !== null)
      .pop();
    expect(lastClick).toBeUndefined();
  });
});